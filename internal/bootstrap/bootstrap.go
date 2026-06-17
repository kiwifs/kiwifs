package bootstrap

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"path/filepath"
	"strings"
	"time"

	"github.com/kiwifs/kiwifs/internal/api"
	"github.com/kiwifs/kiwifs/internal/claims"
	"github.com/kiwifs/kiwifs/internal/comments"
	"github.com/kiwifs/kiwifs/internal/config"
	"github.com/kiwifs/kiwifs/internal/draft"
	"github.com/kiwifs/kiwifs/internal/events"
	"github.com/kiwifs/kiwifs/internal/janitor"
	"github.com/kiwifs/kiwifs/internal/links"
	"github.com/kiwifs/kiwifs/internal/markdown"
	"github.com/kiwifs/kiwifs/internal/pipeline"
	"github.com/kiwifs/kiwifs/internal/rbac"
	"github.com/kiwifs/kiwifs/internal/schema"
	"github.com/kiwifs/kiwifs/internal/search"
	"github.com/kiwifs/kiwifs/internal/storage"
	"github.com/kiwifs/kiwifs/internal/tracing"
	"github.com/kiwifs/kiwifs/internal/vectorstore"
	"github.com/kiwifs/kiwifs/internal/versioning"
	"github.com/kiwifs/kiwifs/internal/webhooks"
)

func janitorInterval(cfg *config.Config) time.Duration {
	raw := cfg.Janitor.Interval
	if raw == "" {
		return 24 * time.Hour
	}
	d, err := time.ParseDuration(raw)
	if err != nil {
		log.Printf("janitor: invalid interval %q, using 24h: %v", raw, err)
		return 24 * time.Hour
	}
	if d < 0 {
		return 0
	}
	return d
}

type Stack struct {
	Name                string
	Root                string
	Config              *config.Config
	Store               storage.Storage
	Versioner           versioning.Versioner
	Searcher            search.Searcher
	Linker              links.Linker
	LinkResolver        *links.Resolver
	Hub                 *events.Hub
	Pipeline            *pipeline.Pipeline
	Vectors             *vectorstore.Service
	Comments            *comments.Store
	Server              *api.Server
	JanitorSched        *janitor.Scheduler
	Emitter             tracing.Emitter
	WebhookDispatcher   *webhooks.Dispatcher
	ClaimStore          *claims.Store
	DraftMgr            *draft.Manager
	AuditLogger         *api.AuditLogger // B.3
	claimCancel         context.CancelFunc
}

func Build(name, root string, cfg *config.Config) (*Stack, error) {
	prefix := logPrefix(name)

	store, err := storage.NewLocal(root)
	if err != nil {
		return nil, fmt.Errorf("%sstorage init: %w", prefix, err)
	}

	ver := buildVersioner(prefix, root, cfg)
	searcher := buildSearcher(prefix, root, store, cfg)

	vectors, verr := vectorstore.Build(root, store, cfg.Search.Vector)
	if verr != nil {
		log.Printf("%svector search disabled (%v)", prefix, verr)
		vectors = nil
	} else if vectors != nil {
		log.Printf("%svector search: provider=%s store=%s — enabled",
			prefix, cfg.Search.Vector.Embedder.Provider, cfg.Search.Vector.Store.Provider)
	}

	var linker links.Linker
	if l, ok := searcher.(links.Linker); ok {
		linker = l
	}

	linkResolver := links.NewResolver(func(ctx context.Context, fn func(path string)) error {
		return storage.Walk(ctx, store, "/", func(e storage.Entry) error {
			fn(e.Path)
			return nil
		})
	})

	hub := events.NewHub()
	pipe := pipeline.New(store, ver, searcher, linker, hub, vectors, root)

	asyncIdxEnabled := cfg.Search.AsyncIndex == nil || *cfg.Search.AsyncIndex
	if asyncIdxEnabled && cfg.Search.Engine != "grep" {
		var idxOpts []pipeline.IndexerOption
		if cfg.Search.IndexWindowMs > 0 {
			idxOpts = append(idxOpts, pipeline.WithIndexBatchWindow(
				time.Duration(cfg.Search.IndexWindowMs)*time.Millisecond))
		}
		if cfg.Search.IndexBatchMax > 0 {
			idxOpts = append(idxOpts, pipeline.WithIndexBatchMax(cfg.Search.IndexBatchMax))
		}
		idxJournal := filepath.Join(root, ".kiwi", "state", "unindexed.log")
		idxOpts = append(idxOpts, pipeline.WithIndexJournal(idxJournal))
		pipe.AsyncIdx = pipeline.NewAsyncIndexer(searcher, linker, vectors, idxOpts...)
		if cbs, ok := searcher.(interface {
			ComputeBlockedStatus(ctx context.Context) error
		}); ok {
			pipe.AsyncIdx.PostFlush = func(ctx context.Context) {
				if err := cbs.ComputeBlockedStatus(ctx); err != nil {
					log.Printf("%s_blocked reconciliation: %v", prefix, err)
				}
			}
		}
		log.Printf("%sasync indexing enabled (window=%dms)",
			prefix, func() int {
				if cfg.Search.IndexWindowMs > 0 {
					return cfg.Search.IndexWindowMs
				}
				return 200
			}())
	}

	pipe.OnInvalidate = func() { linkResolver.MarkDirty() }

	// Always wire dependency re-indexing (independent of webhooks).
	// Trigger on both "status" and "state" (kanban workflow field) so that
	// kanban state transitions also fire callbacks.
	pipe.OnTransition = func(path, field, from, to, actor string) {
		if (field == "status" || field == "state") && (to == "done" || to == "cancelled") {
			go func() {
				if pipe.AsyncIdx != nil {
					pipe.AsyncIdx.Flush()
				}
				reindexDependents(searcher, store, path)
			}()
		}
	}

	pipe.OnDelete = func(path, actor string) {
		go func() {
			if pipe.AsyncIdx != nil {
				pipe.AsyncIdx.Flush()
			}
			reindexDependents(searcher, store, path)
		}()
	}

	var webhookStore *webhooks.Store
	var webhookDispatcher *webhooks.Dispatcher
	if cfg.Webhooks.Enabled {
		ws, werr := webhooks.NewStoreFromRoot(root)
		if werr != nil {
			log.Printf("%swebhooks disabled (%v)", prefix, werr)
		} else {
			webhookStore = ws
			webhookDispatcher = webhooks.NewDispatcher(ws, webhooks.Config{
				Enabled:    true,
				MaxWorkers: cfg.Webhooks.MaxWorkers,
				MaxRetries: cfg.Webhooks.MaxRetries,
			})
			pipe.OnWebhook = func(op, path, actor string) {
				webhookDispatcher.Dispatch(context.Background(), webhooks.Event{
					Type:      op,
					Path:      path,
					Actor:     actor,
					Timestamp: time.Now().UTC().Format(time.RFC3339),
				})
			}
			baseOnTransition := pipe.OnTransition
			pipe.OnTransition = func(path, field, from, to, actor string) {
				baseOnTransition(path, field, from, to, actor)
				webhookDispatcher.Dispatch(context.Background(), webhooks.Event{
					Type:      "transition",
					Path:      path,
					Actor:     actor,
					Timestamp: time.Now().UTC().Format(time.RFC3339),
					FromState: from,
					ToState:   to,
					Field:     field,
				})
			}
			log.Printf("%swebhooks enabled", prefix)
		}
	}

	// Auto-format markdown on write (enabled by default).
	if cfg.Lint.IsAutoFormat() {
		pipe.FormatWrite = func(path string, content []byte) []byte {
			if !strings.HasSuffix(strings.ToLower(path), ".md") {
				return content
			}
			return markdown.Format(content)
		}
		log.Printf("%smarkdown auto-format enabled", prefix)
	}

	var schemaReload func()
	if cfg.Schema.Enforce {
		sv := schema.NewValidator(root)
		pipe.ValidateWrite = func(ctx context.Context, path string, content []byte, _ pipeline.WriteKind) error {
			fm, ferr := markdown.Frontmatter(content)
			if ferr != nil || fm == nil {
				return nil
			}
			if verr := sv.Validate(fm); verr != nil {
				return verr
			}
			return nil
		}
		schemaReload = sv.Reload
		log.Printf("%sschema validation enabled", prefix)
	}

	if len(cfg.ValidateWriteRules) > 0 {
		wv := pipeline.NewWriteRuleValidator(pipe.Store, cfg.ValidateWriteRules)
		existingValidate := pipe.ValidateWrite
		pipe.ValidateWrite = func(ctx context.Context, path string, content []byte, kind pipeline.WriteKind) error {
			if err := wv.Validate(ctx, path, content, kind); err != nil {
				return err
			}
			if existingValidate != nil {
				return existingValidate(ctx, path, content, kind)
			}
			return nil
		}
		log.Printf("%svalidate_write rules enabled (%d)", prefix, len(cfg.ValidateWriteRules))
	}

	// Extend ValidateWrite to reject markdown with error-severity lint
	// issues (runs after auto-format has cleaned cosmetic issues).
	if cfg.Lint.IsRejectErrors() {
		existingValidate := pipe.ValidateWrite
		pipe.ValidateWrite = func(ctx context.Context, path string, content []byte, kind pipeline.WriteKind) error {
			// Run existing schema validation first.
			if existingValidate != nil {
				if err := existingValidate(ctx, path, content, kind); err != nil {
					return err
				}
			}
			// Markdown-specific lint: reject error-severity issues.
			if !strings.HasSuffix(strings.ToLower(path), ".md") {
				return nil
			}
			issues := markdown.LintMarkdown(content)
			for _, issue := range issues {
				if issue.Severity == "error" {
					return fmt.Errorf("%s (line %d): %s", issue.Rule, issue.Line, issue.Message)
				}
			}
			return nil
		}
		log.Printf("%smarkdown lint reject-errors enabled", prefix)
	}

	if cfg.Workflow.EnforceTransitions && len(cfg.Workflow.Transitions) > 0 {
		transitions := cfg.Workflow.Transitions
		pipe.ValidateTransition = func(path, from, to string) error {
			allowed, ok := transitions[from]
			if !ok {
				return nil
			}
			for _, a := range allowed {
				if a == to {
					return nil
				}
			}
			return fmt.Errorf("transition %q → %q not allowed (allowed: %v)", from, to, allowed)
		}
		log.Printf("%sworkflow transition enforcement enabled", prefix)
	}

	cstore, err := comments.New(root)
	if err != nil {
		if vectors != nil {
			_ = vectors.Close()
		}
		_ = searcher.Close()
		return nil, fmt.Errorf("%scomments store: %w", prefix, err)
	}

	shares, err := rbac.NewShareStore(root)
	if err != nil {
		log.Printf("%sshare links disabled (%v)", prefix, err)
		shares = nil
	}

	em := tracing.NewEmitter(cfg.Tracing.IsEnabled(), cfg.Tracing.Output, cfg.Tracing.File)

	claimStore, cerr := claims.NewStoreFromRoot(root)
	var claimCancel context.CancelFunc
	if cerr != nil {
		log.Printf("%sclaims disabled (%v)", prefix, cerr)
		claimStore = nil
	} else {
		var claimCtx context.Context
		claimCtx, claimCancel = context.WithCancel(context.Background())
		go func() {
			ticker := time.NewTicker(30 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-ticker.C:
					claimStore.ExpireStale(context.Background())
				case <-claimCtx.Done():
					return
				}
			}
		}()
		log.Printf("%sclaims enabled", prefix)
	}

	var draftMgr *draft.Manager
	if cfg.Drafts.Enabled {
		maxActive := cfg.Drafts.MaxActive
		if maxActive <= 0 {
			maxActive = 10
		}
		dm, derr := draft.NewManager(root, maxActive)
		if derr != nil {
			log.Printf("%sdrafts disabled (%v)", prefix, derr)
		} else {
			draftMgr = dm
			log.Printf("%sdrafts enabled (max_active=%d)", prefix, maxActive)
		}
	}

	// B.3 — Audit logger: create when [audit] enabled = true.
	var auditLogger *api.AuditLogger
	if cfg.Audit.Enabled {
		al, aerr := api.NewAuditLogger(root)
		if aerr != nil {
			log.Printf("%saudit logging disabled (%v)", prefix, aerr)
		} else {
			auditLogger = al
			log.Printf("%saudit logging enabled", prefix)
		}
	}

	var serverOpts []api.ServerOption
	if webhookStore != nil {
		serverOpts = append(serverOpts, api.WithWebhookStore(webhookStore))
	}
	if claimStore != nil {
		serverOpts = append(serverOpts, api.WithClaimStore(claimStore))
	}
	if schemaReload != nil {
		serverOpts = append(serverOpts, api.WithSchemaReload(schemaReload))
	}
	if draftMgr != nil {
		serverOpts = append(serverOpts, api.WithDraftManager(draftMgr))
	}
	if auditLogger != nil {
		serverOpts = append(serverOpts, api.WithAuditLogger(auditLogger))
	}

	// B.5 — Auto-register config-driven [[webhook_entries]] at startup.
	// Each entry is idempotent: if a webhook with the same URL already
	// exists in the store, we skip it to avoid duplicates on restart.
	if webhookStore != nil && len(cfg.WebhookEntries) > 0 {
		for _, we := range cfg.WebhookEntries {
			if we.URL == "" || len(we.Events) == 0 {
				continue
			}
			existing, ferr := webhookStore.FindByURL(context.Background(), we.URL)
			if ferr != nil {
				log.Printf("%swebhook entry: lookup error for %s: %v", prefix, we.URL, ferr)
				continue
			}
			if existing != nil {
				// Already registered — skip.
				continue
			}
			glob := we.PathGlob
			if glob == "" {
				glob = "**"
			}
			secret := we.Secret
			if secret == "" {
				secret = "whsec_" + generateBootstrapSecret()
			}
			_, rerr := webhookStore.RegisterWithSecret(context.Background(), we.URL, glob, secret, we.Events...)
			if rerr != nil {
				log.Printf("%swebhook entry: register %s failed: %v", prefix, we.URL, rerr)
			} else {
				log.Printf("%swebhook entry: auto-registered %s for events %v", prefix, we.URL, we.Events)
			}
		}
	}

	server := api.NewServer(cfg, pipe, vectors, cstore, shares, linkResolver, em, serverOpts...)

	var janitorSched *janitor.Scheduler
	if iv := janitorInterval(cfg); iv > 0 {
		staleDays := cfg.Janitor.StaleDays
		if staleDays <= 0 {
			staleDays = janitor.DefaultStaleDays
		}
		scanner := janitor.New(root, store, searcher, staleDays)
		opts := janitor.ScheduleOptions{
			Interval:    iv,
			Jitter:      60 * time.Second,
			InitialScan: cfg.Janitor.StartupScan,
		}
		janitorSched = janitor.NewScheduler(scanner, hub, ver, opts)
		server.SetJanitorScheduler(janitorSched)
	}

	stack := &Stack{
		Name:              name,
		Root:              root,
		Config:            cfg,
		Store:             store,
		Versioner:         ver,
		Searcher:          searcher,
		Linker:            linker,
		LinkResolver:      linkResolver,
		Hub:               hub,
		Pipeline:          pipe,
		Vectors:           vectors,
		Comments:          cstore,
		Server:            server,
		JanitorSched:      janitorSched,
		Emitter:           em,
		WebhookDispatcher: webhookDispatcher,
		ClaimStore:        claimStore,
		DraftMgr:          draftMgr,
		AuditLogger:       auditLogger,
		claimCancel:       claimCancel,
	}

	pipe.DrainUncommitted(context.Background())

	if rs, ok := searcher.(search.Resyncer); ok {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
			defer cancel()
			start := time.Now()
			added, removed, rerr := rs.Resync(ctx)
			if rerr != nil {
				log.Printf("%ssearch: resync failed: %v", prefix, rerr)
				return
			}
			if added == 0 && removed == 0 {
				return
			}
			log.Printf("%ssearch: resync reconciled %d added, %d removed in %s",
				prefix, added, removed, time.Since(start).Round(time.Millisecond))
		}()
	}

	if vectors != nil {
		go stack.reindexIfEmpty()
	}

	return stack, nil
}

func (s *Stack) Close() error {
	var firstErr error
	if s.AuditLogger != nil {
		s.AuditLogger.Close()
	}
	if s.DraftMgr != nil {
		s.DraftMgr.Cleanup()
	}
	if s.WebhookDispatcher != nil {
		s.WebhookDispatcher.Close()
	}
	if s.claimCancel != nil {
		s.claimCancel()
	}
	if s.ClaimStore != nil {
		if err := s.ClaimStore.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	// Flush async indexer before closing the searcher it writes to.
	if s.Pipeline != nil && s.Pipeline.AsyncIdx != nil {
		if err := s.Pipeline.AsyncIdx.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	if c, ok := s.Versioner.(interface{ Close() error }); ok {
		if err := c.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	if s.Vectors != nil {
		if err := s.Vectors.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	if s.Searcher != nil {
		if err := s.Searcher.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

func buildVersioner(prefix, root string, cfg *config.Config) versioning.Versioner {
	switch cfg.Versioning.Strategy {
	case "git":
		v, err := versioning.NewGit(root)
		if err != nil {
			log.Printf("%sgit versioning unavailable (%v) — running without versioning", prefix, err)
			return versioning.NewNoop()
		}
		asyncEnabled := cfg.Versioning.AsyncCommit == nil || *cfg.Versioning.AsyncCommit
		if asyncEnabled {
			var opts []versioning.AsyncOption
			if cfg.Versioning.BatchWindowMs > 0 {
				opts = append(opts, versioning.WithBatchWindow(time.Duration(cfg.Versioning.BatchWindowMs)*time.Millisecond))
			}
			if cfg.Versioning.BatchMaxSize > 0 {
				opts = append(opts, versioning.WithBatchMaxSize(cfg.Versioning.BatchMaxSize))
			}
			ulog := filepath.Join(root, ".kiwi", "state", "uncommitted.log")
			opts = append(opts, versioning.WithUncommittedLog(ulog))
			log.Printf("%sgit versioning: async commits enabled", prefix)
			return versioning.NewAsyncGit(v, opts...)
		}
		return v
	case "cow":
		cow, err := versioning.NewCow(root)
		if err != nil {
			log.Printf("%scow versioning unavailable (%v) — running without versioning", prefix, err)
			return versioning.NewNoop()
		}
		if cfg.Versioning.MaxVersions != 0 {
			cow.MaxVersions = cfg.Versioning.MaxVersions
		}
		return cow
	default:
		return versioning.NewNoop()
	}
}

func buildSearcher(prefix, root string, store storage.Storage, cfg *config.Config) search.Searcher {
	switch cfg.Search.Engine {
	case "sqlite", "fts5":
		sq, err := search.NewSQLiteWithTypedFields(root, store, cfg.Links.TypedLinkFields(), cfg.Dataview.CustomFields)
		if err != nil {
			log.Printf("%ssqlite search unavailable (%v) — falling back to grep", prefix, err)
			return search.NewGrep(root)
		}
		return sq
	default:
		return search.NewGrep(root)
	}
}

func (s *Stack) reindexIfEmpty() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	prefix := logPrefix(s.Name)
	n, err := s.Vectors.Count(ctx)
	if err != nil {
		log.Printf("%svectorstore: count: %v", prefix, err)
		return
	}
	if n > 0 {
		return
	}
	log.Printf("%svectorstore: empty — reindexing in background", prefix)
	start := time.Now()
	count, err := s.Vectors.Reindex(ctx)
	if err != nil {
		log.Printf("%svectorstore: reindex: %v", prefix, err)
		return
	}
	log.Printf("%svectorstore: reindexed %d files in %s",
		prefix, count, time.Since(start).Round(time.Millisecond))
}

func reindexDependents(searcher search.Searcher, store storage.Storage, completedPath string) {
	mi, ok := searcher.(interface {
		IndexMeta(ctx context.Context, path string, content []byte) error
	})
	if !ok {
		return
	}
	qm, ok := searcher.(interface {
		QueryMetaOr(ctx context.Context, andFilters, orFilters []search.MetaFilter, sort string, limit, offset int) ([]search.MetaResult, error)
	})
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	results, err := qm.QueryMetaOr(ctx,
		[]search.MetaFilter{{Field: "blocked-by[*]", Op: "=", Value: completedPath}},
		nil, "", 0, 0)
	if err != nil {
		log.Printf("reindex dependents: query: %v", err)
		return
	}
	for _, r := range results {
		content, rerr := store.Read(ctx, r.Path)
		if rerr != nil {
			continue
		}
		mi.IndexMeta(ctx, r.Path, content)
	}
}

func logPrefix(name string) string {
	if name == "" || name == "default" {
		return ""
	}
	return "[" + name + "] "
}

// generateBootstrapSecret creates a random hex secret for config-driven
// webhooks that don't specify their own signing secret.
func generateBootstrapSecret() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}
