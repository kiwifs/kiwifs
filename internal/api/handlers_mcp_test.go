package api_test

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/kiwifs/kiwifs/internal/bootstrap"
	"github.com/kiwifs/kiwifs/internal/config"
	"github.com/kiwifs/kiwifs/internal/mcpserver"
)

func setupMCPAPIServer(t *testing.T) http.Handler {
	t.Helper()
	dir := t.TempDir()
	kiwiDir := filepath.Join(dir, ".kiwi")
	if err := os.MkdirAll(kiwiDir, 0o755); err != nil {
		t.Fatal(err)
	}
	cfgToml := `[search]
engine = "grep"
[versioning]
strategy = "none"
`
	if err := os.WriteFile(filepath.Join(kiwiDir, "config.toml"), []byte(cfgToml), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "index.md"), []byte("# Index\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	cfg := &config.Config{
		Search:     config.SearchConfig{Engine: "grep"},
		Versioning: config.VersioningConfig{Strategy: "none"},
	}
	stack, err := bootstrap.Build("default", dir, cfg)
	if err != nil {
		t.Fatalf("bootstrap.Build: %v", err)
	}
	t.Cleanup(func() { _ = stack.Close() })

	mcpSrv, _, err := mcpserver.New(mcpserver.Options{
		Backend: mcpserver.NewStackBackend(stack),
		Emitter: stack.Emitter,
	})
	if err != nil {
		t.Fatalf("mcpserver.New: %v", err)
	}
	stack.Server.SetMCPHandler(mcpserver.StreamableHTTPHandler(mcpSrv))
	return stack.Server
}

func TestMCPStreamableHTTPInitialize(t *testing.T) {
	srv := setupMCPAPIServer(t)

	body := `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}`
	req := httptest.NewRequest(http.MethodPost, "/mcp", bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code == http.StatusMethodNotAllowed {
		t.Fatalf("POST /mcp returned 405 — MCP route not mounted before UI catch-all")
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("POST /mcp status = %d, want 200; body: %s", rec.Code, rec.Body.String())
	}
	resp := rec.Body.String()
	if !strings.Contains(resp, `"result"`) {
		t.Fatalf("expected JSON-RPC result, got: %s", resp)
	}
	if strings.Contains(resp, "<html") || strings.Contains(resp, "<!DOCTYPE") {
		t.Fatalf("expected JSON, got HTML: %s", resp[:min(200, len(resp))])
	}
}

func TestMCPStreamableHTTPGetIsNotHTML(t *testing.T) {
	srv := setupMCPAPIServer(t)
	ts := httptest.NewServer(srv)
	t.Cleanup(ts.Close)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, ts.URL+"/mcp", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Accept", "text/event-stream")

	resp, err := http.DefaultClient.Do(req)
	if resp == nil {
		t.Fatalf("GET /mcp: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusMethodNotAllowed {
		t.Fatalf("GET /mcp returned 405")
	}
	ct := resp.Header.Get("Content-Type")
	if strings.Contains(ct, "text/html") {
		t.Fatalf("Content-Type = %q, want SSE not HTML", ct)
	}
	if !strings.Contains(ct, "text/event-stream") {
		t.Fatalf("Content-Type = %q, want text/event-stream", ct)
	}

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
	if len(body) > 0 && (strings.Contains(string(body), "<html") || strings.Contains(string(body), "<!DOCTYPE")) {
		t.Fatalf("GET /mcp returned HTML body")
	}
}

func TestMCPStreamableHTTPRequiresAuthWhenConfigured(t *testing.T) {
	dir := t.TempDir()
	kiwiDir := filepath.Join(dir, ".kiwi")
	if err := os.MkdirAll(kiwiDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(kiwiDir, "config.toml"), []byte(`
[search]
engine = "grep"
[versioning]
strategy = "none"
[auth]
type = "apikey"
api_key = "secret-key"
`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "index.md"), []byte("# Index\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	cfg, err := config.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	stack, err := bootstrap.Build("default", dir, cfg)
	if err != nil {
		t.Fatalf("bootstrap.Build: %v", err)
	}
	t.Cleanup(func() { _ = stack.Close() })

	mcpSrv, _, err := mcpserver.New(mcpserver.Options{
		Backend: mcpserver.NewStackBackend(stack),
		Emitter: stack.Emitter,
	})
	if err != nil {
		t.Fatalf("mcpserver.New: %v", err)
	}
	stack.Server.SetMCPHandler(mcpserver.StreamableHTTPHandler(mcpSrv))

	body := `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}`
	req := httptest.NewRequest(http.MethodPost, "/mcp", bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	stack.Server.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("missing auth status = %d, want 401", rec.Code)
	}

	req2 := httptest.NewRequest(http.MethodPost, "/mcp", bytes.NewReader([]byte(body)))
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("Authorization", "Bearer secret-key")
	rec2 := httptest.NewRecorder()
	stack.Server.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("authed status = %d, want 200; body: %s", rec2.Code, rec2.Body.String())
	}
}

func setupMCPAuthServer(t *testing.T, authToml string) *bootstrap.Stack {
	t.Helper()
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, ".kiwi"), 0o755); err != nil {
		t.Fatal(err)
	}
	cfgToml := "[search]\nengine = \"grep\"\n[versioning]\nstrategy = \"none\"\n" + authToml
	if err := os.WriteFile(filepath.Join(dir, ".kiwi", "config.toml"), []byte(cfgToml), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "secret.md"), []byte("# Secret\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg, err := config.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	stack, err := bootstrap.Build("default", dir, cfg)
	if err != nil {
		t.Fatalf("bootstrap.Build: %v", err)
	}
	t.Cleanup(func() { _ = stack.Close() })
	mcpSrv, _, err := mcpserver.New(mcpserver.Options{
		Backend: mcpserver.NewStackBackend(stack),
		Emitter: stack.Emitter,
	})
	if err != nil {
		t.Fatalf("mcpserver.New: %v", err)
	}
	stack.Server.SetMCPHandler(mcpserver.StreamableHTTPHandler(mcpSrv))
	return stack
}

func TestMCPEnforcesPerspaceAndOIDCAuth(t *testing.T) {
	perspace := `[auth]
type = "perspace"
[[auth.api_keys]]
key = "admin-key"
[[auth.api_keys]]
key = "write-key"
scope = "write"
[[auth.api_keys]]
key = "read-key"
scope = "read"
[[auth.api_keys]]
key = "prefix-key"
prefix = "public/"
[[auth.api_keys]]
key = "space-key"
space = "team-a"
`
	public := perspace + "[space]\nvisibility = \"public\"\n"
	oidcNoIssuer := "[auth]\ntype = \"oidc\"\n"
	read := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"kiwi_read","arguments":{"path":"secret.md"}}}`

	cases := []struct {
		name, auth, method, bearer string
		want                       int
	}{
		{"perspace anonymous", perspace, http.MethodPost, "", http.StatusUnauthorized},
		{"perspace wrong key", perspace, http.MethodPost, "nope", http.StatusUnauthorized},
		{"perspace read-only key", perspace, http.MethodPost, "read-key", http.StatusForbidden},
		{"perspace prefix key", perspace, http.MethodPost, "prefix-key", http.StatusForbidden},
		{"perspace space key", perspace, http.MethodPost, "space-key", http.StatusForbidden},
		{"perspace write key", perspace, http.MethodPost, "write-key", http.StatusOK},
		{"perspace admin key", perspace, http.MethodPost, "admin-key", http.StatusOK},
		{"public visibility anonymous POST", public, http.MethodPost, "", http.StatusUnauthorized},
		{"public visibility anonymous GET", public, http.MethodGet, "", http.StatusUnauthorized},
		{"oidc without issuer fails closed", oidcNoIssuer, http.MethodPost, "", http.StatusServiceUnavailable},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			stack := setupMCPAuthServer(t, tc.auth)
			req := httptest.NewRequest(tc.method, "/mcp", strings.NewReader(read))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Accept", "application/json, text/event-stream")
			if tc.bearer != "" {
				req.Header.Set("Authorization", "Bearer "+tc.bearer)
			}
			rec := httptest.NewRecorder()
			stack.Server.ServeHTTP(rec, req)
			if rec.Code != tc.want {
				t.Fatalf("%s /mcp = %d, want %d; body: %s", tc.method, rec.Code, tc.want, rec.Body.String())
			}
			if tc.want != http.StatusOK && strings.Contains(rec.Body.String(), "Secret") {
				t.Fatalf("rejected request leaked file content: %s", rec.Body.String())
			}
		})
	}
}

func TestMCPRouteDoesNotShadowUI(t *testing.T) {
	srv := setupMCPAPIServer(t)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	// UI may be not-built in test env; just ensure /mcp is not served as /.
	reqMCP := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}`))
	reqMCP.Header.Set("Content-Type", "application/json")
	recMCP := httptest.NewRecorder()
	srv.ServeHTTP(recMCP, reqMCP)
	if recMCP.Code == http.StatusMethodNotAllowed {
		t.Fatal("POST /mcp should not fall through to UI catch-all")
	}
	_, _ = io.ReadAll(rec.Body)
}
