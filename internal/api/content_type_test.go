package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kiwifs/kiwifs/internal/config"
	"github.com/kiwifs/kiwifs/internal/rbac"
)

func TestServedContentTypeNeverServesActiveMarkup(t *testing.T) {
	for _, c := range []struct {
		path    string
		content string
		want    string
	}{
		{"guides/apps/lease.html", "<script>alert(1)</script>", "text/plain; charset=utf-8"},
		{"a.htm", "<p>x</p>", "text/plain; charset=utf-8"},
		{"a.xhtml", "<html/>", "text/plain; charset=utf-8"},
		{"feed.xml", "<rss/>", "text/plain; charset=utf-8"},
		{"feed.rss", "<rss/>", "text/plain; charset=utf-8"},
		{"feed.atom", "<feed/>", "text/plain; charset=utf-8"},
		{"noext", "<!DOCTYPE html><html><body>x</body></html>", "text/plain; charset=utf-8"},
		{"noext-xml", "<?xml version=\"1.0\"?><x/>", "text/plain; charset=utf-8"},
		{"logo.svg", "<svg/>", "image/svg+xml"},
		{"page.md", "# x", "text/markdown; charset=utf-8"},
		{"img.png", "\x89PNG\r\n\x1a\n", "image/png"},
	} {
		if got := servedContentType(detectContentType(c.path, []byte(c.content))); got != c.want {
			t.Errorf("served type of %q = %q, want %q", c.path, got, c.want)
		}
	}
	for _, ct := range []string{"application/xslt+xml", "text/xsl", "application/rss+xml", "Application/Atom+XML; charset=utf-8", "text/xml"} {
		if !isActiveMarkup(ct) {
			t.Errorf("isActiveMarkup(%q) = false", ct)
		}
	}
}

func TestWorkspaceFileRoutesSendSafeHeaders(t *testing.T) {
	dir, pipe, cstore := buildTestPipeline(t)
	shares, err := rbac.NewShareStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{}
	cfg.Storage.Root = dir
	s := NewServer(cfg, pipe, nil, cstore, shares, nil, nil)

	mustPutFile(t, s, "pub/index.md", "---\npublished: true\n---\n# Pub\n")
	mustPutFile(t, s, "pub/app.html", "<script>alert(document.cookie)</script>")
	mustPutFile(t, s, "pub/logo.svg", `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`)
	mustPutFile(t, s, "pub/manual.pdf", "%PDF-1.4\n")

	token := func(path string) string {
		link, err := shares.Create(path, "test", 0, "")
		if err != nil {
			t.Fatal(err)
		}
		return link.Token
	}

	routes := map[string]func(path string) string{
		"raw":         func(p string) string { return "/raw/" + p },
		"raw alias":   func(p string) string { return "/api/kiwi/raw/" + p },
		"file":        func(p string) string { return "/api/kiwi/file?path=" + p },
		"share token": func(p string) string { return "/api/kiwi/public/" + token(p) },
		"public file": func(p string) string { return "/api/kiwi/public/file?path=" + p },
		"published":   func(p string) string { return "/p/" + p },
	}
	files := []struct {
		path, wantType string
		wantCSP        bool
	}{
		{"pub/app.html", "text/plain; charset=utf-8", true},
		{"pub/logo.svg", "image/svg+xml", true},
		{"pub/manual.pdf", "application/pdf", false},
	}
	for name, url := range routes {
		for _, f := range files {
			target := url(f.path)
			rec := httptest.NewRecorder()
			s.echo.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))
			if rec.Code != http.StatusOK {
				t.Errorf("%s %s: status %d %s", name, target, rec.Code, rec.Body.String())
				continue
			}
			h := rec.Header()
			if got := h.Get("Content-Type"); got != f.wantType {
				t.Errorf("%s %s: Content-Type %q, want %q", name, target, got, f.wantType)
			}
			if got := h.Get("X-Content-Type-Options"); got != "nosniff" {
				t.Errorf("%s %s: X-Content-Type-Options %q", name, target, got)
			}
			csp := h.Get("Content-Security-Policy")
			if f.wantCSP && csp != workspaceBlobCSP {
				t.Errorf("%s %s: Content-Security-Policy %q, want %q", name, target, csp, workspaceBlobCSP)
			}
			if !f.wantCSP && csp != "" {
				t.Errorf("%s %s: unexpected Content-Security-Policy %q", name, target, csp)
			}
		}
	}
}

func TestUploadAssetChecksTheRealType(t *testing.T) {
	s := buildTestServerWithAssets(t, config.AssetsConfig{AllowedTypes: []string{"image/png"}})
	body, ct := buildMultipart(t, "file", "notes.txt", []byte("plain words"))
	req := httptest.NewRequest(http.MethodPost, "/api/kiwi/assets", body)
	req.Header.Set("Content-Type", ct)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("text upload with png-only allowlist: want 415, got %d", rec.Code)
	}

	s = buildTestServerWithAssets(t, config.AssetsConfig{AllowedTypes: []string{"text/plain"}})
	body, ct = buildMultipart(t, "file", "page.html", []byte("<script>alert(1)</script>"))
	req = httptest.NewRequest(http.MethodPost, "/api/kiwi/assets", body)
	req.Header.Set("Content-Type", ct)
	rec = httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("html upload must be checked as text/html, not its served text/plain: got %d %s", rec.Code, rec.Body.String())
	}

	s = buildTestServerWithAssets(t, config.AssetsConfig{AllowedTypes: []string{"text/html"}})
	body, ct = buildMultipart(t, "file", "page.html", []byte("<p>x</p>"))
	req = httptest.NewRequest(http.MethodPost, "/api/kiwi/assets", body)
	req.Header.Set("Content-Type", ct)
	rec = httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("html upload allowed as text/html: got %d %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"contentType":"text/html"`) {
		t.Fatalf("response should report the real type: %s", rec.Body.String())
	}
}
