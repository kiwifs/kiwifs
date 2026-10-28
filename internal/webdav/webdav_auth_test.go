package webdav

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kiwifs/kiwifs/internal/config"
	"github.com/kiwifs/kiwifs/internal/events"
	"github.com/kiwifs/kiwifs/internal/pipeline"
	"github.com/kiwifs/kiwifs/internal/protoauth"
	"github.com/kiwifs/kiwifs/internal/search"
	"github.com/kiwifs/kiwifs/internal/storage"
	"github.com/kiwifs/kiwifs/internal/versioning"
)

func newAuthedWebDAV(t *testing.T, auth *protoauth.Checker) *httptest.Server {
	t.Helper()
	root := t.TempDir()
	store, err := storage.NewLocal(root)
	if err != nil {
		t.Fatalf("storage: %v", err)
	}
	pipe := pipeline.New(store, versioning.NewNoop(), search.NewGrep(root), nil, events.NewHub(), nil, root)
	srv := httptest.NewServer(New(root, pipe, "test", auth).Handler(""))
	t.Cleanup(srv.Close)
	return srv
}

func TestWebDAVPerSpaceKeys(t *testing.T) {
	auth, err := protoauth.New(config.AuthConfig{Type: "perspace", APIKeys: []config.APIKeyEntry{
		{Key: "admin-key"},
		{Key: "read-key", Scope: "read"},
		{Key: "folder-key", Space: "team-a"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	srv := newAuthedWebDAV(t, auth)

	type cred struct{ bearer, basic string }
	do := func(method, path string, c cred) int {
		t.Helper()
		body := "# hi\n"
		if method == "PROPFIND" {
			body = ""
		}
		req, err := http.NewRequest(method, srv.URL+path, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		if method == "PROPFIND" {
			req.Header.Set("Depth", "1")
		}
		switch {
		case c.bearer != "":
			req.Header.Set("Authorization", "Bearer "+c.bearer)
		case c.basic != "":
			req.SetBasicAuth("finder", c.basic)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}

	cases := []struct {
		name, method, path string
		c                  cred
		want               int
	}{
		{"anonymous listing", "PROPFIND", "/", cred{}, http.StatusUnauthorized},
		{"anonymous read", http.MethodGet, "/note.md", cred{}, http.StatusUnauthorized},
		{"anonymous write", http.MethodPut, "/note.md", cred{}, http.StatusUnauthorized},
		{"anonymous delete", http.MethodDelete, "/note.md", cred{}, http.StatusUnauthorized},
		{"wrong key", http.MethodGet, "/note.md", cred{bearer: "nope"}, http.StatusUnauthorized},
		{"bearer admin write", http.MethodPut, "/note.md", cred{bearer: "admin-key"}, http.StatusCreated},
		{"basic admin read", http.MethodGet, "/note.md", cred{basic: "admin-key"}, http.StatusOK},
		{"read key listing", "PROPFIND", "/", cred{basic: "read-key"}, http.StatusMultiStatus},
		{"read key write", http.MethodPut, "/note.md", cred{basic: "read-key"}, http.StatusUnauthorized},
		{"read key delete", http.MethodDelete, "/note.md", cred{bearer: "read-key"}, http.StatusUnauthorized},
		{"folder-scoped key", http.MethodGet, "/note.md", cred{bearer: "folder-key"}, http.StatusUnauthorized},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := do(tc.method, tc.path, tc.c); got != tc.want {
				t.Fatalf("%s %s: got %d, want %d", tc.method, tc.path, got, tc.want)
			}
		})
	}
}

func TestWebDAVNilAuthDenies(t *testing.T) {
	srv := newAuthedWebDAV(t, nil)
	resp, err := http.Get(srv.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("got %d, want 401", resp.StatusCode)
	}
}
