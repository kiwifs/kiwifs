package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kiwifs/kiwifs/internal/bootstrap"
	"github.com/kiwifs/kiwifs/internal/config"
)

func buildRawAuthStack(t *testing.T, authTOML string) *bootstrap.Stack {
	t.Helper()
	dir := t.TempDir()
	files := map[string]string{
		".kiwi/config.toml": "[search]\nengine = \"grep\"\n[versioning]\nstrategy = \"none\"\n" +
			"[ui.branding]\nlogo_url = \"brand/logo.png\"\n" + authTOML,
		"notes/secret.md":      "---\nvisibility: private\n---\n# Secret\nTOP-SECRET-BODY\n",
		"notes/diagram.png":    "private-png",
		"notes/a b.png":        "spaced-png",
		"docs/guide.md":        "# Guide\nguide body\n",
		"blog/post.md":         "---\npublished: true\n---\n# Post\nPUBLIC-BODY\n",
		"blog/cover.png":       "public-png",
		"brand/logo.png":       "logo-png",
		"brand/unrelated.png":  "unrelated-png",
		"notes/.hidden/x.png":  "hidden",
		".kiwi/state/keep.txt": "state",
	}
	for p, body := range files {
		abs := filepath.Join(dir, filepath.FromSlash(p))
		if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(abs, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
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
	return stack
}

func rawGet(t *testing.T, stack *bootstrap.Stack, target, bearer string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	rec := httptest.NewRecorder()
	stack.Server.ServeHTTP(rec, req)
	return rec
}

func signRaw(t *testing.T, stack *bootstrap.Stack, path, bearer string) string {
	t.Helper()
	rec := rawGet(t, stack, "/api/kiwi/raw-sign?path="+url.QueryEscape(path), bearer)
	if rec.Code != http.StatusOK {
		t.Fatalf("raw-sign %s: status %d: %s", path, rec.Code, rec.Body.String())
	}
	var body struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	return body.URL
}

const apiKeyAuth = "[auth]\ntype = \"apikey\"\napi_key = \"secret-key\"\n"

func TestRawRequiresAuthWhenEnabled(t *testing.T) {
	stack := buildRawAuthStack(t, apiKeyAuth)

	for _, p := range []string{
		"/raw/notes/secret.md",
		"/raw/notes/diagram.png",
		"/raw/docs/guide.md",
		"/raw/brand/unrelated.png",
		"/api/kiwi/raw/notes/secret.md",
		"/raw/notes/secret.md?path=blog/post.md",
	} {
		rec := rawGet(t, stack, p, "")
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("anonymous GET %s = %d, want 401 (body %q)", p, rec.Code, rec.Body.String())
		}
		if strings.Contains(rec.Body.String(), "TOP-SECRET") {
			t.Errorf("anonymous GET %s leaked content", p)
		}
	}

	rec := rawGet(t, stack, "/raw/notes/secret.md", "wrong-key")
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("wrong key = %d, want 401", rec.Code)
	}

	rec = rawGet(t, stack, "/raw/notes/secret.md", "secret-key")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "TOP-SECRET-BODY") {
		t.Fatalf("bearer GET = %d %q, want 200", rec.Code, rec.Body.String())
	}
	if cc := rec.Header().Get("Cache-Control"); !strings.HasPrefix(cc, "private") {
		t.Errorf("authenticated response Cache-Control = %q, want private", cc)
	}
}

func TestRawServesPublicAssetsAnonymously(t *testing.T) {
	stack := buildRawAuthStack(t, apiKeyAuth)
	for p, want := range map[string]string{
		"/raw/blog/post.md":     "PUBLIC-BODY",
		"/raw/blog/cover.png":   "public-png",
		"/raw/brand/logo.png":   "logo-png",
		"/raw/./brand/logo.png": "logo-png",
	} {
		rec := rawGet(t, stack, p, "")
		if rec.Code != http.StatusOK || rec.Body.String() == "" || !strings.Contains(rec.Body.String(), want) {
			t.Errorf("anonymous GET %s = %d %q, want 200 with %q", p, rec.Code, rec.Body.String(), want)
		}
		if cc := rec.Header().Get("Cache-Control"); !strings.HasPrefix(cc, "public") {
			t.Errorf("%s Cache-Control = %q, want public", p, cc)
		}
	}
}

func TestRawSignedURL(t *testing.T) {
	stack := buildRawAuthStack(t, apiKeyAuth)

	if rec := rawGet(t, stack, "/api/kiwi/raw-sign?path=notes/secret.md", ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous raw-sign = %d, want 401", rec.Code)
	}
	for _, bad := range []string{".kiwi/config.toml", "../.kiwi/config.toml", "notes/../.git/config"} {
		if rec := rawGet(t, stack, "/api/kiwi/raw-sign?path="+url.QueryEscape(bad), "secret-key"); rec.Code != http.StatusBadRequest {
			t.Errorf("raw-sign %s = %d, want 400", bad, rec.Code)
		}
	}

	signed := signRaw(t, stack, "notes/secret.md", "secret-key")
	if !strings.HasPrefix(signed, "/raw/notes/secret.md?") {
		t.Fatalf("signed url = %q", signed)
	}
	rec := rawGet(t, stack, signed, "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "TOP-SECRET-BODY") {
		t.Fatalf("signed GET = %d %q, want 200", rec.Code, rec.Body.String())
	}
	if cc := rec.Header().Get("Cache-Control"); !strings.HasPrefix(cc, "private") {
		t.Errorf("signed response Cache-Control = %q, want private", cc)
	}

	alias := strings.Replace(signed, "/raw/", "/api/kiwi/raw/", 1)
	if rec := rawGet(t, stack, alias, ""); rec.Code != http.StatusOK {
		t.Errorf("signed GET via /api/kiwi/raw alias = %d, want 200", rec.Code)
	}

	u, _ := url.Parse(signed)
	q := u.Query()
	for name, target := range map[string]string{
		"other path":    "/raw/notes/diagram.png?" + q.Encode(),
		"traversal":     "/raw/blog/../notes/diagram.png?" + q.Encode(),
		"tampered sig":  "/raw/notes/secret.md?exp=" + q.Get("exp") + "&sig=" + strings.Repeat("A", len(q.Get("sig"))),
		"extended exp":  "/raw/notes/secret.md?exp=9999999999&sig=" + q.Get("sig"),
		"expired":       "/raw/notes/secret.md?exp=1&sig=" + q.Get("sig"),
		"missing exp":   "/raw/notes/secret.md?sig=" + q.Get("sig"),
		"malformed sig": "/raw/notes/secret.md?exp=" + q.Get("exp") + "&sig=%%%",
	} {
		if rec := rawGet(t, stack, target, ""); rec.Code == http.StatusOK {
			t.Errorf("%s: GET %s = 200, want rejection", name, target)
		}
	}

	spaced := signRaw(t, stack, "notes/a b.png", "secret-key")
	if rec := rawGet(t, stack, spaced, ""); rec.Code != http.StatusOK || rec.Body.String() != "spaced-png" {
		t.Errorf("signed GET %s = %d %q, want 200", spaced, rec.Code, rec.Body.String())
	}
}

func TestRawHiddenPathsStayBlocked(t *testing.T) {
	stack := buildRawAuthStack(t, apiKeyAuth)
	for _, p := range []string{
		"/raw/.kiwi/config.toml",
		"/raw/%2Ekiwi/config.toml",
		"/raw/notes/%2e%2e/.kiwi/config.toml",
		"/raw/.kiwi/state/keep.txt",
		"/raw/notes/.hidden/x.png",
	} {
		rec := rawGet(t, stack, p, "secret-key")
		if rec.Code == http.StatusOK {
			t.Errorf("GET %s = 200 %q, want blocked", p, rec.Body.String())
		}
	}
}

func TestRawRespectsKeyPrefixScope(t *testing.T) {
	stack := buildRawAuthStack(t, "[auth]\ntype = \"perspace\"\n"+
		"[[auth.api_keys]]\nkey = \"docs-key\"\nactor = \"docs-bot\"\nscope = \"read\"\nprefix = \"docs/\"\n")

	if rec := rawGet(t, stack, "/raw/docs/guide.md", "docs-key"); rec.Code != http.StatusOK {
		t.Errorf("in-prefix GET = %d, want 200", rec.Code)
	}
	for _, p := range []string{
		"/raw/notes/secret.md",
		"/raw/notes/secret.md?path=docs/guide.md",
		"/raw/docs/../notes/secret.md",
	} {
		if rec := rawGet(t, stack, p, "docs-key"); rec.Code != http.StatusForbidden {
			t.Errorf("out-of-prefix GET %s = %d, want 403", p, rec.Code)
		}
	}
	if rec := rawGet(t, stack, "/api/kiwi/raw-sign?path=notes/secret.md", "docs-key"); rec.Code != http.StatusForbidden {
		t.Errorf("out-of-prefix raw-sign = %d, want 403", rec.Code)
	}
	signed := signRaw(t, stack, "docs/guide.md", "docs-key")
	if rec := rawGet(t, stack, signed, ""); rec.Code != http.StatusOK {
		t.Errorf("signed in-prefix GET = %d, want 200", rec.Code)
	}
}

func TestRawOpenWithoutAuth(t *testing.T) {
	stack := buildRawAuthStack(t, "")
	rec := rawGet(t, stack, "/raw/notes/secret.md", "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "TOP-SECRET-BODY") {
		t.Fatalf("GET without auth configured = %d, want 200", rec.Code)
	}
	signed := signRaw(t, stack, "notes/diagram.png", "")
	if rec := rawGet(t, stack, signed, ""); rec.Code != http.StatusOK {
		t.Errorf("signed GET without auth configured = %d, want 200", rec.Code)
	}
}

func TestLLMsTxtOnlyListsPublicPagesWhenAuthEnabled(t *testing.T) {
	stack := buildRawAuthStack(t, apiKeyAuth)
	for _, p := range []string{"/llms.txt", "/llms-full.txt"} {
		rec := rawGet(t, stack, p, "")
		if rec.Code != http.StatusOK {
			t.Fatalf("GET %s = %d", p, rec.Code)
		}
		body := rec.Body.String()
		for _, leak := range []string{"secret", "TOP-SECRET", "guide"} {
			if strings.Contains(strings.ToLower(body), strings.ToLower(leak)) {
				t.Errorf("%s leaked %q:\n%s", p, leak, body)
			}
		}
		if !strings.Contains(body, "blog/post.md") {
			t.Errorf("%s should still list published pages:\n%s", p, body)
		}
	}

	open := buildRawAuthStack(t, "")
	if body := rawGet(t, open, "/llms-full.txt", "").Body.String(); !strings.Contains(body, "TOP-SECRET-BODY") {
		t.Errorf("without auth, llms-full.txt should keep listing every page:\n%s", body)
	}
}
