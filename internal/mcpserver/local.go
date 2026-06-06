package mcpserver

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/kiwifs/kiwifs/internal/bootstrap"
	"github.com/kiwifs/kiwifs/internal/claims"
	"github.com/kiwifs/kiwifs/internal/clipper"
	"github.com/kiwifs/kiwifs/internal/config"
	"github.com/kiwifs/kiwifs/internal/dataview"
	"github.com/kiwifs/kiwifs/internal/draft"
	"github.com/kiwifs/kiwifs/internal/graphutil"
	"github.com/kiwifs/kiwifs/internal/janitor"
	"github.com/kiwifs/kiwifs/internal/links"
	"github.com/kiwifs/kiwifs/internal/markdown"
	"github.com/kiwifs/kiwifs/internal/memory"
	"github.com/kiwifs/kiwifs/internal/pipeline"
	"github.com/kiwifs/kiwifs/internal/search"
	"github.com/kiwifs/kiwifs/internal/storage"
	"github.com/kiwifs/kiwifs/internal/tracing"
	"github.com/kiwifs/kiwifs/internal/vectorstore"
	"github.com/kiwifs/kiwifs/internal/workflow"
)

type LocalBackend struct {
	root     string
	stack    *bootstrap.Stack
	dvExec   *dataview.Executor
	draftMgr *draft.Manager

	once sync.Once
	err  error
}

func NewLocalBackend(root string) *LocalBackend {
	return &LocalBackend{root: root}
}

func (b *LocalBackend) init() error {
	b.once.Do(func() {
		abs, err := filepath.Abs(b.root)
		if err != nil {
			b.err = fmt.Errorf("resolve root: %w", err)
			return
		}
		b.root = abs

		cfgPath := filepath.Join(abs, ".kiwi", "config.toml")
		var cfg *config.Config
		if _, serr := os.Stat(cfgPath); serr == nil {
			cfg, _ = config.Load(abs)
		}
		if cfg == nil {
			cfg = &config.Config{}
		}
		cfg.Storage.Root = abs

		stack, err := bootstrap.Build("mcp", abs, cfg)
		if err != nil {
			b.err = fmt.Errorf("bootstrap: %w", err)
			return
		}
		b.stack = stack

		if sq, ok := b.stack.Searcher.(*search.SQLite); ok {
			b.dvExec = dataview.NewExecutor(sq.ReadDB())
			timeout := 5 * time.Second
			maxRows := 10000
			if t, err := time.ParseDuration(cfg.Dataview.QueryTimeout); err == nil && t > 0 {
				timeout = t
			}
			if cfg.Dataview.MaxScanRows > 0 {
				maxRows = cfg.Dataview.MaxScanRows
			}
			b.dvExec.SetLimits(maxRows, timeout)
		}
	})
	return b.err
}

func (b *LocalBackend) Changes(ctx context.Context, since string, limit int) (*ChangesResult, error) {
	if err := b.init(); err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}

	if since != "" {
		for _, c := range since {
			if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
				return nil, fmt.Errorf("invalid since: must be a hex commit hash")
			}
		}
		if len(since) < 4 || len(since) > 40 {
			return nil, fmt.Errorf("invalid since: must be 4–40 hex characters")
		}
	}

	var args []string
	if since != "" {
		args = []string{"log", "--format=%H|%an|%at|%s", fmt.Sprintf("%s..HEAD", since), fmt.Sprintf("-%d", limit)}
	} else {
		args = []string{"log", "--format=%H|%an|%at|%s", fmt.Sprintf("-%d", limit)}
	}
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = b.root
	out, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			stderr := string(exitErr.Stderr)
			if strings.Contains(stderr, "unknown revision") {
				return nil, fmt.Errorf("unknown sequence")
			}
			if strings.Contains(stderr, "does not have any commits") {
				return &ChangesResult{Changes: []Change{}, LastSeq: ""}, nil
			}
		}
		return nil, fmt.Errorf("git log: %w", err)
	}

	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	changes := make([]Change, 0, len(lines))
	for _, line := range lines {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "|", 4)
		if len(parts) < 4 {
			continue
		}
		hash, author, tsStr, subject := parts[0], parts[1], parts[2], parts[3]
		ts, _ := strconv.ParseInt(tsStr, 10, 64)
		action, path := parseLocalCommitSubject(subject)
		changes = append(changes, Change{
			Seq:       hash,
			Path:      path,
			Action:    action,
			Actor:     author,
			Timestamp: time.Unix(ts, 0).UTC().Format(time.RFC3339),
		})
	}

	lastSeq := ""
	if len(changes) > 0 {
		lastSeq = changes[0].Seq
	}
	return &ChangesResult{Changes: changes, LastSeq: lastSeq}, nil
}

func parseLocalCommitSubject(subject string) (action, path string) {
	subject = strings.TrimSpace(subject)
	if idx := strings.Index(subject, ": "); idx >= 0 {
		subject = subject[idx+2:]
	}
	subject = strings.TrimSpace(subject)
	parts := strings.SplitN(subject, " ", 2)
	if len(parts) == 2 {
		act := strings.ToLower(parts[0])
		path = strings.TrimSpace(parts[1])
		switch act {
		case "write", "create", "update":
			action = "write"
		case "delete", "remove":
			action = "delete"
		case "rename", "move":
			action = "rename"
			if idx := strings.Index(path, " → "); idx >= 0 {
				path = strings.TrimSpace(path[idx+len(" → "):])
			}
		case "bulk":
			action = "write"
			path = ""
		default:
			action = "write"
		}
		return action, path
	}
	return "write", subject
}

func (b *LocalBackend) ReadFile(ctx context.Context, path string) (string, string, error) {
	if err := b.init(); err != nil {
		return "", "", err
	}
	content, err := b.stack.Store.Read(ctx, path)
	if err != nil {
		return "", "", err
	}
	etag := pipeline.ETag(content)
	tracing.Record(ctx, tracing.Event{Kind: tracing.KindRead, Path: path, ETag: etag})
	return string(content), etag, nil
}

func (b *LocalBackend) WriteFile(ctx context.Context, path, content, actor, provenance string) (string, error) {
	if err := b.init(); err != nil {
		return "", err
	}
	body := []byte(content)
	if provType, provID, ok := pipeline.ParseProvenanceHeader(provenance); ok {
		injected, perr := pipeline.InjectProvenance(body, provType, provID, actor)
		if perr != nil {
			return "", fmt.Errorf("provenance: %w", perr)
		}
		body = injected
	}
	res, err := b.stack.Pipeline.Write(ctx, path, body, actor)
	if err != nil {
		return "", err
	}
	tracing.Record(ctx, tracing.Event{Kind: tracing.KindWrite, Path: path, ETag: res.ETag})
	return res.ETag, nil
}

func (b *LocalBackend) DeleteFile(ctx context.Context, path, actor string) error {
	if err := b.init(); err != nil {
		return err
	}
	err := b.stack.Pipeline.Delete(ctx, path, actor)
	if err == nil {
		tracing.Record(ctx, tracing.Event{Kind: tracing.KindDelete, Path: path})
	}
	return err
}

func (b *LocalBackend) Append(ctx context.Context, path, content, separator, actor string) (string, error) {
	if err := b.init(); err != nil {
		return "", err
	}
	if actor == "" {
		actor = "mcp-agent"
	}
	res, err := b.stack.Pipeline.Append(ctx, path, content, separator, actor)
	if err != nil {
		return "", err
	}
	return res.ETag, nil
}

func (b *LocalBackend) Rename(ctx context.Context, from, to, actor string) (string, error) {
	if err := b.init(); err != nil {
		return "", err
	}
	res, err := b.stack.Pipeline.Rename(ctx, from, to, actor)
	if err != nil {
		return "", err
	}
	return res.ETag, nil
}

func (b *LocalBackend) RenameWithLinks(ctx context.Context, from, to, actor string, updateLinks bool) (string, []string, error) {
	if err := b.init(); err != nil {
		return "", nil, err
	}
	res, updated, err := b.stack.Pipeline.RenameWithLinks(ctx, from, to, actor, updateLinks)
	if err != nil {
		return "", nil, err
	}
	return res.ETag, updated, nil
}

func (b *LocalBackend) Tree(ctx context.Context, path string) (json.RawMessage, error) {
	if err := b.init(); err != nil {
		return nil, err
	}
	tree, err := storage.BuildTree(ctx, b.stack.Store, path, 10)
	if err != nil {
		return nil, err
	}
	return json.Marshal(tree)
}

func (b *LocalBackend) Search(ctx context.Context, query string, limit, offset int, pathPrefix string) ([]SearchResult, error) {
	return b.SearchScoped(ctx, query, limit, offset, pathPrefix, "")
}

func (b *LocalBackend) SearchScoped(ctx context.Context, query string, limit, offset int, pathPrefix, scope string) ([]SearchResult, error) {
	if err := b.init(); err != nil {
		return nil, err
	}
	var (
		results []search.Result
		err     error
	)
	if scope != "" {
		os, ok := b.stack.Searcher.(search.OptionsSearcher)
		if !ok {
			return nil, fmt.Errorf("scope search requires sqlite search backend")
		}
		results, err = os.SearchWithOptions(ctx, query, limit, offset, pathPrefix, search.SearchOptions{Scope: scope})
	} else {
		results, err = b.stack.Searcher.Search(ctx, query, limit, offset, pathPrefix)
	}
	if err != nil {
		return nil, err
	}
	out := make([]SearchResult, len(results))
	for i, r := range results {
		snippet := r.Snippet
		snippet = stripMarkTags(snippet)
		out[i] = SearchResult{
			Path:    r.Path,
			Snippet: snippet,
			Score:   r.Score,
		}
	}
	tracing.Record(ctx, tracing.Event{Kind: tracing.KindSearch, Query: query, HitCount: len(out)})
	return out, nil
}

var markTagRe = regexp.MustCompile(`</?mark>`)

func stripMarkTags(s string) string {
	return markTagRe.ReplaceAllString(s, "")
}

func (b *LocalBackend) SearchSemantic(ctx context.Context, query string, limit int) ([]SearchResult, error) {
	return b.SearchSemanticScoped(ctx, query, limit, "")
}

func (b *LocalBackend) SearchSemanticScoped(ctx context.Context, query string, limit int, scope string) ([]SearchResult, error) {
	if err := b.init(); err != nil {
		return nil, err
	}
	if b.stack.Vectors == nil {
		return nil, fmt.Errorf("semantic search is not enabled")
	}
	if limit <= 0 {
		limit = vectorstore.DefaultTopK
	}
	searchLimit := limit
	if scope != "" && searchLimit < 200 {
		searchLimit = 200
	}
	results, err := b.stack.Vectors.Search(ctx, query, searchLimit)
	if err != nil {
		return nil, err
	}
	if scope != "" {
		sf, ok := b.stack.Searcher.(search.ScopeFilterer)
		if !ok {
			return nil, fmt.Errorf("scope search requires sqlite search backend")
		}
		results, err = filterVectorResultsByScope(ctx, sf, results, scope)
		if err != nil {
			return nil, err
		}
		if len(results) > limit {
			results = results[:limit]
		}
	}
	out := make([]SearchResult, len(results))
	for i, r := range results {
		out[i] = SearchResult{
			Path:    r.Path,
			Snippet: r.Snippet,
			Score:   r.Score,
		}
	}
	return out, nil
}

func filterVectorResultsByScope(ctx context.Context, sf search.ScopeFilterer, results []vectorstore.Result, scope string) ([]vectorstore.Result, error) {
	if scope == "" || len(results) == 0 {
		return results, nil
	}
	paths := make([]string, len(results))
	for i, result := range results {
		paths[i] = result.Path
	}
	kept, err := sf.FilterByScope(ctx, paths, scope)
	if err != nil {
		return nil, err
	}
	keep := make(map[string]bool, len(kept))
	for _, path := range kept {
		keep[path] = true
	}
	filtered := results[:0]
	for _, result := range results {
		if keep[result.Path] {
			filtered = append(filtered, result)
		}
	}
	return filtered, nil
}

type metaQuerier interface {
	QueryMeta(ctx context.Context, filters []search.MetaFilter, sort, order string, limit, offset int) ([]search.MetaResult, error)
}

func (b *LocalBackend) QueryMeta(ctx context.Context, filters []string, sort, order string, limit, offset int) ([]MetaResult, error) {
	return b.QueryMetaOr(ctx, filters, nil, sort, order, limit, offset)
}

type orMetaQuerier interface {
	QueryMetaOr(ctx context.Context, andFilters, orFilters []search.MetaFilter, sort, order string, limit, offset int) ([]search.MetaResult, error)
}

func (b *LocalBackend) QueryMetaOr(ctx context.Context, andFilters, orFilters []string, sort, order string, limit, offset int, paths ...string) ([]MetaResult, error) {
	if err := b.init(); err != nil {
		return nil, err
	}
	mq, ok := b.stack.Searcher.(orMetaQuerier)
	if !ok {
		return nil, fmt.Errorf("metadata index requires sqlite search backend")
	}

	parsedAnd := make([]search.MetaFilter, 0, len(andFilters))
	for _, raw := range andFilters {
		f, err := search.ParseMetaFilter(raw)
		if err != nil {
			return nil, err
		}
		parsedAnd = append(parsedAnd, f)
	}

	parsedOr := make([]search.MetaFilter, 0, len(orFilters))
	for _, raw := range orFilters {
		f, err := search.ParseMetaFilter(raw)
		if err != nil {
			return nil, err
		}
		parsedOr = append(parsedOr, f)
	}

	if len(paths) > 0 {
		return b.queryMetaByPaths(ctx, paths)
	}
	results, err := mq.QueryMetaOr(ctx, parsedAnd, parsedOr, sort, order, limit, offset)
	if err != nil {
		return nil, err
	}
	out := make([]MetaResult, len(results))
	for i, r := range results {
		fm, _ := json.Marshal(r.Frontmatter)
		out[i] = MetaResult{Path: r.Path, Frontmatter: fm}
	}
	return out, nil
}

func (b *LocalBackend) queryMetaByPaths(ctx context.Context, paths []string) ([]MetaResult, error) {
	sq, ok := b.stack.Searcher.(*search.SQLite)
	if !ok {
		return nil, fmt.Errorf("paths filter requires sqlite search backend")
	}
	placeholders := make([]string, len(paths))
	args := make([]any, len(paths))
	for i, p := range paths {
		placeholders[i] = "?"
		args[i] = p
	}
	query := fmt.Sprintf("SELECT path, frontmatter FROM file_meta WHERE path IN (%s)", strings.Join(placeholders, ","))
	rows, err := sq.ReadDB().QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []MetaResult
	for rows.Next() {
		var path, fmStr string
		if err := rows.Scan(&path, &fmStr); err != nil {
			return nil, err
		}
		out = append(out, MetaResult{Path: path, Frontmatter: json.RawMessage(fmStr)})
	}
	if out == nil {
		out = []MetaResult{}
	}
	return out, rows.Err()
}

func (b *LocalBackend) ViewRefresh(ctx context.Context, path string) (bool, error) {
	if err := b.init(); err != nil {
		return false, err
	}
	if b.dvExec == nil {
		return false, fmt.Errorf("view refresh requires sqlite search backend")
	}
	return dataview.RegenerateView(ctx, b.stack.Store, b.dvExec, path)
}

func (b *LocalBackend) QueryDQL(ctx context.Context, dql string, limit, offset int) (*QueryResult, error) {
	if err := b.init(); err != nil {
		return nil, err
	}
	if b.dvExec == nil {
		return nil, fmt.Errorf("dataview requires sqlite search backend")
	}
	result, err := b.dvExec.Query(ctx, dql, limit, offset)
	if err != nil {
		return nil, err
	}
	qr := &QueryResult{
		Columns: result.Columns,
		Rows:    result.Rows,
		Total:   result.Total,
		HasMore: result.HasMore,
	}
	for _, g := range result.Groups {
		qr.Groups = append(qr.Groups, GroupResult{Key: g.Key, Count: g.Count})
	}
	tracing.Record(ctx, tracing.Event{Kind: tracing.KindDQL, Query: dql, HitCount: result.Total})
	return qr, nil
}

func (b *LocalBackend) Versions(ctx context.Context, path string) ([]Version, error) {
	if err := b.init(); err != nil {
		return nil, err
	}
	vers, err := b.stack.Versioner.Log(ctx, path)
	if err != nil {
		return nil, err
	}
	out := make([]Version, len(vers))
	for i, v := range vers {
		out[i] = Version{Hash: v.Hash, Date: v.Date, Author: v.Author, Message: v.Message}
	}
	tracing.Record(ctx, tracing.Event{Kind: tracing.KindVersions, Path: path, HitCount: len(out)})
	return out, nil
}

func (b *LocalBackend) BulkWrite(ctx context.Context, files []BulkFile, actor, provenance string) (map[string]string, error) {
	if err := b.init(); err != nil {
		return nil, err
	}
	pipeFiles := make([]struct {
		Path    string
		Content []byte
	}, len(files))
	for i, f := range files {
		body := []byte(f.Content)
		if provType, provID, ok := pipeline.ParseProvenanceHeader(provenance); ok {
			injected, perr := pipeline.InjectProvenance(body, provType, provID, actor)
			if perr != nil {
				return nil, fmt.Errorf("provenance on %s: %w", f.Path, perr)
			}
			body = injected
		}
		pipeFiles[i].Path = f.Path
		pipeFiles[i].Content = body
	}
	results, err := b.stack.Pipeline.BulkWrite(ctx, pipeFiles, actor, "")
	if err != nil {
		return nil, err
	}
	etags := make(map[string]string, len(results))
	for _, r := range results {
		etags[r.Path] = r.ETag
	}
	return etags, nil
}

func (b *LocalBackend) Aggregate(ctx context.Context, groupBy, calc, where, pathPrefix string) (map[string]map[string]any, error) {
	if err := b.init(); err != nil {
		return nil, err
	}
	sq, ok := b.stack.Searcher.(*search.SQLite)
	if !ok {
		return nil, fmt.Errorf("aggregate requires sqlite search backend")
	}

	calcs, err := parseCalcSpecsLocal(calc)
	if err != nil {
		return nil, err
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("SELECT json_extract(frontmatter, '$.%s') AS grp", groupBy))
	for _, cs := range calcs {
		switch cs.fn {
		case "count":
			sb.WriteString(", COUNT(*) AS agg_count")
		case "avg":
			sb.WriteString(fmt.Sprintf(", AVG(json_extract(frontmatter, '$.%s'))", cs.field))
		case "sum":
			sb.WriteString(fmt.Sprintf(", SUM(json_extract(frontmatter, '$.%s'))", cs.field))
		case "min":
			sb.WriteString(fmt.Sprintf(", MIN(json_extract(frontmatter, '$.%s'))", cs.field))
		case "max":
			sb.WriteString(fmt.Sprintf(", MAX(json_extract(frontmatter, '$.%s'))", cs.field))
		}
	}
	sb.WriteString(" FROM file_meta")

	var conditions []string
	var args []any
	if pathPrefix != "" {
		conditions = append(conditions, "path LIKE ? || '%'")
		args = append(args, pathPrefix)
	}
	if where != "" {
		conditions = append(conditions, where)
	}
	if len(conditions) > 0 {
		sb.WriteString(" WHERE " + strings.Join(conditions, " AND "))
	}
	sb.WriteString(fmt.Sprintf(" GROUP BY json_extract(frontmatter, '$.%s')", groupBy))

	rows, err := sq.ReadDB().QueryContext(ctx, sb.String(), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	groups := make(map[string]map[string]any)
	cols, _ := rows.Columns()
	for rows.Next() {
		vals := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		key := fmt.Sprint(vals[0])
		if key == "<nil>" {
			key = "(none)"
		}
		bucket := make(map[string]any)
		for i, cs := range calcs {
			bucket[cs.label()] = vals[i+1]
		}
		groups[key] = bucket
	}
	return groups, rows.Err()
}

type localCalcSpec struct {
	fn    string
	field string
}

func (cs localCalcSpec) label() string {
	if cs.field == "" {
		return cs.fn
	}
	return cs.fn + ":" + cs.field
}

func parseCalcSpecsLocal(raw string) ([]localCalcSpec, error) {
	if raw == "" {
		return []localCalcSpec{{fn: "count"}}, nil
	}
	parts := strings.Split(raw, ",")
	specs := make([]localCalcSpec, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if p == "count" {
			specs = append(specs, localCalcSpec{fn: "count"})
			continue
		}
		fn, field, ok := strings.Cut(p, ":")
		if !ok || field == "" {
			return nil, fmt.Errorf("invalid calc %q", p)
		}
		specs = append(specs, localCalcSpec{fn: fn, field: field})
	}
	if len(specs) == 0 {
		return []localCalcSpec{{fn: "count"}}, nil
	}
	return specs, nil
}

func (b *LocalBackend) Backlinks(ctx context.Context, path string) ([]Backlink, error) {
	if err := b.init(); err != nil {
		return nil, err
	}
	if b.stack.Linker == nil {
		return []Backlink{}, nil
	}
	entries, err := b.stack.Linker.Backlinks(ctx, path)
	if err != nil {
		return nil, err
	}
	out := make([]Backlink, len(entries))
	for i, e := range entries {
		out[i] = Backlink{Path: e.Path, Count: e.Count}
	}
	return out, nil
}

func (b *LocalBackend) PublicURL() string {
	if b.stack == nil {
		return ""
	}
	return b.stack.Config.ResolvedPublicURL()
}

func (b *LocalBackend) ResolveWikiLinks(ctx context.Context, content string) string {
	if b.stack == nil || b.stack.LinkResolver == nil {
		return content
	}
	publicURL := b.stack.Config.ResolvedPublicURL()
	resolved := b.stack.LinkResolver.Resolve(ctx, content, publicURL)
	tracing.Record(ctx, tracing.Event{Kind: tracing.KindLinkResolve, Detail: "wiki-links resolved"})
	return resolved
}

func (b *LocalBackend) Analytics(ctx context.Context, scope string, staleThreshold int) (json.RawMessage, error) {
	if err := b.init(); err != nil {
		return nil, err
	}
	sq, ok := b.stack.Searcher.(*search.SQLite)
	if !ok {
		return nil, fmt.Errorf("analytics requires sqlite search backend")
	}
	resp, err := buildLocalAnalytics(ctx, sq, b.stack.JanitorSched, scope, staleThreshold)
	if err != nil {
		return nil, err
	}
	return json.Marshal(resp)
}

func (b *LocalBackend) MemoryReport(ctx context.Context, episodesPrefix string, limit, offset int) (json.RawMessage, error) {
	if err := b.init(); err != nil {
		return nil, err
	}
	opt := memory.Options{}
	if episodesPrefix != "" {
		opt.EpisodesPathPrefix = episodesPrefix
	} else if b.stack.Config != nil && b.stack.Config.Memory.EpisodesPathPrefix != "" {
		opt.EpisodesPathPrefix = b.stack.Config.Memory.EpisodesPathPrefix
	}
	opt.Limit = limit
	opt.Offset = offset
	rep, err := memory.Scan(ctx, b.stack.Store, opt)
	if err != nil {
		return nil, err
	}
	return json.Marshal(rep)
}

func (b *LocalBackend) HealthCheckPage(ctx context.Context, path string) (json.RawMessage, error) {
	if err := b.init(); err != nil {
		return nil, err
	}
	sq, ok := b.stack.Searcher.(*search.SQLite)
	if !ok {
		return nil, fmt.Errorf("health check requires sqlite search backend")
	}
	resp, err := buildLocalHealthCheck(ctx, sq, b.stack.JanitorSched, path)
	if err != nil {
		return nil, err
	}
	return json.Marshal(resp)
}

func (b *LocalBackend) Context(_ context.Context) (string, string, string, string, error) {
	read := func(rel string) string {
		data, err := os.ReadFile(filepath.Join(b.root, rel))
		if err != nil {
			return ""
		}
		return string(data)
	}
	return read("SCHEMA.md"), read(filepath.Join(".kiwi", "playbook.md")), read("index.md"), read(filepath.Join(".kiwi", "rules.md")), nil
}

func (b *LocalBackend) Clip(ctx context.Context, url, title string, tags []string, folder string) (*ClipResultMCP, error) {
	if err := b.init(); err != nil {
		return nil, err
	}

	clipReq := clipper.ClipRequest{
		URL:    url,
		Title:  title,
		Tags:   tags,
		Folder: folder,
	}

	result, content, err := clipper.Clip(ctx, clipReq, nil)
	if err != nil {
		return nil, fmt.Errorf("clip: %w", err)
	}

	actor := "mcp-agent"
	_, writeErr := b.stack.Pipeline.Write(ctx, result.Path, []byte(content), actor)
	if writeErr != nil {
		return nil, fmt.Errorf("write: %w", writeErr)
	}

	return &ClipResultMCP{
		Path:    result.Path,
		Title:   result.Title,
		Excerpt: result.Excerpt,
	}, nil
}

func (b *LocalBackend) Health(_ context.Context) error {
	return b.init()
}

func (b *LocalBackend) Close() error {
	if b.stack != nil {
		return b.stack.Close()
	}
	return nil
}

type localEngagementStats struct {
	TotalViews     int                       `json:"total_views"`
	TopViewed      []search.PageViewStat     `json:"top_viewed"`
	FailedSearches []search.FailedSearchStat `json:"failed_searches"`
}

type localAnalytics struct {
	TotalPages int                  `json:"total_pages"`
	TotalWords int                  `json:"total_words"`
	Health     localHealthStats     `json:"health"`
	Coverage   localCoverageStats   `json:"coverage"`
	TopUpdated []localPageStat      `json:"top_updated"`
	Engagement localEngagementStats `json:"engagement"`
}

type localIssueGroup struct {
	Count int      `json:"count"`
	Paths []string `json:"paths,omitempty"`
}

type localHealthStats struct {
	Stale         localIssueGroup `json:"stale"`
	Orphans       localIssueGroup `json:"orphans"`
	BrokenLinks   localIssueGroup `json:"broken_links"`
	Empty         localIssueGroup `json:"empty"`
	NoFrontmatter localIssueGroup `json:"no_frontmatter"`
}

type localCoverageStats struct {
	PagesWithLinks    int     `json:"pages_with_links"`
	PagesWithoutLinks int     `json:"pages_without_links"`
	AvgLinksPerPage   float64 `json:"avg_links_per_page"`
}

type localPageStat struct {
	Path      string `json:"path"`
	UpdatedAt string `json:"updated_at"`
}

func buildLocalAnalytics(ctx context.Context, sq *search.SQLite, sched *janitor.Scheduler, scope string, staleThreshold int) (*localAnalytics, error) {
	db := sq.ReadDB()
	resp := &localAnalytics{}

	scopeSQL := ""
	var scopeArgs []any
	if scope != "" {
		scopeSQL = " WHERE path LIKE ? || '%'"
		scopeArgs = append(scopeArgs, scope)
	}

	var totalWordsNull *float64
	err := db.QueryRowContext(ctx,
		`SELECT COUNT(*), SUM(json_extract(frontmatter, '$._word_count')) FROM file_meta`+scopeSQL,
		scopeArgs...,
	).Scan(&resp.TotalPages, &totalWordsNull)
	if err != nil {
		return nil, err
	}
	if totalWordsNull != nil {
		resp.TotalWords = int(*totalWordsNull)
	}

	if sd, ok := interface{}(sq).(search.StaleDetector); ok {
		stale, serr := sd.StalePages(ctx, staleThreshold)
		if serr == nil {
			for _, s := range stale {
				if scope == "" || localHasPrefix(s.Path, scope) {
					resp.Health.Stale.Count++
					resp.Health.Stale.Paths = append(resp.Health.Stale.Paths, s.Path)
				}
			}
		}
	}

	if sched != nil {
		if scan := sched.LastResult(); scan != nil {
			for _, issue := range scan.Issues {
				if scope != "" && !localHasPrefix(issue.Path, scope) {
					continue
				}
				switch issue.Kind {
				case janitor.IssueOrphan:
					resp.Health.Orphans.Count++
					resp.Health.Orphans.Paths = append(resp.Health.Orphans.Paths, issue.Path)
				case janitor.IssueBrokenLink:
					resp.Health.BrokenLinks.Count++
					resp.Health.BrokenLinks.Paths = append(resp.Health.BrokenLinks.Paths, issue.Path)
				case janitor.IssueEmptyPage:
					resp.Health.Empty.Count++
					resp.Health.Empty.Paths = append(resp.Health.Empty.Paths, issue.Path)
				}
			}
		}
	}

	nfSQL := `SELECT COUNT(*) FROM file_meta WHERE json_extract(frontmatter, '$._has_frontmatter') = 0 OR json_extract(frontmatter, '$._has_frontmatter') IS NULL`
	if scope != "" {
		nfSQL += ` AND path LIKE ? || '%'`
	}
	var nfCount int
	if scope != "" {
		_ = db.QueryRowContext(ctx, nfSQL, scope).Scan(&nfCount)
	} else {
		_ = db.QueryRowContext(ctx, nfSQL).Scan(&nfCount)
	}
	resp.Health.NoFrontmatter = localIssueGroup{Count: nfCount}

	buildLocalCoverage(ctx, db, scopeSQL, scopeArgs, resp)

	topSQL := `SELECT path, updated_at FROM file_meta` + scopeSQL + ` ORDER BY updated_at DESC LIMIT 10`
	rows, err := db.QueryContext(ctx, topSQL, scopeArgs...)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var path, updatedAt string
			if rows.Scan(&path, &updatedAt) == nil {
				resp.TopUpdated = append(resp.TopUpdated, localPageStat{Path: path, UpdatedAt: updatedAt})
			}
		}
	}

	if resp.TopUpdated == nil {
		resp.TopUpdated = []localPageStat{}
	}
	if resp.Health.Stale.Paths == nil {
		resp.Health.Stale.Paths = []string{}
	}
	if resp.Health.Orphans.Paths == nil {
		resp.Health.Orphans.Paths = []string{}
	}
	if resp.Health.BrokenLinks.Paths == nil {
		resp.Health.BrokenLinks.Paths = []string{}
	}
	if resp.Health.Empty.Paths == nil {
		resp.Health.Empty.Paths = []string{}
	}

	eng, err := buildLocalEngagement(ctx, sq, scope)
	if err != nil {
		return nil, err
	}
	resp.Engagement = eng

	return resp, nil
}

func buildLocalEngagement(ctx context.Context, sq *search.SQLite, scope string) (localEngagementStats, error) {
	eng := localEngagementStats{
		TopViewed:      []search.PageViewStat{},
		FailedSearches: []search.FailedSearchStat{},
	}
	if pv, ok := interface{}(sq).(search.PageViewRecorder); ok {
		total, err := pv.PageViewTotal(ctx, scope, 0)
		if err != nil {
			return eng, err
		}
		eng.TotalViews = total
		top, err := pv.PageViews(ctx, 50, "", 0)
		if err != nil {
			return eng, err
		}
		if top == nil {
			top = []search.PageViewStat{}
		}
		if scope != "" {
			filtered := top[:0]
			for _, v := range top {
				if localHasPrefix(v.Path, scope) {
					filtered = append(filtered, v)
				}
			}
			top = filtered
		}
		if len(top) > 10 {
			top = top[:10]
		}
		eng.TopViewed = top
	}
	if fr, ok := interface{}(sq).(search.FailedSearchRecorder); ok {
		failed, err := fr.FailedSearches(ctx, 10, 0)
		if err != nil {
			return eng, err
		}
		if failed == nil {
			failed = []search.FailedSearchStat{}
		}
		eng.FailedSearches = failed
	}
	return eng, nil
}

func buildLocalCoverage(ctx context.Context, db *sql.DB, scopeSQL string, scopeArgs []any, resp *localAnalytics) {
	row := db.QueryRowContext(ctx,
		`SELECT
			COUNT(CASE WHEN COALESCE(json_extract(frontmatter, '$._link_count'), 0) > 0 THEN 1 END),
			COUNT(CASE WHEN COALESCE(json_extract(frontmatter, '$._link_count'), 0) = 0 THEN 1 END),
			COALESCE(AVG(json_extract(frontmatter, '$._link_count')), 0)
		FROM file_meta`+scopeSQL,
		scopeArgs...,
	)
	_ = row.Scan(&resp.Coverage.PagesWithLinks, &resp.Coverage.PagesWithoutLinks, &resp.Coverage.AvgLinksPerPage)
}

func localHasPrefix(s, prefix string) bool {
	return len(s) >= len(prefix) && s[:len(prefix)] == prefix
}

type localHealthCheck struct {
	Path            string   `json:"path"`
	WordCount       int      `json:"word_count"`
	LinkCount       int      `json:"link_count"`
	BacklinkCount   int      `json:"backlink_count"`
	DaysSinceUpdate float64  `json:"days_since_update"`
	QualityScore    *float64 `json:"quality_score,omitempty"`
	Issues          []string `json:"issues"`
}

func buildLocalHealthCheck(ctx context.Context, sq *search.SQLite, sched *janitor.Scheduler, path string) (*localHealthCheck, error) {
	db := sq.ReadDB()
	resp := &localHealthCheck{Path: path, Issues: []string{}}

	var fm string
	var updatedAt string
	err := db.QueryRowContext(ctx,
		`SELECT frontmatter, updated_at FROM file_meta WHERE path = ?`, path,
	).Scan(&fm, &updatedAt)
	if err != nil {
		return resp, nil
	}

	var parsed map[string]any
	if json.Unmarshal([]byte(fm), &parsed) == nil {
		if v, ok := parsed["_word_count"]; ok {
			resp.WordCount = localToInt(v)
		}
		if v, ok := parsed["_link_count"]; ok {
			resp.LinkCount = localToInt(v)
		}
		if v, ok := parsed["_backlink_count"]; ok {
			resp.BacklinkCount = localToInt(v)
		}
		if v, ok := parsed["_quality_score"]; ok {
			f := localToFloat64(v)
			resp.QualityScore = &f
		}
	}

	if updatedAt != "" {
		if t, err := time.Parse(time.RFC3339, updatedAt); err == nil {
			resp.DaysSinceUpdate = time.Since(t).Hours() / 24
		}
	}

	if sched != nil {
		if scan := sched.LastResult(); scan != nil {
			for _, issue := range scan.Issues {
				if issue.Path == path {
					resp.Issues = append(resp.Issues, issue.Kind+": "+issue.Message)
				}
			}
		}
	}
	return resp, nil
}

func localToInt(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case int64:
		return int(n)
	}
	return 0
}

func localToFloat64(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	case int64:
		return float64(n)
	}
	return 0
}

func formatSize(bytes int64) string {
	switch {
	case bytes >= 1024*1024:
		return fmt.Sprintf("%.1f MB", float64(bytes)/1024/1024)
	case bytes >= 1024:
		return fmt.Sprintf("%.1f KB", float64(bytes)/1024)
	default:
		return fmt.Sprintf("%d B", bytes)
	}
}

func (b *LocalBackend) Suggestions(ctx context.Context, path string, limit int) ([]SuggestionResult, error) {
	if err := b.init(); err != nil {
		return nil, err
	}
	if b.stack.Vectors == nil {
		return nil, fmt.Errorf("semantic search is not enabled")
	}

	content, err := b.stack.Store.Read(ctx, path)
	if err != nil {
		return nil, err
	}

	results, serr := b.stack.Vectors.Search(ctx, string(content), 20)
	if serr != nil {
		return nil, serr
	}

	linked := make(map[string]bool)
	linked[path] = true
	if b.stack.Linker != nil {
		edges, _ := b.stack.Linker.AllEdges(ctx)
		for _, e := range edges {
			if e.Source == path {
				linked[e.Target] = true
			}
			if e.Target == path {
				linked[e.Source] = true
			}
		}
		backlinks, _ := b.stack.Linker.Backlinks(ctx, path)
		for _, bl := range backlinks {
			linked[bl.Path] = true
		}
	}

	if limit <= 0 {
		limit = 10
	}
	var out []SuggestionResult
	for _, r := range results {
		if linked[r.Path] {
			continue
		}
		out = append(out, SuggestionResult{
			Target:     r.Path,
			Similarity: r.Score,
			Snippet:    r.Snippet,
		})
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}

func (b *LocalBackend) Embeddings(ctx context.Context, path string) (*EmbeddingsResult, error) {
	if err := b.init(); err != nil {
		return nil, err
	}
	if b.stack.Vectors == nil {
		return nil, fmt.Errorf("semantic search is not enabled")
	}

	chunks, err := b.stack.Vectors.GetVectors(ctx, path)
	if err != nil {
		return nil, err
	}
	if len(chunks) == 0 {
		return nil, fmt.Errorf("no embeddings found for %s", path)
	}

	out := &EmbeddingsResult{
		Path:   path,
		Model:  b.stack.Config.Search.Vector.Embedder.Model,
		Chunks: make([]EmbeddingChunk, len(chunks)),
	}
	for i, c := range chunks {
		out.Chunks[i] = EmbeddingChunk{
			ChunkIdx: c.ChunkIdx,
			Text:     c.Text,
			Vector:   c.Vector,
		}
		if i == 0 && len(c.Vector) > 0 {
			out.Dimensions = len(c.Vector)
		}
	}
	return out, nil
}

func (b *LocalBackend) Peek(ctx context.Context, path string) (*PeekResult, error) {
	if err := b.init(); err != nil {
		return nil, err
	}
	raw, err := b.stack.Store.Read(ctx, path)
	if err != nil {
		return nil, err
	}
	content := raw

	_, body, _ := markdown.SplitFrontmatter(content)
	if body == nil {
		body = content
	}

	parsed, _ := markdown.Parse(content)

	title := ""
	if parsed != nil && len(parsed.Headings) > 0 {
		title = parsed.Headings[0].Text
	}
	if title == "" {
		title = filepath.Base(path)
	}

	snippet := extractFirstParagraph(body, 300)

	linksOut := links.Extract(body)
	linksOut = links.Unique(linksOut)
	if linksOut == nil {
		linksOut = []string{}
	}

	var linksIn []string
	if b.stack.Linker != nil {
		entries, _ := b.stack.Linker.Backlinks(ctx, path)
		for _, e := range entries {
			linksIn = append(linksIn, e.Path)
		}
	}
	if linksIn == nil {
		linksIn = []string{}
	}

	var headings []string
	if parsed != nil {
		for _, h := range parsed.Headings {
			headings = append(headings, h.Text)
		}
	}
	if headings == nil {
		headings = []string{}
	}

	var fm json.RawMessage
	if parsed != nil && len(parsed.Frontmatter) > 0 {
		fm, _ = json.Marshal(parsed.Frontmatter)
	}

	wordCount := len(strings.Fields(string(body)))

	return &PeekResult{
		Path:        path,
		Title:       title,
		Frontmatter: fm,
		Snippet:     snippet,
		LinksOut:    linksOut,
		LinksIn:     linksIn,
		WordCount:   wordCount,
		Headings:    headings,
	}, nil
}

func (b *LocalBackend) Section(ctx context.Context, path, heading string, index int) (*SectionResult, error) {
	if err := b.init(); err != nil {
		return nil, err
	}
	raw, err := b.stack.Store.Read(ctx, path)
	if err != nil {
		return nil, err
	}

	_, body, _ := markdown.SplitFrontmatter(raw)
	if body == nil {
		body = raw
	}

	var section *markdown.Section
	if heading != "" {
		section, err = markdown.ExtractSection(body, heading)
	} else {
		section, err = markdown.ExtractSectionByIndex(body, index)
	}
	if err != nil {
		return nil, err
	}

	return &SectionResult{
		Path:      path,
		Heading:   section.Heading,
		Level:     section.Level,
		Content:   section.Content,
		LineStart: section.LineStart,
		LineEnd:   section.LineEnd,
	}, nil
}

func (b *LocalBackend) GraphWalk(ctx context.Context, path string, includeSiblings bool) (*GraphWalkResult, error) {
	if err := b.init(); err != nil {
		return nil, err
	}

	raw, err := b.stack.Store.Read(ctx, path)
	if err != nil {
		return nil, err
	}

	_, body, _ := markdown.SplitFrontmatter(raw)
	if body == nil {
		body = raw
	}

	result := &GraphWalkResult{Path: path}

	outLinks := links.Extract(body)
	result.LinksOut = links.Unique(outLinks)
	if result.LinksOut == nil {
		result.LinksOut = []string{}
	}
	result.OutDegree = len(result.LinksOut)

	if b.stack.Linker != nil {
		entries, _ := b.stack.Linker.Backlinks(ctx, path)
		for _, e := range entries {
			result.LinksIn = append(result.LinksIn, e.Path)
		}
	}
	if result.LinksIn == nil {
		result.LinksIn = []string{}
	}
	result.InDegree = len(result.LinksIn)

	if includeSiblings {
		dir := filepath.Dir(path)
		var fileTags []string
		fm, _ := markdown.Frontmatter(raw)
		if fm != nil {
			fileTags = extractTagsFromMap(fm)
		}

		_ = storage.Walk(ctx, b.stack.Store, "/", func(e storage.Entry) error {
			if e.Path == path {
				return nil
			}
			if filepath.Dir(e.Path) == dir {
				result.Siblings = append(result.Siblings, Neighbor{
					Path:     e.Path,
					Relation: "sibling_dir",
				})
			}
			if len(fileTags) > 0 {
				raw2, err2 := b.stack.Store.Read(ctx, e.Path)
				if err2 == nil {
					fm2, _ := markdown.Frontmatter(raw2)
					if fm2 != nil {
						otherTags := extractTagsFromMap(fm2)
						for _, ft := range fileTags {
							for _, ot := range otherTags {
								if strings.EqualFold(ft, ot) {
									result.Siblings = append(result.Siblings, Neighbor{
										Path:      e.Path,
										Relation:  "sibling_tag",
										SharedTag: ft,
									})
								}
							}
						}
					}
				}
			}
			return nil
		})
	}
	if result.Siblings == nil {
		result.Siblings = []Neighbor{}
	}

	if b.stack.Linker != nil {
		edges, _ := b.stack.Linker.AllEdges(ctx)
		if len(edges) > 0 {
			nodeSet := make(map[string]struct{})
			inCount := 0
			for _, e := range edges {
				nodeSet[e.Source] = struct{}{}
				nodeSet[e.Target] = struct{}{}
				for _, form := range links.TargetForms(path) {
					if strings.EqualFold(e.Target, form) {
						inCount++
						break
					}
				}
			}
			if len(nodeSet) > 0 {
				result.HubScore = float64(inCount) / float64(len(nodeSet))
			}
		}
	}

	return result, nil
}

func extractTagsFromMap(fm map[string]any) []string {
	val, ok := fm["tags"]
	if !ok {
		val, ok = fm["labels"]
	}
	if !ok {
		return nil
	}
	switch v := val.(type) {
	case []any:
		tags := make([]string, 0, len(v))
		for _, item := range v {
			if s, ok := item.(string); ok && s != "" {
				tags = append(tags, s)
			}
		}
		return tags
	case string:
		if v != "" {
			return []string{v}
		}
	}
	return nil
}

func collectClusterTags(ctx context.Context, members []string, store storage.Storage) []string {
	tagCount := make(map[string]int)
	for _, m := range members {
		raw, err := store.Read(ctx, m)
		if err != nil {
			continue
		}
		fm, _ := markdown.Frontmatter(raw)
		if fm == nil {
			continue
		}
		for _, tag := range extractTagsFromMap(fm) {
			tagCount[tag]++
		}
	}
	type tc struct {
		tag   string
		count int
	}
	var sorted []tc
	for t, c := range tagCount {
		sorted = append(sorted, tc{t, c})
	}
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].count > sorted[j].count })
	maxTags := 5
	result := make([]string, 0, maxTags)
	for i, s := range sorted {
		if i >= maxTags {
			break
		}
		result = append(result, s.tag)
	}
	return result
}

func (b *LocalBackend) GraphAnalytics(ctx context.Context, limit int) (*GraphAnalyticsResult, error) {
	if err := b.init(); err != nil {
		return nil, err
	}
	if b.stack.Linker == nil {
		return nil, fmt.Errorf("link indexing is not enabled")
	}

	edges, err := b.stack.Linker.AllEdges(ctx)
	if err != nil {
		return nil, err
	}

	r := graphutil.Analyze(edges, limit)
	topPages := make([]PageRankEntry, len(r.TopPages))
	for i, p := range r.TopPages {
		topPages[i] = PageRankEntry{
			Path:      p.Path,
			PageRank:  p.PageRank,
			InDegree:  p.InDegree,
			OutDegree: p.OutDegree,
		}
	}

	var clusters []Cluster
	components := graphutil.FindComponents(edges)
	for id, members := range components {
		if len(members) < 2 {
			continue
		}
		cl := Cluster{
			ID:      id,
			Size:    len(members),
			Pages:   members,
			TopPage: graphutil.FindTopInCluster(members, edges),
		}
		cl.Keywords = collectClusterTags(ctx, members, b.stack.Store)
		clusters = append(clusters, cl)
	}
	sort.Slice(clusters, func(i, j int) bool {
		return clusters[i].Size > clusters[j].Size
	})
	if len(clusters) > limit {
		clusters = clusters[:limit]
	}
	if clusters == nil {
		clusters = []Cluster{}
	}

	var bridges []Bridge
	betweenness := graphutil.ComputeBetweenness(edges)
	for path, score := range betweenness {
		if score > 0.01 {
			bridges = append(bridges, Bridge{Path: path, Betweenness: score})
		}
	}
	sort.Slice(bridges, func(i, j int) bool {
		return bridges[i].Betweenness > bridges[j].Betweenness
	})
	if len(bridges) > limit {
		bridges = bridges[:limit]
	}
	if bridges == nil {
		bridges = []Bridge{}
	}

	return &GraphAnalyticsResult{
		TotalNodes:           r.TotalNodes,
		TotalEdges:           r.TotalEdges,
		Components:           r.Components,
		TopPages:             topPages,
		Orphans:              r.Orphans,
		LargestComponentSize: r.LargestComponentSize,
		Clusters:             clusters,
		Bridges:              bridges,
	}, nil
}

func (b *LocalBackend) GraphCentrality(ctx context.Context, limit int) (*GraphCentralityResult, error) {
	if err := b.init(); err != nil {
		return nil, err
	}
	if b.stack.Linker == nil {
		return nil, fmt.Errorf("link indexing is not enabled")
	}

	edges, err := b.stack.Linker.AllEdges(ctx)
	if err != nil {
		return nil, err
	}

	entries := graphutil.Centrality(edges)
	if limit > 0 && limit < len(entries) {
		entries = entries[:limit]
	}

	pages := make([]CentralityEntry, len(entries))
	for i, e := range entries {
		pages[i] = CentralityEntry{
			Path:        e.Path,
			PageRank:    e.PageRank,
			Betweenness: e.Betweenness,
			InDegree:    e.InDegree,
			OutDegree:   e.OutDegree,
		}
	}

	return &GraphCentralityResult{Pages: pages}, nil
}

func (b *LocalBackend) GraphCommunities(ctx context.Context) (*GraphCommunitiesResult, error) {
	if err := b.init(); err != nil {
		return nil, err
	}
	if b.stack.Linker == nil {
		return nil, fmt.Errorf("link indexing is not enabled")
	}

	edges, err := b.stack.Linker.AllEdges(ctx)
	if err != nil {
		return nil, err
	}

	communities := graphutil.CommunitiesFromEdges(edges)
	groups := make([]CommunityGroup, len(communities))
	for i, c := range communities {
		groups[i] = CommunityGroup{
			ID:    c.ID,
			Pages: c.Pages,
		}
	}

	return &GraphCommunitiesResult{Communities: groups}, nil
}

func (b *LocalBackend) GraphPath(ctx context.Context, from, to string) (*GraphPathResult, error) {
	if err := b.init(); err != nil {
		return nil, err
	}
	if b.stack.Linker == nil {
		return nil, fmt.Errorf("link indexing is not enabled")
	}

	edges, err := b.stack.Linker.AllEdges(ctx)
	if err != nil {
		return nil, err
	}

	path, err := graphutil.ShortestPathFromEdges(edges, from, to)
	if err != nil {
		return nil, err
	}

	return &GraphPathResult{Path: path}, nil
}

func (b *LocalBackend) Velocity(ctx context.Context, period string, limit int, pathPrefix string) (*VelocityResult, error) {
	if err := b.init(); err != nil {
		return nil, err
	}

	if period == "" {
		period = "30d"
	}
	if limit <= 0 {
		limit = 20
	}

	sinceArg := "--since=" + parsePeriod(period)

	cmd := exec.CommandContext(ctx, "git", "log", "--numstat", "--format=%H|%an|%at", sinceArg)
	cmd.Dir = b.root
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git log: %w", err)
	}

	type fileChange struct {
		adds, dels int
		authors    map[string]bool
		timestamps []time.Time
	}
	files := make(map[string]*fileChange)
	var currentAuthor string
	var currentTime time.Time

	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if strings.Contains(line, "|") && !strings.Contains(line, "\t") {
			parts := strings.SplitN(line, "|", 3)
			if len(parts) >= 3 {
				currentAuthor = parts[1]
				ts, _ := strconv.ParseInt(parts[2], 10, 64)
				currentTime = time.Unix(ts, 0)
			}
			continue
		}
		parts := strings.Split(line, "\t")
		if len(parts) != 3 {
			continue
		}
		adds, _ := strconv.Atoi(parts[0])
		dels, _ := strconv.Atoi(parts[1])
		path := parts[2]
		if !strings.HasSuffix(path, ".md") {
			continue
		}
		if pathPrefix != "" && !strings.HasPrefix(path, pathPrefix) {
			continue
		}
		fc, ok := files[path]
		if !ok {
			fc = &fileChange{authors: make(map[string]bool)}
			files[path] = fc
		}
		fc.adds += adds
		fc.dels += dels
		fc.authors[currentAuthor] = true
		fc.timestamps = append(fc.timestamps, currentTime)
	}

	type scored struct {
		path    string
		changes int
		authors int
		lines   int
	}
	var items []scored
	totalChanges := 0
	for path, fc := range files {
		changes := len(fc.timestamps)
		totalChanges += changes
		items = append(items, scored{
			path:    path,
			changes: changes,
			authors: len(fc.authors),
			lines:   fc.adds + fc.dels,
		})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].changes > items[j].changes })

	topN := limit
	if topN > len(items) {
		topN = len(items)
	}
	hotSpots := make([]HotSpotEntry, topN)
	for i := 0; i < topN; i++ {
		hotSpots[i] = HotSpotEntry{
			Path:         items[i].path,
			Changes:      items[i].changes,
			Authors:      items[i].authors,
			LinesChanged: items[i].lines,
		}
	}

	// Cold spots: files not touched in the period
	var coldSpots []ColdSpotEntry
	walkErr := storage.Walk(ctx, b.stack.Store, "/", func(e storage.Entry) error {
		if !strings.HasSuffix(e.Path, ".md") {
			return nil
		}
		if pathPrefix != "" && !strings.HasPrefix(e.Path, pathPrefix) {
			return nil
		}
		if _, ok := files[e.Path]; !ok {
			coldSpots = append(coldSpots, ColdSpotEntry{Path: e.Path, DaysSinceChange: parsePeriodDays(period)})
		}
		return nil
	})
	if walkErr != nil {
		return nil, walkErr
	}

	// Burst detection: files with >3x average change rate in last 7 days
	var bursts []BurstEntry
	sevenDaysAgo := time.Now().AddDate(0, 0, -7)
	periodDays := parsePeriodDays(period)
	for _, item := range items {
		fc := files[item.path]
		recentCount := 0
		for _, ts := range fc.timestamps {
			if ts.After(sevenDaysAgo) {
				recentCount++
			}
		}
		recentRate := float64(recentCount) / 7.0
		avgRate := float64(item.changes) / float64(periodDays)
		if avgRate > 0 && recentRate > 3*avgRate {
			bursts = append(bursts, BurstEntry{
				Path:       item.path,
				RecentRate: recentRate,
				AvgRate:    avgRate,
			})
		}
	}

	// Single-author pages
	var singleAuthor []string
	for path, fc := range files {
		if len(fc.authors) == 1 {
			singleAuthor = append(singleAuthor, path)
		}
	}

	if hotSpots == nil {
		hotSpots = []HotSpotEntry{}
	}
	if coldSpots == nil {
		coldSpots = []ColdSpotEntry{}
	}
	if bursts == nil {
		bursts = []BurstEntry{}
	}
	if singleAuthor == nil {
		singleAuthor = []string{}
	}

	return &VelocityResult{
		Period:            period,
		TotalChanges:      totalChanges,
		HotSpots:          hotSpots,
		ColdSpots:         coldSpots,
		Bursts:            bursts,
		SingleAuthorPages: singleAuthor,
	}, nil
}

func parsePeriod(period string) string {
	period = strings.TrimSpace(period)
	if strings.HasSuffix(period, "d") {
		return period[:len(period)-1] + " days ago"
	}
	if strings.HasSuffix(period, "w") {
		return period[:len(period)-1] + " weeks ago"
	}
	if strings.HasSuffix(period, "m") {
		return period[:len(period)-1] + " months ago"
	}
	return "30 days ago"
}

func parsePeriodDays(period string) int {
	period = strings.TrimSpace(period)
	if strings.HasSuffix(period, "d") {
		n, _ := strconv.Atoi(period[:len(period)-1])
		if n > 0 {
			return n
		}
	}
	if strings.HasSuffix(period, "w") {
		n, _ := strconv.Atoi(period[:len(period)-1])
		if n > 0 {
			return n * 7
		}
	}
	if strings.HasSuffix(period, "m") {
		n, _ := strconv.Atoi(period[:len(period)-1])
		if n > 0 {
			return n * 30
		}
	}
	return 30
}

func (b *LocalBackend) Eval(ctx context.Context, queries []EvalQuery) (*EvalResult, error) {
	if err := b.init(); err != nil {
		return nil, err
	}

	topK := 5
	var ftsHitCount, semHitCount int
	var ftsMRRSum, semMRRSum float64
	var ftsPrecSum, semPrecSum float64
	perQuery := make([]EvalQueryResult, len(queries))

	for i, q := range queries {
		expected := make(map[string]bool, len(q.ExpectedPaths))
		for _, p := range q.ExpectedPaths {
			expected[p] = true
		}

		pq := EvalQueryResult{
			Question:     q.Question,
			FTSHits:      []string{},
			SemanticHits: []string{},
		}

		// FTS search
		ftsResults, _ := b.stack.Searcher.Search(ctx, q.Question, topK, 0, "")
		ftsRank := 0
		ftsPrec := 0
		for j, r := range ftsResults {
			if expected[r.Path] {
				pq.FTSHits = append(pq.FTSHits, r.Path)
				if ftsRank == 0 {
					ftsRank = j + 1
				}
				ftsPrec++
			}
		}
		pq.FTSRank = ftsRank
		if ftsRank > 0 {
			ftsHitCount++
			ftsMRRSum += 1.0 / float64(ftsRank)
		}
		if len(ftsResults) > 0 {
			ftsPrecSum += float64(ftsPrec) / float64(len(ftsResults))
		}

		// Semantic search
		if b.stack.Vectors != nil {
			semResults, _ := b.stack.Vectors.Search(ctx, q.Question, topK)
			semRank := 0
			semPrec := 0
			for j, r := range semResults {
				if expected[r.Path] {
					pq.SemanticHits = append(pq.SemanticHits, r.Path)
					if semRank == 0 {
						semRank = j + 1
					}
					semPrec++
				}
			}
			pq.SemanticRank = semRank
			if semRank > 0 {
				semHitCount++
				semMRRSum += 1.0 / float64(semRank)
			}
			if len(semResults) > 0 {
				semPrecSum += float64(semPrec) / float64(len(semResults))
			}
		}

		perQuery[i] = pq
	}

	total := float64(len(queries))
	if total == 0 {
		total = 1
	}

	return &EvalResult{
		FTS: EvalMetrics{
			HitRate:      float64(ftsHitCount) / total,
			MRR:          ftsMRRSum / total,
			PrecisionAtK: ftsPrecSum / total,
		},
		Semantic: EvalMetrics{
			HitRate:      float64(semHitCount) / total,
			MRR:          semMRRSum / total,
			PrecisionAtK: semPrecSum / total,
		},
		PerQuery: perQuery,
	}, nil
}

func (b *LocalBackend) Eligible(ctx context.Context, limit int, pathPrefix string) (*QueryResult, error) {
	if err := b.init(); err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 10
	}
	dql := fmt.Sprintf(
		`TABLE _path, title, priority, assignee WHERE type = "task" AND status = "todo" AND _blocked = false SORT priority ASC, _updated ASC LIMIT %d`,
		limit)
	if pathPrefix != "" {
		pathPrefix = sanitizePathPrefix(pathPrefix)
		dql = fmt.Sprintf(
			`TABLE _path, title, priority, assignee WHERE type = "task" AND status = "todo" AND _blocked = false AND _path LIKE "%s%%" SORT priority ASC, _updated ASC LIMIT %d`,
			pathPrefix, limit)
	}
	return b.QueryDQL(ctx, dql, limit, 0)
}

func (b *LocalBackend) Claim(ctx context.Context, path, claimedBy string, leaseDuration time.Duration) (*claims.Claim, error) {
	if err := b.init(); err != nil {
		return nil, err
	}
	if b.stack.ClaimStore == nil {
		return nil, fmt.Errorf("claims not enabled")
	}
	return b.stack.ClaimStore.Claim(ctx, path, claimedBy, leaseDuration)
}

func (b *LocalBackend) Release(ctx context.Context, path, claimedBy string) error {
	if err := b.init(); err != nil {
		return err
	}
	if b.stack.ClaimStore == nil {
		return fmt.Errorf("claims not enabled")
	}
	return b.stack.ClaimStore.Release(ctx, path, claimedBy)
}

func (b *LocalBackend) ListClaims(ctx context.Context) ([]claims.Claim, error) {
	if err := b.init(); err != nil {
		return nil, err
	}
	if b.stack.ClaimStore == nil {
		return nil, fmt.Errorf("claims not enabled")
	}
	return b.stack.ClaimStore.ListActive(ctx)
}

func (b *LocalBackend) Timeline(ctx context.Context, limit, offset int, actor, eventType, pathPrefix string) (*TimelineResult, error) {
	if err := b.init(); err != nil {
		return nil, err
	}

	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}
	if offset < 0 {
		offset = 0
	}

	// Fetch more than needed to account for filtering
	fetchLimit := (limit + offset) * 3
	if fetchLimit > 1000 {
		fetchLimit = 1000
	}

	// Run git log with --name-status to get files changed in each commit
	args := []string{
		"log",
		"--pretty=format:COMMIT:%H|%aI|%an|%s",
		"--name-status",
		"-n", strconv.Itoa(fetchLimit),
		"--",
	}

	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = b.root

	out, err := cmd.Output()
	if err != nil {
		// Handle empty repo gracefully
		if exitErr, ok := err.(*exec.ExitError); ok {
			stderr := string(exitErr.Stderr)
			if strings.Contains(stderr, "does not have any commits") ||
				strings.Contains(stderr, "bad default revision") ||
				strings.Contains(stderr, "unknown revision") {
				return &TimelineResult{Events: []TimelineEvent{}}, nil
			}
		}
		return nil, fmt.Errorf("git log: %w", err)
	}

	events, err := b.parseTimelineLog(string(out), actor, eventType, pathPrefix)
	if err != nil {
		return nil, err
	}

	total := len(events)

	// Apply offset and limit
	if offset >= len(events) {
		events = []TimelineEvent{}
	} else {
		events = events[offset:]
		if len(events) > limit {
			events = events[:limit]
		}
	}

	return &TimelineResult{Events: events, Total: total}, nil
}

func (b *LocalBackend) parseTimelineLog(output, actorFilter, typeFilter, pathPrefix string) ([]TimelineEvent, error) {
	lines := strings.Split(strings.TrimSpace(output), "\n")
	var events []TimelineEvent

	var currentCommit struct {
		hash      string
		timestamp string
		author    string
		subject   string
	}

	for _, line := range lines {
		if line == "" {
			continue
		}

		// Check if this is a commit line
		if strings.HasPrefix(line, "COMMIT:") {
			// Parse commit header: COMMIT:<hash>|<timestamp>|<author>|<subject>
			parts := strings.SplitN(line[7:], "|", 4)
			if len(parts) < 4 {
				continue
			}
			currentCommit.hash = parts[0]
			currentCommit.timestamp = parts[1]
			currentCommit.author = parts[2]
			currentCommit.subject = parts[3]
			continue
		}

		// This is a file change line: <status>\t<path>
		fields := strings.Split(line, "\t")
		if len(fields) < 2 {
			continue
		}

		status := fields[0]
		path := fields[1]

		// Skip files in .kiwi directory
		if strings.HasPrefix(path, ".kiwi/") {
			continue
		}

		// Apply path prefix filter
		if pathPrefix != "" && !strings.HasPrefix(path, pathPrefix) {
			continue
		}

		// Determine event type from git status
		var eventType string
		switch status[0] {
		case 'A', 'M': // Added or Modified
			eventType = "write"
		case 'D': // Deleted
			eventType = "delete"
		case 'R': // Renamed - treat as write to new location
			eventType = "write"
			// For renames, git shows R100\told\tnew, use the new name
			if len(fields) > 2 {
				path = fields[2]
			}
		case 'C': // Copied - treat as write
			eventType = "write"
			if len(fields) > 2 {
				path = fields[2]
			}
		default:
			continue
		}

		// Apply filters
		if actorFilter != "" && currentCommit.author != actorFilter {
			continue
		}
		if typeFilter != "" && eventType != typeFilter {
			continue
		}

		// Parse timestamp to ensure it's valid
		timestamp := currentCommit.timestamp
		if t, err := time.Parse(time.RFC3339, timestamp); err == nil {
			timestamp = t.Format(time.RFC3339)
		}

		events = append(events, TimelineEvent{
			Type:      eventType,
			Path:      path,
			Actor:     currentCommit.author,
			Timestamp: timestamp,
			Message:   currentCommit.subject,
		})
	}

	return events, nil
}

func (b *LocalBackend) ViewsList(ctx context.Context) ([]ViewInfo, error) {
	if err := b.init(); err != nil {
		return nil, err
	}

	viewsDir := filepath.Join(b.root, ".kiwi", "views")
	entries, err := os.ReadDir(viewsDir)
	if os.IsNotExist(err) {
		return []ViewInfo{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read views dir: %w", err)
	}

	var views []ViewInfo
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		name := strings.TrimSuffix(entry.Name(), ".json")
		view, err := b.ViewsGet(ctx, name)
		if err != nil {
			continue
		}
		views = append(views, *view)
	}
	return views, nil
}

func (b *LocalBackend) ViewsGet(ctx context.Context, name string) (*ViewInfo, error) {
	if err := b.init(); err != nil {
		return nil, err
	}

	path := filepath.Join(b.root, ".kiwi", "views", name+".json")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read view: %w", err)
	}

	var view ViewInfo
	if err := json.Unmarshal(data, &view); err != nil {
		return nil, fmt.Errorf("parse view: %w", err)
	}
	view.Name = name
	return &view, nil
}

func (b *LocalBackend) ViewsSave(ctx context.Context, view ViewInfo) error {
	if err := b.init(); err != nil {
		return err
	}

	viewsDir := filepath.Join(b.root, ".kiwi", "views")
	if err := os.MkdirAll(viewsDir, 0755); err != nil {
		return fmt.Errorf("create views dir: %w", err)
	}

	data, err := json.MarshalIndent(view, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal view: %w", err)
	}

	path := filepath.Join(viewsDir, view.Name+".json")
	if err := os.WriteFile(path, data, 0644); err != nil {
		return fmt.Errorf("write view: %w", err)
	}
	return nil
}

func (b *LocalBackend) ViewsDelete(_ context.Context, name string) error {
	if err := b.init(); err != nil {
		return err
	}

	viewsDir := filepath.Join(b.root, ".kiwi", "views")
	path := filepath.Join(viewsDir, name+".json")
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("delete view: %w", err)
	}
	return nil
}

func (b *LocalBackend) Feed(ctx context.Context, limit int) (json.RawMessage, error) {
	if err := b.init(); err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	// Fetch recent timeline events and convert to feed entries
	result, err := b.Timeline(ctx, limit, 0, "", "write", "")
	if err != nil {
		return nil, err
	}

	type feedEntry struct {
		Path      string `json:"path"`
		Title     string `json:"title"`
		Timestamp string `json:"timestamp"`
		Actor     string `json:"actor"`
		Message   string `json:"message"`
	}

	entries := make([]feedEntry, 0, len(result.Events))
	seen := make(map[string]bool)
	for _, e := range result.Events {
		if seen[e.Path] {
			continue
		}
		seen[e.Path] = true
		title := strings.TrimSuffix(filepath.Base(e.Path), filepath.Ext(e.Path))
		entries = append(entries, feedEntry{
			Path:      e.Path,
			Title:     title,
			Timestamp: e.Timestamp,
			Actor:     e.Actor,
			Message:   e.Message,
		})
	}

	return json.Marshal(map[string]any{"items": entries, "total": len(entries)})
}

func (b *LocalBackend) ViewsExecute(ctx context.Context, name string, limit, offset int) (*QueryResult, error) {
	if err := b.init(); err != nil {
		return nil, err
	}

	view, err := b.ViewsGet(ctx, name)
	if err != nil {
		return nil, err
	}

	if b.dvExec == nil {
		return nil, fmt.Errorf("dataview executor not available")
	}

	dvResult, err := b.dvExec.Query(ctx, view.Query, limit, offset)
	if err != nil {
		return nil, err
	}

	// Convert dataview.QueryResult to mcpserver.QueryResult
	qr := &QueryResult{
		Columns: dvResult.Columns,
		Rows:    dvResult.Rows,
		Total:   dvResult.Total,
		HasMore: dvResult.HasMore,
	}
	for _, g := range dvResult.Groups {
		qr.Groups = append(qr.Groups, GroupResult{Key: g.Key, Count: g.Count})
	}
	return qr, nil
}

func (b *LocalBackend) CanvasList(ctx context.Context) ([]string, error) {
	if err := b.init(); err != nil {
		return nil, err
	}

	var canvases []string
	err := storage.Walk(ctx, b.stack.Store, "/", func(e storage.Entry) error {
		if !e.IsDir && strings.HasSuffix(strings.ToLower(e.Path), ".canvas.json") {
			canvases = append(canvases, e.Path)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if canvases == nil {
		canvases = []string{}
	}
	return canvases, nil
}

func (b *LocalBackend) CanvasRead(ctx context.Context, path string) (string, error) {
	if err := b.init(); err != nil {
		return "", err
	}

	if !strings.HasSuffix(strings.ToLower(path), ".canvas.json") {
		return "", fmt.Errorf("path must end with .canvas.json")
	}

	content, err := b.stack.Store.Read(ctx, path)
	if err != nil {
		return "", err
	}

	// Validate it's valid JSON with nodes and edges
	var data map[string]any
	if err := json.Unmarshal(content, &data); err != nil {
		return "", fmt.Errorf("invalid JSON: %w", err)
	}

	return string(content), nil
}

func (b *LocalBackend) CanvasWrite(ctx context.Context, path, content, actor string) (string, error) {
	if err := b.init(); err != nil {
		return "", err
	}

	if !strings.HasSuffix(strings.ToLower(path), ".canvas.json") {
		return "", fmt.Errorf("path must end with .canvas.json")
	}

	// Validate JSON structure
	var data map[string]any
	if err := json.Unmarshal([]byte(content), &data); err != nil {
		return "", fmt.Errorf("invalid JSON: %w", err)
	}

	// Ensure nodes and edges exist
	if _, ok := data["nodes"]; !ok {
		data["nodes"] = []any{}
	}
	if _, ok := data["edges"]; !ok {
		data["edges"] = []any{}
	}

	// Re-marshal to ensure clean structure
	cleanContent, err := json.Marshal(data)
	if err != nil {
		return "", err
	}

	if actor == "" {
		actor = "mcp-agent"
	}

	res, err := b.stack.Pipeline.Write(ctx, path, cleanContent, actor)
	if err != nil {
		return "", err
	}
	return res.ETag, nil
}

func (b *LocalBackend) WorkflowList(_ context.Context) ([]WorkflowDef, error) {
	if err := b.init(); err != nil {
		return nil, err
	}
	workflows, err := workflow.Load(b.root)
	if err != nil {
		return nil, err
	}
	result := make([]WorkflowDef, 0, len(workflows))
	for _, w := range workflows {
		result = append(result, workflowToMCP(w))
	}
	return result, nil
}

func (b *LocalBackend) WorkflowGet(_ context.Context, name string) (*WorkflowDef, error) {
	if err := b.init(); err != nil {
		return nil, err
	}
	w, err := workflow.Get(b.root, name)
	if err != nil {
		return nil, err
	}
	def := workflowToMCP(w)
	return &def, nil
}

func (b *LocalBackend) WorkflowSave(_ context.Context, w WorkflowDef) error {
	if err := b.init(); err != nil {
		return err
	}
	return workflow.Save(b.root, mcpToWorkflow(w))
}

func (b *LocalBackend) WorkflowAdvance(ctx context.Context, path, targetState, actor string) (*WorkflowAdvanceResult, error) {
	if err := b.init(); err != nil {
		return nil, err
	}
	if actor == "" {
		actor = "mcp-agent"
	}

	// Read current page
	content, _, err := b.ReadFile(ctx, path)
	if err != nil {
		return nil, err
	}

	fm, err := markdown.Frontmatter([]byte(content))
	if err != nil || fm == nil {
		return nil, fmt.Errorf("page has no frontmatter")
	}

	wfName, _ := fm["workflow"].(string)
	currentState, _ := fm["state"].(string)
	if wfName == "" {
		return nil, fmt.Errorf("page has no 'workflow' field")
	}
	if currentState == "" {
		return nil, fmt.Errorf("page has no 'state' field")
	}

	w, err := workflow.Get(b.root, wfName)
	if err != nil {
		return nil, fmt.Errorf("workflow %q not found: %w", wfName, err)
	}

	if err := workflow.ValidateTransition(w, currentState, targetState); err != nil {
		return nil, err
	}

	// Update frontmatter
	fmRaw, body, err := markdown.SplitFrontmatter([]byte(content))
	if err != nil || len(fmRaw) == 0 {
		return nil, fmt.Errorf("cannot split frontmatter")
	}
	fm["state"] = targetState
	newFM, err := yamlMarshal(fm)
	if err != nil {
		return nil, fmt.Errorf("marshal frontmatter: %w", err)
	}

	var buf strings.Builder
	buf.WriteString("---\n")
	buf.Write(newFM)
	buf.WriteString("---\n")
	buf.Write(body)

	etag, err := b.WriteFile(ctx, path, buf.String(), actor, "")
	if err != nil {
		return nil, err
	}

	return &WorkflowAdvanceResult{
		Path:      path,
		FromState: currentState,
		ToState:   targetState,
		ETag:      etag,
	}, nil
}

func (b *LocalBackend) WorkflowBoard(ctx context.Context, workflowName string) (*WorkflowBoardResult, error) {
	if err := b.init(); err != nil {
		return nil, err
	}

	w, err := workflow.Get(b.root, workflowName)
	if err != nil {
		return nil, err
	}

	board := make(map[string][]map[string]any)
	for _, s := range w.States {
		board[s.Name] = []map[string]any{}
	}

	tree, err := b.Tree(ctx, "/")
	if err != nil {
		return nil, err
	}

	// Parse tree to get file paths, then check each markdown file
	var allPaths []string
	extractPaths(tree, &allPaths)

	for _, p := range allPaths {
		if !strings.HasSuffix(p, ".md") {
			continue
		}
		content, _, err := b.ReadFile(ctx, p)
		if err != nil {
			continue
		}
		fm, err := markdown.Frontmatter([]byte(content))
		if err != nil || fm == nil {
			continue
		}
		pageWF, _ := fm["workflow"].(string)
		pageState, _ := fm["state"].(string)
		if pageWF != workflowName || pageState == "" {
			continue
		}
		entry := map[string]any{
			"path":  p,
			"state": pageState,
		}
		if title, ok := fm["title"].(string); ok {
			entry["title"] = title
		}
		if priority, ok := fm["priority"]; ok {
			entry["priority"] = priority
		}
		board[pageState] = append(board[pageState], entry)
	}

	wfDef := workflowToMCP(w)
	return &WorkflowBoardResult{
		Workflow: wfDef,
		Board:    board,
	}, nil
}

// extractPaths walks a tree JSON and collects all file paths.
func extractPaths(tree json.RawMessage, paths *[]string) {
	var root struct {
		Children []struct {
			Name     string          `json:"name"`
			Path     string          `json:"path"`
			IsDir    bool            `json:"isDir"`
			Children json.RawMessage `json:"children"`
		} `json:"children"`
	}
	if err := json.Unmarshal(tree, &root); err != nil {
		return
	}
	for _, c := range root.Children {
		if c.IsDir && len(c.Children) > 0 {
			extractPaths(c.Children, paths)
		} else if !c.IsDir {
			*paths = append(*paths, c.Path)
		}
	}
}

func workflowToMCP(w workflow.Workflow) WorkflowDef {
	def := WorkflowDef{Name: w.Name}
	for _, s := range w.States {
		def.States = append(def.States, WorkflowState{
			Name: s.Name, Color: s.Color, Terminal: s.Terminal,
		})
	}
	for _, t := range w.Transitions {
		def.Transitions = append(def.Transitions, WorkflowTransition{
			From: t.From, To: t.To, RequiredRole: t.RequiredRole,
		})
	}
	return def
}

func mcpToWorkflow(def WorkflowDef) workflow.Workflow {
	w := workflow.Workflow{Name: def.Name}
	for _, s := range def.States {
		w.States = append(w.States, workflow.State{
			Name: s.Name, Color: s.Color, Terminal: s.Terminal,
		})
	}
	for _, t := range def.Transitions {
		w.Transitions = append(w.Transitions, workflow.Transition{
			From: t.From, To: t.To, RequiredRole: t.RequiredRole,
		})
	}
	return w
}

// yamlMarshal is a thin wrapper to serialize a map to YAML bytes.
func yamlMarshal(m map[string]any) ([]byte, error) {
	// Use gopkg.in/yaml.v3 via encoding round-trip
	// Since local.go doesn't import yaml.v3, we use JSON as intermediary
	// which is safe for simple key-value frontmatter.
	jdata, err := json.Marshal(m)
	if err != nil {
		return nil, err
	}
	// Convert JSON to a compact YAML-like format: "key: value\n"
	var parsed map[string]any
	if err := json.Unmarshal(jdata, &parsed); err != nil {
		return nil, err
	}

	var buf strings.Builder
	keys := make([]string, 0, len(parsed))
	for k := range parsed {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		v := parsed[k]
		switch val := v.(type) {
		case string:
			buf.WriteString(k + ": " + val + "\n")
		case float64:
			if val == float64(int(val)) {
				buf.WriteString(fmt.Sprintf("%s: %d\n", k, int(val)))
			} else {
				buf.WriteString(fmt.Sprintf("%s: %g\n", k, val))
			}
		case bool:
			buf.WriteString(fmt.Sprintf("%s: %t\n", k, val))
		case nil:
			buf.WriteString(k + ":\n")
		default:
			jv, _ := json.Marshal(val)
			buf.WriteString(k + ": " + string(jv) + "\n")
		}
	}
	return []byte(buf.String()), nil
}
