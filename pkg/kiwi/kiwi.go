// Package kiwi provides an embeddable KiwiFS knowledge-base server.
//
//	srv, err := kiwi.New("/data/knowledge",
//	    kiwi.WithSearch("sqlite"),
//	    kiwi.WithVersioning("git"),
//	    kiwi.WithAuth("apikey", "my-secret"),
//	)
//	if err != nil { log.Fatal(err) }
//	defer srv.Close()
//	log.Fatal(srv.ListenAndServe(":3333"))
package kiwi

import (
	"context"
	"net/http"

	"github.com/kiwifs/kiwifs/internal/bootstrap"
	"github.com/kiwifs/kiwifs/internal/config"
	"github.com/kiwifs/kiwifs/internal/pipeline"
	"github.com/kiwifs/kiwifs/internal/spaces"
	"github.com/kiwifs/kiwifs/internal/watcher"
)

type Server struct {
	stack   *bootstrap.Stack
	mgr     *spaces.Manager
	cfg     *config.Config
	watcher *watcher.Watcher
}

type Option func(*config.Config)

func WithSearch(engine string) Option {
	return func(c *config.Config) { c.Search.Engine = engine }
}

func WithVersioning(strategy string) Option {
	return func(c *config.Config) { c.Versioning.Strategy = strategy }
}

func WithAuth(authType, apiKey string) Option {
	return func(c *config.Config) {
		c.Auth.Type = authType
		c.Auth.APIKey = apiKey
	}
}

func WithCORSOrigins(origins ...string) Option {
	return func(c *config.Config) { c.Server.CORSOrigins = origins }
}

// New creates a KiwiFS server rooted at the given directory. The directory
// must already exist; call kiwifs init first or use the CLI's auto-init.
func New(root string, opts ...Option) (*Server, error) {
	cfg := &config.Config{}
	cfg.Storage.Root = root
	cfg.Search.Engine = "sqlite"
	cfg.Versioning.Strategy = "git"
	cfg.Auth.Type = "none"

	for _, o := range opts {
		o(cfg)
	}

	watch := true

	stack, err := bootstrap.Build("default", root, cfg)
	if err != nil {
		return nil, err
	}

	mgr := spaces.NewManager(cfg)
	if err := mgr.RegisterStack("default", root, stack); err != nil {
		stack.Close()
		return nil, err
	}

	s := &Server{
		stack: stack,
		mgr:   mgr,
		cfg:   cfg,
	}

	if watch {
		w, werr := watcher.New(root, stack.Store, stack.Pipeline)
		if werr == nil {
			w.Start()
			s.watcher = w
		}
	}

	return s, nil
}

// Handler returns the http.Handler for embedding in an existing server or
// router. Use this instead of ListenAndServe when you need to mount KiwiFS
// alongside other routes.
func (s *Server) Handler() http.Handler {
	return s.mgr.Handler()
}

// Pipeline returns the write pipeline for programmatic file operations.
func (s *Server) Pipeline() *pipeline.Pipeline {
	return s.stack.Pipeline
}

// ListenAndServe starts the HTTP server on the given address (e.g. ":3333").
func (s *Server) ListenAndServe(addr string) error {
	return http.ListenAndServe(addr, s.Handler())
}

// Shutdown gracefully shuts down the HTTP server.
func (s *Server) Shutdown(ctx context.Context) error {
	return s.stack.Server.Shutdown(ctx)
}

// Close releases all resources (search indexes, vector stores, watchers).
func (s *Server) Close() error {
	if s.watcher != nil {
		s.watcher.Close()
	}
	s.mgr.Close()
	return s.stack.Close()
}
