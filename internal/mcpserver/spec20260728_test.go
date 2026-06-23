package mcpserver

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/mark3labs/mcp-go/server"
)

func TestSpec20260728Discover(t *testing.T) {
	s, backend, err := New(Options{Root: t.TempDir()})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer backend.Close()

	h := newSpec20260728HTTPHandler(s, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("discover should not delegate to inner handler")
	}))

	body := `{"jsonrpc":"2.0","id":"disc-1","method":"server/discover","params":{}}`
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got := rec.Header().Get(headerMCPMethod); got != "server/discover" {
		t.Fatalf("Mcp-Method = %q", got)
	}

	var resp struct {
		Result struct {
			SupportedVersions []string       `json:"supportedVersions"`
			Capabilities      map[string]any `json:"capabilities"`
			TTLMs             int            `json:"ttlMs"`
			CacheScope        string         `json:"cacheScope"`
		} `json:"result"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Result.SupportedVersions) == 0 || resp.Result.SupportedVersions[0] != ProtocolVersion20260728 {
		t.Fatalf("supportedVersions = %v", resp.Result.SupportedVersions)
	}
	if resp.Result.TTLMs != defaultDiscoverTTLMs {
		t.Fatalf("ttlMs = %d, want %d", resp.Result.TTLMs, defaultDiscoverTTLMs)
	}
	if resp.Result.CacheScope != defaultPublicCacheScope {
		t.Fatalf("cacheScope = %q", resp.Result.CacheScope)
	}
	if _, ok := resp.Result.Capabilities["tools"]; !ok {
		t.Fatalf("expected tools capability, got %v", resp.Result.Capabilities)
	}
}

func TestSpec20260728RoutingHeaderValidation(t *testing.T) {
	s, backend, err := New(Options{Root: t.TempDir()})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer backend.Close()

	h := newSpec20260728HTTPHandler(s, http.NotFoundHandler())

	body := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"kiwi_read","arguments":{"path":"x.md"}}}`
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(headerMCPMethod, "tools/call")
	req.Header.Set(headerMCPName, "kiwi_write")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	var resp struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !strings.Contains(resp.Error.Message, "Mcp-Method/Mcp-Name") {
		t.Fatalf("error = %q", resp.Error.Message)
	}
}

func TestSpec20260728ToolsListCachingAndSchema(t *testing.T) {
	s, backend, err := New(Options{Root: t.TempDir()})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer backend.Close()

	inner := serverJSONHandler(t, s)
	h := newSpec20260728HTTPHandler(s, inner)

	body := `{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}`
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(headerMCPMethod, "tools/list")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if got := rec.Header().Get(headerMCPMethod); got != "tools/list" {
		t.Fatalf("Mcp-Method = %q", got)
	}
	if rec.Header().Get(headerSessionID) != "" {
		t.Fatalf("unexpected %s header on stateless response", headerSessionID)
	}

	var resp struct {
		Result struct {
			TTLMs      int `json:"ttlMs"`
			CacheScope string `json:"cacheScope"`
			Tools      []struct {
				InputSchema map[string]any `json:"inputSchema"`
			} `json:"tools"`
		} `json:"result"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Result.TTLMs != defaultListTTLMs {
		t.Fatalf("ttlMs = %d, want %d", resp.Result.TTLMs, defaultListTTLMs)
	}
	if resp.Result.CacheScope != defaultPublicCacheScope {
		t.Fatalf("cacheScope = %q", resp.Result.CacheScope)
	}
	if len(resp.Result.Tools) == 0 {
		t.Fatal("expected tools")
	}
	if got := resp.Result.Tools[0].InputSchema["$schema"]; got != jsonSchema202012 {
		t.Fatalf("inputSchema.$schema = %v", got)
	}
}

func TestSpec20260728PatchListResponse(t *testing.T) {
	in := []byte(`{"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"t","inputSchema":{"type":"object"}}]}}`)
	out := patchSpec20260728Response(in, "tools/list")

	var msg map[string]any
	if err := json.Unmarshal(out, &msg); err != nil {
		t.Fatal(err)
	}
	result := msg["result"].(map[string]any)
	if result["ttlMs"].(float64) != float64(defaultListTTLMs) {
		t.Fatalf("ttlMs = %v", result["ttlMs"])
	}
	tools := result["tools"].([]any)
	schema := tools[0].(map[string]any)["inputSchema"].(map[string]any)
	if schema["$schema"] != jsonSchema202012 {
		t.Fatalf("$schema = %v", schema["$schema"])
	}
}

func serverJSONHandler(t *testing.T, s *server.MCPServer) http.Handler {
	t.Helper()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read body: %v", err)
		}
		resp := s.HandleMessage(r.Context(), body)
		if resp == nil {
			w.WriteHeader(http.StatusAccepted)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(resp)
	})
}

func TestNewHTTPHandlerHealthUnchanged(t *testing.T) {
	s, backend, err := New(Options{Root: t.TempDir()})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer backend.Close()

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	newHTTPHandler(s, time.Now(), "").ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("health status = %d", rec.Code)
	}
}

// Ensure response recorder captures nested writes.
func TestSpec20260728ResponseRecorder(t *testing.T) {
	rec := httptest.NewRecorder()
	w := &spec20260728ResponseRecorder{ResponseWriter: rec}
	_, _ = w.Write([]byte(`{"ok":true}`))
	w.WriteHeader(http.StatusOK)
	if w.body.String() != `{"ok":true}` {
		t.Fatalf("body = %q", w.body.String())
	}
}

func TestSpec20260728RoutingName(t *testing.T) {
	params := json.RawMessage(`{"name":"kiwi_search"}`)
	if got := routingName("tools/call", params); got != "kiwi_search" {
		t.Fatalf("routingName = %q", got)
	}
}

func TestSpec20260728NonMCPPassthrough(t *testing.T) {
	s, backend, err := New(Options{Root: t.TempDir()})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer backend.Close()

	var called bool
	h := newSpec20260728HTTPHandler(s, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	}))

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if !called {
		t.Fatal("expected passthrough for non-POST /mcp")
	}
}

func TestSpec20260728ResourcesListCaching(t *testing.T) {
	s, backend, err := New(Options{Root: t.TempDir()})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer backend.Close()

	inner := serverJSONHandler(t, s)
	h := newSpec20260728HTTPHandler(s, inner)

	body := `{"jsonrpc":"2.0","id":4,"method":"resources/list","params":{}}`
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if got := rec.Header().Get(headerMCPMethod); got != "resources/list" {
		t.Fatalf("Mcp-Method = %q", got)
	}

	var resp struct {
		Result struct {
			TTLMs      int    `json:"ttlMs"`
			CacheScope string `json:"cacheScope"`
		} `json:"result"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Result.TTLMs != defaultListTTLMs {
		t.Fatalf("ttlMs = %d, want %d", resp.Result.TTLMs, defaultListTTLMs)
	}
	if resp.Result.CacheScope != defaultPublicCacheScope {
		t.Fatalf("cacheScope = %q", resp.Result.CacheScope)
	}
}

func TestSpec20260728ToolsCallRoutingHeaders(t *testing.T) {
	s, backend, err := New(Options{Root: t.TempDir()})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer backend.Close()

	inner := serverJSONHandler(t, s)
	h := newSpec20260728HTTPHandler(s, inner)

	body := `{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"kiwi_tree","arguments":{}}}`
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if got := rec.Header().Get(headerMCPMethod); got != "tools/call" {
		t.Fatalf("Mcp-Method = %q", got)
	}
	if got := rec.Header().Get(headerMCPName); got != "kiwi_tree" {
		t.Fatalf("Mcp-Name = %q", got)
	}
	if rec.Header().Get(headerSessionID) != "" {
		t.Fatalf("unexpected %s on stateless response", headerSessionID)
	}
}

func TestSpec20260728FullHTTPHandlerDiscover(t *testing.T) {
	s, backend, err := New(Options{Root: t.TempDir()})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer backend.Close()

	h := newHTTPHandler(s, time.Now(), "")

	body := `{"jsonrpc":"2.0","id":"full-1","method":"server/discover","params":{}}`
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if got := rec.Header().Get(headerMCPMethod); got != "server/discover" {
		t.Fatalf("Mcp-Method = %q", got)
	}
	if got := rec.Header().Get(headerMCPProto); got != ProtocolVersion20260728 {
		t.Fatalf("MCP-Protocol-Version = %q", got)
	}
}

func TestSpec20260728DiscoverDoesNotRequireRoutingHeaders(t *testing.T) {
	s, backend, err := New(Options{Root: t.TempDir()})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer backend.Close()

	h := newSpec20260728HTTPHandler(s, http.NotFoundHandler())
	body := bytes.NewBufferString(`{"jsonrpc":"2.0","id":3,"method":"server/discover","params":{}}`)
	req := httptest.NewRequest(http.MethodPost, "/mcp", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
}
