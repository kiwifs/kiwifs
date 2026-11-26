package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kiwifs/kiwifs/internal/config"
	"github.com/kiwifs/kiwifs/internal/rbac"
)

func TestScopedKeysStayInTheirFolder(t *testing.T) {
	dir, pipe, cstore := buildTestPipeline(t)
	shares, err := rbac.NewShareStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{}
	cfg.Storage.Root = dir
	cfg.Auth.Type = "perspace"
	cfg.Auth.APIKeys = []config.APIKeyEntry{
		{Key: "admin", Actor: "admin"},
		{Key: "prefix", Actor: "pub", Scope: "write", Prefix: "/public/"},
		{Key: "space", Actor: "team", Space: "team-a"},
	}
	s := NewServer(cfg, pipe, nil, cstore, shares, nil, nil)

	call := func(key, method, target, body string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, target, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+key)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		s.echo.ServeHTTP(rec, req)
		return rec
	}
	for _, p := range []string{"public/a.md", "public/sub/b.md", "team-a/c.md", "secret.md", "private/d.md"} {
		if rec := call("admin", http.MethodPut, "/api/kiwi/file?path="+p, "# "+p+"\n"); rec.Code != http.StatusOK {
			t.Fatalf("seed %s: %d %s", p, rec.Code, rec.Body.String())
		}
	}

	cases := []struct {
		key, method, target, body string
		want                      int
	}{
		{"prefix", http.MethodGet, "/api/kiwi/file?path=public/a.md", "", http.StatusOK},
		{"prefix", http.MethodGet, "/api/kiwi/file?path=secret.md", "", http.StatusForbidden},
		{"prefix", http.MethodGet, "/api/kiwi/file?path=public/../secret.md", "", http.StatusForbidden},
		{"prefix", http.MethodGet, "/api/kiwi/tree?path=public", "", http.StatusOK},
		{"prefix", http.MethodGet, "/api/kiwi/tree", "", http.StatusForbidden},
		{"prefix", http.MethodGet, "/api/kiwi/versions", "", http.StatusForbidden},

		{"prefix", http.MethodPost, "/api/kiwi/rename", `{"from":"secret.md","to":"public/stolen.md"}`, http.StatusForbidden},
		{"prefix", http.MethodPost, "/api/kiwi/rename", `{"from":"public/a.md","to":"private/planted.md"}`, http.StatusForbidden},
		{"prefix", http.MethodPost, "/api/kiwi/rename", `{"from":"public/../secret.md","to":"public/x.md"}`, http.StatusForbidden},
		{"prefix", http.MethodPost, "/api/kiwi/rename-dir", `{"from":"private","to":"public/private"}`, http.StatusForbidden},
		{"prefix", http.MethodPost, "/api/kiwi/share", `{"path":"secret.md"}`, http.StatusForbidden},
		{"prefix", http.MethodPost, "/api/kiwi/bulk", `{"files":[{"path":"secret.md","content":"x"}]}`, http.StatusForbidden},
		{"prefix", http.MethodPost, "/api/kiwi/rename", `not json`, http.StatusBadRequest},

		{"prefix", http.MethodGet, "/api/kiwi/search?q=secret", "", http.StatusForbidden},
		{"prefix", http.MethodGet, "/api/kiwi/query?q=TABLE%20FROM%20%22%22", "", http.StatusForbidden},
		{"prefix", http.MethodGet, "/api/kiwi/export", "", http.StatusForbidden},
		{"prefix", http.MethodGet, "/api/kiwi/share", "", http.StatusForbidden},
		{"prefix", http.MethodPost, "/api/kiwi/publish", `{"path":"secret.md"}`, http.StatusForbidden},
		{"prefix", http.MethodPut, "/api/kiwi/canvas?path=secret.canvas", `{}`, http.StatusForbidden},

		{"space", http.MethodGet, "/api/kiwi/file?path=team-a/c.md", "", http.StatusOK},
		{"space", http.MethodGet, "/api/kiwi/file?path=team-ab/c.md", "", http.StatusForbidden},
		{"space", http.MethodPost, "/api/kiwi/share", `{"path":"secret.md"}`, http.StatusForbidden},
		{"space", http.MethodGet, "/api/kiwi/search?q=secret", "", http.StatusForbidden},

		{"prefix", http.MethodPost, "/api/kiwi/share", `{"path":"public/a.md"}`, http.StatusOK},
		{"prefix", http.MethodPost, "/api/kiwi/rename", `{"from":"public/a.md","to":"public/moved.md"}`, http.StatusOK},
		{"prefix", http.MethodPost, "/api/kiwi/rename-dir", `{"from":"public/sub","to":"public/sub2"}`, http.StatusOK},
		{"admin", http.MethodGet, "/api/kiwi/search?q=secret", "", http.StatusOK},
	}
	for _, tc := range cases {
		rec := call(tc.key, tc.method, tc.target, tc.body)
		if rec.Code != tc.want {
			t.Errorf("%s key: %s %s %s = %d, want %d (%s)", tc.key, tc.method, tc.target, tc.body, rec.Code, tc.want, rec.Body.String())
		}
	}

	if rec := call("admin", http.MethodGet, "/api/kiwi/file?path=secret.md", ""); rec.Code != http.StatusOK {
		t.Fatalf("secret.md should still be in place: %d", rec.Code)
	}
	if links, _ := shares.ListForPath("secret.md"); len(links) != 0 {
		t.Fatalf("secret.md got %d share links from scoped keys", len(links))
	}
}

func TestKeyMayTouch(t *testing.T) {
	cases := []struct {
		space, prefix, path string
		want                bool
	}{
		{"", "", "", true},
		{"team-a", "", "team-a", true},
		{"team-a", "", "team-a/x.md", true},
		{"/team-a/", "", "/team-a/x.md", true},
		{"team-a", "", "team-ab/x.md", false},
		{"team-a", "", "", false},
		{"team-a", "", "team-a/../x.md", false},
		{"", "public/", "public", true},
		{"", "public/", "public/x.md", true},
		{"", "/public/", "public/x.md", true},
		{"", "public/", "/public/x.md", true},
		{"", "public/", "publicity.md", false},
		{"", "public/", "", false},
		{"", "public/", "public/../x.md", false},
		{"", "pub", "public/x.md", true},
		{"team-a", "team-a/docs/", "team-a/x.md", false},
		{"team-a", "team-a/docs/", "team-a/docs/x.md", true},
	}
	for _, tc := range cases {
		if got := keyMayTouch(tc.space, tc.prefix, tc.path); got != tc.want {
			t.Errorf("keyMayTouch(%q, %q, %q) = %v, want %v", tc.space, tc.prefix, tc.path, got, tc.want)
		}
	}
}
