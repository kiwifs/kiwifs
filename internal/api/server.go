package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/kiwifs/kiwifs/internal/analytics"
	"github.com/kiwifs/kiwifs/internal/claims"
	"github.com/kiwifs/kiwifs/internal/comments"
	"github.com/kiwifs/kiwifs/internal/config"
	"github.com/kiwifs/kiwifs/internal/dataview"
	"github.com/kiwifs/kiwifs/internal/draft"
	"github.com/kiwifs/kiwifs/internal/events"
	"github.com/kiwifs/kiwifs/internal/importer"
	"github.com/kiwifs/kiwifs/internal/janitor"
	"github.com/kiwifs/kiwifs/internal/links"
	"github.com/kiwifs/kiwifs/internal/pipeline"
	"github.com/kiwifs/kiwifs/internal/rbac"
	"github.com/kiwifs/kiwifs/internal/search"
	"github.com/kiwifs/kiwifs/internal/tracing"
	"github.com/kiwifs/kiwifs/internal/vectorstore"
	"github.com/kiwifs/kiwifs/internal/webhooks"
	"github.com/kiwifs/kiwifs/internal/webui"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"golang.org/x/time/rate"

	"github.com/kiwifs/kiwifs/docs"
	echoSwagger "github.com/swaggo/echo-swagger"
)

type ServerOption func(*Server)

func WithWebhookStore(store *webhooks.Store) ServerOption {
	return func(s *Server) { s.webhookStore = store }
}

func WithClaimStore(store *claims.Store) ServerOption {
	return func(s *Server) { s.claimStore = store }
}

func WithSchemaReload(fn func()) ServerOption {
	return func(s *Server) { s.schemaReload = fn }
}

func WithDraftManager(mgr *draft.Manager) ServerOption {
	return func(s *Server) { s.draftMgr = mgr }
}

func WithAuditLogger(al *AuditLogger) ServerOption {
	return func(s *Server) { s.auditLogger = al }
}

func WithBackupStatus(fn func() any) ServerOption {
	return func(s *Server) { s.backupStatusFn = fn }
}

func WithProtocolHealth(probes []ProtocolHealthProbe) ServerOption {
	return func(s *Server) { s.protocolHealth = probes }
}

func (s *Server) SetBackupStatus(fn func() any) {
	s.backupStatusFn = fn
	if s.handlers != nil {
		s.handlers.backupStatusFn = fn
	}
}

func (s *Server) SetProtocolHealth(probes []ProtocolHealthProbe) {
	s.protocolHealth = probes
	if s.handlers != nil {
		s.handlers.protocolHealth = probes
	}
}

type ProtocolHealthProbe struct {
	Name    string
	Enabled bool
	Addr    string
	Port    int
	Check   func(context.Context) error
}

func NewTCPProtocolHealthProbe(name string, enabled bool, addr string, port int, timeout time.Duration) ProtocolHealthProbe {
	return ProtocolHealthProbe{
		Name:    name,
		Enabled: enabled,
		Addr:    addr,
		Port:    port,
		Check: func(ctx context.Context) error {
			dialer := net.Dialer{Timeout: timeout}
			conn, err := dialer.DialContext(ctx, "tcp", addr)
			if err != nil {
				return err
			}
			_ = conn.Close()
			return nil
		},
	}
}

type Server struct {
	cfg          *config.Config
	pipe         *pipeline.Pipeline
	vectors      *vectorstore.Service
	comments     *comments.Store
	shares       *rbac.ShareStore
	linkResolver *links.Resolver
	emitter      tracing.Emitter
	echo         *echo.Echo

	webhookStore   *webhooks.Store
	claimStore     *claims.Store
	draftMgr       *draft.Manager
	schemaReload   func()
	auditLogger    *AuditLogger
	backupStatusFn func() any
	protocolHealth []ProtocolHealthProbe
	handlers       *Handlers

	janitorSched  *janitor.Scheduler
	janitorCancel context.CancelFunc

	syncSched  *importer.SyncScheduler
	syncCancel context.CancelFunc

	analyticsWriter *analytics.Writer

	auth atomic.Pointer[liveAuth]
}

type liveAuth struct {
	typ     string
	global  string
	keys    []config.APIKeyEntry
	oidcMW  echo.MiddlewareFunc
	oidcIss string
}

func (s *Server) SetJanitorScheduler(sched *janitor.Scheduler) {
	s.janitorSched = sched
}

func NewServer(
	cfg *config.Config,
	pipe *pipeline.Pipeline,
	vectors *vectorstore.Service,
	cstore *comments.Store,
	shares *rbac.ShareStore,
	lr *links.Resolver,
	em tracing.Emitter,
	opts ...ServerOption,
) *Server {
	if em == nil {
		em = tracing.NoopEmitter{}
	}
	s := &Server{
		cfg:          cfg,
		pipe:         pipe,
		vectors:      vectors,
		comments:     cstore,
		shares:       shares,
		linkResolver: lr,
		emitter:      em,
		echo:         echo.New(),
	}
	for _, o := range opts {
		o(s)
	}
	s.echo.HideBanner = true
	s.echo.HidePort = true
	s.echo.HTTPErrorHandler = sanitizingErrorHandler
	s.setupMiddleware()
	s.setupRoutes()
	return s
}

func sanitizingErrorHandler(err error, c echo.Context) {
	if c.Response().Committed {
		return
	}
	code := http.StatusInternalServerError
	var public any = "internal server error"
	if he, ok := err.(*echo.HTTPError); ok {
		code = he.Code
		if code < 500 {
			public = he.Message
		} else {
			log.Printf("api 5xx %s %s: %v", c.Request().Method, c.Request().URL.Path, he.Message)
		}
	} else {
		log.Printf("api error %s %s: %v", c.Request().Method, c.Request().URL.Path, err)
	}
	if c.Request().Method == http.MethodHead {
		_ = c.NoContent(code)
		return
	}
	_ = c.JSON(code, map[string]any{"error": public})
}

func (s *Server) Hub() *events.Hub { return s.pipe.Hub }

func (s *Server) setupMiddleware() {
	s.echo.Use(middleware.LoggerWithConfig(middleware.LoggerConfig{
		Format: "${time_rfc3339} ${method} ${uri} ${status} ${latency_human} ${bytes_in}b in ${bytes_out}b out\n",
		Skipper: func(c echo.Context) bool {
			p := c.Path()
			return p == "/health" || p == "/healthz" || p == "/readyz" || p == "/metrics"
		},
	}))
	if s.cfg.Tracing.IsEnabled() {
		s.echo.Use(apiTracingMiddleware(s.emitter))
	}

	// B.6 — Config-driven CORS. If [server.cors] has allowed_origins,
	// use that. Otherwise fall back to [server.cors_origins] (legacy)
	// and the corsOriginAllowed() heuristic.
	corsAllowHeaders := []string{"Content-Type", "Authorization", "If-Match", "X-Actor", "X-Provenance"}
	corsExposeHeaders := []string{"ETag", "Last-Modified", "X-Permalink"}
	corsMethods := []string{http.MethodGet, http.MethodPut, http.MethodPost, http.MethodDelete, http.MethodOptions}

	corsCfg := s.cfg.Server.CORS
	if len(corsCfg.AllowedMethods) > 0 {
		corsMethods = corsCfg.AllowedMethods
	}
	maxAge := 3600
	if corsCfg.MaxAge > 0 {
		maxAge = corsCfg.MaxAge
	}

	corsConfig := middleware.CORSConfig{
		AllowOriginFunc: s.corsOriginAllowed,
		AllowMethods:    corsMethods,
		AllowHeaders:    corsAllowHeaders,
		ExposeHeaders:   corsExposeHeaders,
		MaxAge:          maxAge,
	}
	if corsCfg.AllowCredentials != nil {
		corsConfig.AllowCredentials = *corsCfg.AllowCredentials
	}
	s.echo.Use(middleware.CORSWithConfig(corsConfig))

	s.echo.Use(middleware.Recover())
	s.echo.Use(middleware.BodyLimit("110M"))

	// B.4 — Configurable rate limiting keyed on token hash (or IP for
	// unauthenticated requests). Only enabled when [server.rate_limit]
	// is explicitly configured with requests_per_minute > 0.
	if ratePerMin := s.cfg.Server.RateLimit.RequestsPerMinute; ratePerMin > 0 {
		burstSize := s.cfg.Server.RateLimit.BurstSize
		if burstSize <= 0 {
			burstSize = 50
		}
		ratePerSecond := float64(ratePerMin) / 60.0

		s.echo.Use(middleware.RateLimiterWithConfig(middleware.RateLimiterConfig{
			Skipper: func(c echo.Context) bool {
				p := c.Path()
				return p == "/health" || p == "/healthz" || p == "/readyz" || p == "/metrics"
			},
			Store: middleware.NewRateLimiterMemoryStoreWithConfig(middleware.RateLimiterMemoryStoreConfig{
				Rate:      rate.Limit(ratePerSecond),
				Burst:     burstSize,
				ExpiresIn: 3 * time.Minute,
			}),
			IdentifierExtractor: func(c echo.Context) (string, error) {
				if auth := c.Request().Header.Get("Authorization"); len(auth) > 7 {
					h := sha256.Sum256([]byte(auth[7:]))
					return fmt.Sprintf("tok:%x", h[:8]), nil
				}
				return c.RealIP(), nil
			},
			DenyHandler: func(c echo.Context, _ string, _ error) error {
				c.Response().Header().Set("Retry-After", "60")
				return echo.NewHTTPError(http.StatusTooManyRequests, "rate limit exceeded")
			},
		}))
	}

	// B.3 — Audit log middleware (after auth sets X-Actor).
	if s.auditLogger != nil {
		s.echo.Use(auditMiddleware(s.auditLogger))
	}
}

func (s *Server) authMiddleware() echo.MiddlewareFunc {
	s.installAuth(&s.cfg.Auth)
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			la := s.auth.Load()
			if la == nil {
				return next(c)
			}

			// B.1: visibility-based auth bypass for read requests.
			// Read live from s.cfg so that PUT /space/visibility
			// takes effect immediately without an auth reload.
			method := c.Request().Method
			if method == http.MethodGet || method == http.MethodHead {
				vis := s.cfg.Space.Visibility
				switch vis {
				case "public":
					// All reads are open
					c.Request().Header.Set("X-Actor", "anonymous")
					return next(c)
				case "unlisted":
					// Only direct file reads are open; tree/search/listing are auth-required
					p := c.Request().URL.Path
					isFileRead := strings.HasSuffix(p, "/file") || strings.HasSuffix(p, "/peek") || strings.HasSuffix(p, "/section")
					if isFileRead && c.QueryParam("path") != "" {
						c.Request().Header.Set("X-Actor", "anonymous")
						return next(c)
					}
				}
			}

			switch la.typ {
			case "apikey":
				if la.global == "" {
					return next(c)
				}
				return apiKeyHandler(la.global)(next)(c)
			case "perspace":
				if len(la.keys) == 0 {
					return next(c)
				}
				return perSpaceKeyHandler(la.keys)(next)(c)
			case "oidc":
				if la.oidcMW == nil {
					return next(c)
				}
				return la.oidcMW(next)(c)
			}
			return next(c)
		}
	}
}

func (s *Server) ReloadAuth(cfg *config.AuthConfig) {
	s.installAuth(cfg)
	log.Printf("auth: reloaded (type=%s)", cfg.Type)
}

func (s *Server) installAuth(cfg *config.AuthConfig) {
	next := &liveAuth{typ: cfg.Type, global: cfg.APIKey, keys: cfg.APIKeys, oidcIss: cfg.OIDC.Issuer}
	if cur := s.auth.Load(); cur != nil && cur.oidcIss == next.oidcIss && cur.oidcMW != nil {
		next.oidcMW = cur.oidcMW
	} else if cfg.Type == "oidc" && cfg.OIDC.Issuer != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		p, err := oidc.NewProvider(ctx, cfg.OIDC.Issuer)
		if err != nil {
			log.Printf("warning: OIDC provider setup failed (%v) — auth disabled", err)
		} else {
			verifier := p.Verifier(&oidc.Config{ClientID: cfg.OIDC.ClientID})
			next.oidcMW = oidcMiddleware(verifier)
		}
	}
	s.auth.Store(next)
}

func (s *Server) setupRoutes() {
	// Build the dataview executor, auto-indexer, and view registry if the
	// search backend is SQLite.
	var dvExec *dataview.Executor
	var viewReg *dataview.Registry
	if sq, ok := s.pipe.Searcher.(*search.SQLite); ok {
		readDB := sq.ReadDB()
		writeDB := sq.WriteDB()
		dvExec = dataview.NewExecutor(readDB)
		ai := dataview.NewAutoIndexer(writeDB, readDB, s.cfg.Dataview.MaxAutoIndexes)
		dvExec.SetAutoIndexer(ai)

		timeout, _ := time.ParseDuration(s.cfg.Dataview.QueryTimeout)
		if timeout == 0 {
			timeout = 5 * time.Second
		}
		maxRows := s.cfg.Dataview.MaxScanRows
		if maxRows == 0 {
			maxRows = 10000
		}
		dvExec.SetLimits(maxRows, timeout)

		viewReg = dataview.NewRegistry(dvExec, s.pipe.Store)
		_ = viewReg.Scan(context.Background())
	}

	connStore, err := importer.NewConnectionStore(s.pipe.Store.AbsPath(""))
	if err != nil {
		log.Printf("api: init connection store: %v (import connections disabled)", err)
	}

	// Initialize sync scheduler for auto-sync connections
	if connStore != nil {
		buildSrc := func(conn *importer.ConnectionMeta) (importer.Source, error) {
			return buildSourceFromConnection(conn)
		}
		s.syncSched = importer.NewSyncScheduler(connStore, s.pipe, buildSrc)
	}

	publishMetrics, pmErr := rbac.NewPublishMetricsStore(s.pipe.Store.AbsPath(""))
	if pmErr != nil {
		log.Printf("api: init publish metrics: %v (view counts disabled)", pmErr)
	}

	// Initialize analytics writer if SQLite backend is available.
	if sq, ok := s.pipe.Searcher.(*search.SQLite); ok {
		w := analytics.NewWriter(sq.WriteDB())
		s.analyticsWriter = w
	}

	h := &Handlers{
		store:                s.pipe.Store,
		versioner:            s.pipe.Versioner,
		searcher:             s.pipe.Searcher,
		linker:               s.pipe.Linker,
		hub:                  s.pipe.Hub,
		pipe:                 s.pipe,
		vectors:              s.vectors,
		dv:                   dvExec,
		viewReg:              viewReg,
		comments:             s.comments,
		shares:               s.shares,
		assets:               s.cfg.Assets,
		ui:                   s.cfg.UI,
		root:                 s.pipe.Store.AbsPath(""),
		janitorSched:         s.janitorSched,
		janitorStaleDays:     s.cfg.Janitor.StaleDays,
		memoryEpisodesPrefix: s.cfg.Memory.EpisodesPathPrefix,
		publicURL:            s.cfg.ResolvedPublicURL(),
		linkResolver:         s.linkResolver,
		webhookStore:         s.webhookStore,
		claimStore:           s.claimStore,
		draftMgr:             s.draftMgr,
		auditLogger:          s.auditLogger,
		cfg:                  s.cfg,
		connStore:            connStore,
		publishMetrics:       publishMetrics,
		schemaReload:         s.schemaReload,
		backupStatusFn:       s.backupStatusFn,
		protocolHealth:       s.protocolHealth,
		analyticsWriter:      s.analyticsWriter,
	}
	s.handlers = h
	prev := s.pipe.OnInvalidate
	s.pipe.OnInvalidate = func() {
		if prev != nil {
			prev()
		}
		h.invalidateGraphCache()
		h.invalidateMemoryCache()
	}

	if viewReg != nil {
		s.pipe.OnPathChange = func(path string) {
			viewReg.OnWrite(path)
		}
	}

	s.echo.GET("/health", h.Health)
	s.echo.GET("/healthz", h.Healthz)
	s.echo.GET("/readyz", h.Readyz)
	s.echo.GET("/metrics", h.Metrics)
	s.echo.GET("/api/docs", func(c echo.Context) error {
		return c.Redirect(http.StatusMovedPermanently, "/api/docs/index.html")
	})
	s.echo.GET("/api/docs/", func(c echo.Context) error {
		return c.Redirect(http.StatusMovedPermanently, "/api/docs/index.html")
	})
	s.echo.GET("/api/docs/*", echoSwagger.WrapHandler)
	s.echo.GET("/api/openapi.json", func(c echo.Context) error {
		doc := docs.SwaggerInfo.ReadDoc()
		return c.JSONBlob(http.StatusOK, []byte(doc))
	})

	api := s.echo.Group("/api/kiwi")
	if mw := s.authMiddleware(); mw != nil {
		api.Use(mw)
	}
	api.GET("/changes", h.Changes)
	api.GET("/tree", h.Tree)
	api.GET("/file", h.ReadFile)
	api.GET("/readlink", h.Readlink)
	api.PUT("/file", h.WriteFile)
	api.PATCH("/file/frontmatter", h.PatchFrontmatter)
	api.PATCH("/tree/order", h.PatchTreeOrder)
	api.DELETE("/file", h.DeleteFile)
	api.POST("/rename", h.RenameFile)
	api.POST("/rename-dir", h.RenameDir)
	api.POST("/bulk", h.BulkWrite)
	api.POST("/file/append", h.AppendFile)
	api.POST("/assets", h.UploadAsset)
	api.POST("/resolve-links", h.ResolveLinks)
	api.GET("/search", h.Search)
	api.GET("/search/verified", h.VerifiedSearch)
	api.POST("/search/semantic", h.SemanticSearch)
	api.GET("/search/semantic", h.SemanticSearch)
	api.GET("/meta", h.Meta)
	api.GET("/stale", h.StalePages)
	api.GET("/contradictions", h.Contradictions)
	api.GET("/versions", h.Versions)
	api.GET("/version", h.Version)
	api.GET("/diff", h.Diff)
	api.GET("/blame", h.Blame)
	api.GET("/events", h.Events)
	api.GET("/backlinks", h.Backlinks)
	api.GET("/graph", h.Graph)
	api.GET("/toc", h.ToC)
	api.GET("/templates", h.ListTemplates)
	api.GET("/template", h.ReadTemplate)
	api.GET("/comments", h.ListComments)
	api.POST("/comments", h.AddComment)
	api.DELETE("/comments/:id", h.DeleteComment)
	api.PATCH("/comments/:id", h.ResolveComment)
	api.GET("/theme", h.GetTheme)
	api.PUT("/theme", h.PutTheme)
	api.GET("/ui-config", h.UIConfig)
	api.GET("/janitor", h.Janitor)
	api.GET("/memory/report", h.MemoryReport)
	api.GET("/query", h.Query)
	api.GET("/query/aggregate", h.QueryAggregate)
	api.POST("/view/refresh", h.ViewRefresh)
	api.POST("/import", h.Import)
	api.POST("/import/upload", h.ImportUpload)
	api.POST("/import/browse", h.ImportBrowse)
	api.POST("/import/preview", h.ImportPreview)
	api.GET("/import/connections", h.ListConnections)
	api.POST("/import/connections", h.SaveConnection)
	api.DELETE("/import/connections/:id", h.DeleteConnection)
	api.POST("/import/connections/:id/run", h.RunConnection)
	api.POST("/import/connections/:id/sync", h.ToggleSync)
	api.GET("/import/sync/status", h.SyncStatus)
	api.GET("/import/sources", h.ImportSources)
	api.POST("/import/airbyte/spec", h.ImportAirbyteSpec)
	api.POST("/import/airbyte/check", h.ImportAirbyteCheck)
	api.POST("/import/airbyte/discover", h.ImportAirbyteDiscover)
	api.POST("/import/airbyte-cloud/check", h.ImportAirbyteCloudCheck)
	api.POST("/import/airbyte-cloud/discover", h.ImportAirbyteCloudDiscover)
	api.GET("/import/airbyte-cloud/connections", h.ImportAirbyteCloudConnections)
	api.POST("/import/airbyte-cloud/sync", h.ImportAirbyteCloudSync)
	api.GET("/export", h.Export)
	api.POST("/export/document", h.ExportDocument)
	api.GET("/analytics", h.Analytics)
	api.GET("/analytics/failed-searches", h.FailedSearches)
	api.GET("/analytics/views", h.PageViews)
	api.GET("/analytics/overview", h.AnalyticsOverview)
	api.GET("/analytics/views/v2", h.AnalyticsViews)
	api.GET("/analytics/searches", h.AnalyticsSearches)
	api.GET("/analytics/trends", h.AnalyticsTrends)
	api.GET("/analytics/content-gaps", h.AnalyticsContentGaps)
	api.POST("/analytics/content-gaps/dismiss", h.AnalyticsDismissContentGap)
	api.GET("/analytics/sources", h.AnalyticsSources)
	api.POST("/lint", h.Lint)
	api.GET("/health-check", h.HealthCheck)
	api.GET("/context", h.Context)
	api.GET("/rules", h.Rules)
	api.PUT("/rules", h.PutRules)
	api.GET("/suggestions", h.Suggestions)
	api.GET("/embeddings", h.Embeddings)
	api.GET("/graph/analytics", h.GraphAnalytics)
	api.GET("/graph/centrality", h.GraphCentrality)
	api.GET("/graph/communities", h.GraphCommunities)
	api.GET("/graph/path", h.GraphPath)
	api.POST("/clip", h.Clip)
	api.GET("/timeline", h.Timeline)
	api.GET("/feed.xml", h.FeedAtom)
	api.GET("/feed.json", h.FeedJSON)
	api.GET("/backup/status", h.BackupStatus)
	api.GET("/sync/status", h.BackupStatus)
	api.GET("/peek", h.Peek)
	api.GET("/section", h.SectionRead)
	api.GET("/graph/walk", h.GraphWalk)
	api.POST("/ingest", h.Ingest)
	api.GET("/velocity", h.Velocity)
	api.POST("/eval", h.Eval)
	api.POST("/webhooks", h.CreateWebhook)
	api.GET("/webhooks", h.ListWebhooks)
	api.DELETE("/webhooks/:id", h.DeleteWebhook)
	api.GET("/schemas", h.ListSchemas)
	api.GET("/schemas/:type", h.GetSchema)
	api.PUT("/schemas/:type", h.PutSchema)

	api.POST("/claim", h.ClaimTask)
	api.DELETE("/claim", h.ReleaseTask)
	api.GET("/claims", h.ListClaims)

	api.POST("/share", h.CreateShareLink)
	api.GET("/share", h.ListShareLinks)
	api.DELETE("/share/:id", h.RevokeShareLink)

	// Publish lifecycle endpoints
	api.POST("/publish", h.Publish)
	api.POST("/publish/bulk", h.PublishBulk)
	api.POST("/unpublish", h.Unpublish)
	api.POST("/unpublish/bulk", h.UnpublishBulk)
	api.GET("/publish/status", h.PublishStatus)
	api.GET("/publish/list", h.PublishedPages)

	// B.1: Space info & visibility endpoints
	api.GET("/space/info", h.SpaceInfo)
	api.PUT("/space/visibility", h.UpdateVisibility)

	// B.3: Audit log endpoint
	api.GET("/audit", h.AuditEndpoint)

	// Views (Bases) endpoints
	api.GET("/views", h.ListViews)
	api.GET("/views/:name", h.GetView)
	api.PUT("/views/:name", h.SaveView)
	api.DELETE("/views/:name", h.DeleteView)
	api.GET("/views/:name/execute", h.ExecuteView)

	// Canvas endpoints
	api.GET("/canvases", h.ListCanvas)
	api.GET("/canvas", h.ReadCanvas)
	api.PUT("/canvas", h.WriteCanvas)
	api.DELETE("/canvas", h.DeleteCanvas)
	api.PATCH("/canvas", h.PatchCanvas)
	api.GET("/canvas/query", h.QueryCanvas)
	api.POST("/canvas/auto-layout", h.AutoLayoutCanvas)
	api.POST("/canvas/generate", h.GenerateCanvas)

	// Workflow endpoints
	api.GET("/workflows", h.ListWorkflows)
	api.GET("/workflows/:name", h.GetWorkflow)
	api.PUT("/workflows/:name", h.SaveWorkflow)
	api.DELETE("/workflows/:name", h.DeleteWorkflow)
	api.POST("/workflow/assign", h.AssignWorkflow)
	api.POST("/workflow/advance", h.AdvanceWorkflow)
	api.POST("/workflow/reorder", h.ReorderCard)
	api.GET("/workflow/board/:workflow", h.WorkflowBoard)

	draftGrp := api.Group("/drafts")
	draftGrp.POST("", h.CreateDraft)
	draftGrp.GET("", h.ListDrafts)
	draftGrp.GET("/:id", h.GetDraft)
	draftGrp.GET("/:id/diff", h.DraftDiff)
	draftGrp.POST("/:id/merge", h.MergeDraft)
	draftGrp.DELETE("/:id", h.DiscardDraft)
	draftGrp.GET("/:id/file", h.DraftReadFile)
	draftGrp.PUT("/:id/file", h.DraftWriteFile)
	draftGrp.DELETE("/:id/file", h.DraftDeleteFile)
	draftGrp.GET("/:id/tree", h.DraftTree)

	s.echo.GET("/api/kiwi/public/:token", h.PublicPage)
	s.echo.GET("/api/kiwi/public/file", h.PublicFile)
	s.echo.GET("/api/kiwi/public/tree", h.PublicTree)

	s.echo.GET("/p/*", h.PublishedPage)

	s.echo.GET("/raw/*", h.ServeRawFile)

	uiHandler := webui.Handler()
	s.echo.GET("/", uiHandler)
	s.echo.GET("/*", uiHandler)
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.echo.ServeHTTP(w, r)
}

func (s *Server) Start(addr string) error {
	if s.janitorSched != nil {
		ctx, cancel := context.WithCancel(context.Background())
		s.janitorCancel = cancel
		s.janitorSched.Start(ctx)
	}
	if s.syncSched != nil {
		ctx, cancel := context.WithCancel(context.Background())
		s.syncCancel = cancel
		s.syncSched.Start(ctx)
	}
	if s.analyticsWriter != nil {
		s.analyticsWriter.Start()
	}
	return s.echo.Start(addr)
}

func (s *Server) Shutdown(ctx context.Context) error {
	if s.janitorCancel != nil {
		s.janitorCancel()
	}
	if s.janitorSched != nil {
		s.janitorSched.Stop()
	}
	if s.syncCancel != nil {
		s.syncCancel()
	}
	if s.syncSched != nil {
		s.syncSched.Stop()
	}
	// Flush remaining analytics events before the DB connection closes.
	if s.analyticsWriter != nil {
		s.analyticsWriter.Stop()
	}
	return s.echo.Shutdown(ctx)
}

func (s *Server) corsOriginAllowed(origin string) (bool, error) {
	if isLoopbackOrigin(origin) {
		return true, nil
	}
	if s.cfg.Auth.Type == "" || s.cfg.Auth.Type == "none" {
		return false, nil
	}
	// B.6: merge [server.cors].allowed_origins with legacy cors_origins.
	// If either list contains explicit entries, check against both.
	corsOrigins := s.cfg.Server.CORS.AllowedOrigins
	legacyOrigins := s.cfg.Server.CORSOrigins
	hasExplicit := len(corsOrigins) > 0 || len(legacyOrigins) > 0
	if hasExplicit {
		for _, allowed := range corsOrigins {
			if allowed == "*" {
				return true, nil
			}
			if origin == allowed {
				return true, nil
			}
		}
		for _, allowed := range legacyOrigins {
			if origin == allowed {
				return true, nil
			}
		}
		return false, nil
	}
	return true, nil
}

func isLoopbackOrigin(origin string) bool {
	for _, p := range []string{
		"http://localhost", "https://localhost",
		"http://127.0.0.1", "https://127.0.0.1",
		"http://[::1]", "https://[::1]",
	} {
		if origin == p || strings.HasPrefix(origin, p+":") {
			return true
		}
	}
	return false
}

func apiKeyMiddleware(key string) echo.MiddlewareFunc {
	return apiKeyHandler(key)
}

func apiKeyHandler(key string) echo.MiddlewareFunc {
	expected := []byte("Bearer " + key)
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			got := []byte(c.Request().Header.Get("Authorization"))
			if subtle.ConstantTimeCompare(got, expected) != 1 {
				return echo.NewHTTPError(http.StatusUnauthorized, "invalid API key")
			}
			return next(c)
		}
	}
}

func perSpaceKeyMiddleware(keys []config.APIKeyEntry) echo.MiddlewareFunc {
	return perSpaceKeyHandler(keys)
}

func perSpaceKeyHandler(keys []config.APIKeyEntry) echo.MiddlewareFunc {
	type entry struct {
		hash   [32]byte
		space  string
		actor  string
		scope  string // B.2: read | write | admin (default: admin)
		prefix string // B.2: path prefix restriction
	}
	km := make(map[[32]byte]entry, len(keys))
	for _, k := range keys {
		h := sha256.Sum256([]byte(k.Key))
		scope := k.Scope
		if scope == "" {
			scope = "admin"
		}
		km[h] = entry{hash: h, space: k.Space, actor: k.Actor, scope: scope, prefix: k.Prefix}
	}
	inScope := func(space, path string) bool {
		if space == "" || path == "" {
			return true
		}
		return path == space || strings.HasPrefix(path, space+"/")
	}
	// B.2: check path prefix restriction
	inPrefix := func(prefix, path string) bool {
		if prefix == "" || path == "" {
			return true
		}
		return path == prefix || strings.HasPrefix(path, prefix)
	}
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			auth := c.Request().Header.Get("Authorization")
			raw, ok := strings.CutPrefix(auth, "Bearer ")
			if !ok || raw == "" {
				return echo.NewHTTPError(http.StatusUnauthorized, "missing bearer token")
			}
			incoming := sha256.Sum256([]byte(raw))
			e, ok := km[incoming]
			if !ok || subtle.ConstantTimeCompare(incoming[:], e.hash[:]) != 1 {
				return echo.NewHTTPError(http.StatusUnauthorized, "invalid API key")
			}

			// B.2: enforce scope — read tokens can only GET/HEAD
			method := c.Request().Method
			switch e.scope {
			case "read":
				if method != http.MethodGet && method != http.MethodHead && method != http.MethodOptions {
					return echo.NewHTTPError(http.StatusForbidden, "read-only token cannot perform "+method)
				}
			case "write":
				// write tokens can GET + POST/PUT/DELETE files but not admin endpoints
				// (admin endpoints: webhooks, share links, schemas, etc.)
				// For simplicity, "write" allows all standard file operations.
			}
			// "admin" can do everything — no restriction.

			// Space scope check
			if e.space != "" {
				if !inScope(e.space, c.QueryParam("path")) {
					return echo.NewHTTPError(http.StatusForbidden, "path outside key scope")
				}
				if method == http.MethodPost && strings.HasSuffix(c.Path(), "/bulk") {
					body, err := io.ReadAll(c.Request().Body)
					if err != nil {
						return echo.NewHTTPError(http.StatusBadRequest, "failed to read body")
					}
					c.Request().Body = io.NopCloser(bytes.NewReader(body))
					var parsed struct {
						Files []struct {
							Path string `json:"path"`
						} `json:"files"`
					}
					if err := json.Unmarshal(body, &parsed); err == nil {
						for _, f := range parsed.Files {
							if !inScope(e.space, f.Path) {
								return echo.NewHTTPError(http.StatusForbidden, "bulk path outside key scope")
							}
						}
					}
				}
			}

			// B.2: enforce path prefix
			if e.prefix != "" {
				reqPath := c.QueryParam("path")
				if reqPath != "" && !inPrefix(e.prefix, reqPath) {
					return echo.NewHTTPError(http.StatusForbidden, "path outside token prefix scope")
				}
				if method == http.MethodPost && strings.HasSuffix(c.Path(), "/bulk") {
					body, err := io.ReadAll(c.Request().Body)
					if err != nil {
						return echo.NewHTTPError(http.StatusBadRequest, "failed to read body")
					}
					c.Request().Body = io.NopCloser(bytes.NewReader(body))
					var parsed struct {
						Files []struct {
							Path string `json:"path"`
						} `json:"files"`
					}
					if err := json.Unmarshal(body, &parsed); err == nil {
						for _, f := range parsed.Files {
							if !inPrefix(e.prefix, f.Path) {
								return echo.NewHTTPError(http.StatusForbidden, "bulk path outside token prefix scope")
							}
						}
					}
				}
			}

			c.Request().Header.Set("X-Actor", e.actor)
			if e.space != "" {
				c.Request().Header.Set("X-Space", e.space)
			}
			return next(c)
		}
	}
}

func apiTracingMiddleware(em tracing.Emitter) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			req := c.Request()
			p := req.URL.Path
			if p == "/health" || p == "/healthz" || p == "/readyz" || p == "/metrics" {
				return next(c)
			}

			ctx := tracing.Start(req.Context(), "api", req.Method+" "+p)
			if q := c.QueryParam("q"); q != "" {
				tracing.SetQuery(ctx, q)
			}
			c.SetRequest(req.WithContext(ctx))

			err := next(c)

			rec := tracing.Finish(ctx, err)
			if rec != nil {
				em.Emit(*rec)
			}
			return err
		}
	}
}

func oidcMiddleware(verifier *oidc.IDTokenVerifier) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			auth := c.Request().Header.Get("Authorization")
			raw, ok := strings.CutPrefix(auth, "Bearer ")
			if !ok || raw == "" {
				return echo.NewHTTPError(http.StatusUnauthorized, "missing bearer token")
			}
			token, err := verifier.Verify(c.Request().Context(), raw)
			if err != nil {
				return echo.NewHTTPError(http.StatusUnauthorized, "invalid token")
			}
			var claims struct {
				Email string `json:"email"`
				Sub   string `json:"sub"`
			}
			if err := token.Claims(&claims); err != nil {
				return echo.NewHTTPError(http.StatusUnauthorized, "invalid claims")
			}
			actor := claims.Email
			if actor == "" {
				actor = claims.Sub
			}
			c.Request().Header.Set("X-Actor", actor)
			return next(c)
		}
	}
}
