package s3_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kiwifs/kiwifs/internal/config"
	"github.com/kiwifs/kiwifs/internal/events"
	"github.com/kiwifs/kiwifs/internal/pipeline"
	"github.com/kiwifs/kiwifs/internal/protoauth"
	kiwis3 "github.com/kiwifs/kiwifs/internal/s3"
	"github.com/kiwifs/kiwifs/internal/search"
	"github.com/kiwifs/kiwifs/internal/storage"
	"github.com/kiwifs/kiwifs/internal/versioning"
)

func newSpaceBackend(t *testing.T, auth config.AuthConfig) kiwis3.SpaceBackend {
	t.Helper()
	dir := t.TempDir()
	store, err := storage.NewLocal(dir)
	if err != nil {
		t.Fatalf("storage: %v", err)
	}
	pipe := pipeline.New(store, versioning.NewNoop(), search.NewGrep(dir), nil, events.NewHub(), nil, dir)
	c, err := protoauth.New(auth)
	if err != nil {
		t.Fatalf("protoauth: %v", err)
	}
	return kiwis3.SpaceBackend{Store: store, Pipe: pipe, Auth: c}
}

func TestS3PerSpaceKeysGateEachBucket(t *testing.T) {
	keys := func(k ...config.APIKeyEntry) config.AuthConfig {
		return config.AuthConfig{Type: "perspace", APIKeys: k}
	}
	srv := kiwis3.NewMultiSpace(map[string]kiwis3.SpaceBackend{
		"alpha": newSpaceBackend(t, keys(config.APIKeyEntry{Key: "alpha-key"}, config.APIKeyEntry{Key: "alpha-read", Scope: "read"})),
		"beta":  newSpaceBackend(t, keys(config.APIKeyEntry{Key: "beta-key"})),
	}, []string{"alpha", "beta"})
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)

	do := func(method, path, token string) int {
		t.Helper()
		var body *strings.Reader
		if method == http.MethodPut {
			body = strings.NewReader("# hi\n")
		} else {
			body = strings.NewReader("")
		}
		req, err := http.NewRequest(method, ts.URL+path, body)
		if err != nil {
			t.Fatal(err)
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}

	cases := []struct {
		name, method, path, token string
		want                      int
	}{
		{"anonymous list buckets", http.MethodGet, "/", "", http.StatusUnauthorized},
		{"anonymous list objects", http.MethodGet, "/alpha/", "", http.StatusUnauthorized},
		{"anonymous put", http.MethodPut, "/alpha/note.md", "", http.StatusUnauthorized},
		{"anonymous delete", http.MethodDelete, "/alpha/note.md", "", http.StatusUnauthorized},
		{"own key put", http.MethodPut, "/alpha/note.md", "alpha-key", http.StatusOK},
		{"own key get", http.MethodGet, "/alpha/note.md", "alpha-key", http.StatusOK},
		{"other space's key", http.MethodGet, "/alpha/note.md", "beta-key", http.StatusUnauthorized},
		{"read key get", http.MethodGet, "/alpha/note.md", "alpha-read", http.StatusOK},
		{"read key put", http.MethodPut, "/alpha/note.md", "alpha-read", http.StatusUnauthorized},
		{"read key delete", http.MethodDelete, "/alpha/note.md", "alpha-read", http.StatusUnauthorized},
		{"any valid key lists buckets", http.MethodGet, "/", "beta-key", http.StatusOK},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := do(tc.method, tc.path, tc.token); got != tc.want {
				t.Fatalf("%s %s: got %d, want %d", tc.method, tc.path, got, tc.want)
			}
		})
	}
}

func TestS3NilAuthDenies(t *testing.T) {
	b := newSpaceBackend(t, config.AuthConfig{})
	srv := kiwis3.New("", b.Pipe, b.Store, nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/knowledge/", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("got %d, want 401", rec.Code)
	}
}
