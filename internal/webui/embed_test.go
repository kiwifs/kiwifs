package webui

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	"github.com/labstack/echo/v4"
)

func serve(t *testing.T, path string) *httptest.ResponseRecorder {
	t.Helper()
	SetAssets(fstest.MapFS{
		"index.html":          {Data: []byte("<!doctype html><html><head></head><body></body></html>")},
		"assets/index-new.js": {Data: []byte("console.log(1)")},
	})
	t.Cleanup(func() { assets = nil })
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	rec := httptest.NewRecorder()
	if err := Handler()(e.NewContext(req, rec)); err != nil {
		t.Fatal(err)
	}
	return rec
}

func TestHandler_ServesCurrentAsset(t *testing.T) {
	rec := serve(t, "/assets/index-new.js")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}

func TestHandler_StaleAssetIs404(t *testing.T) {
	rec := serve(t, "/assets/index-old.js")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct == "text/html; charset=utf-8" {
		t.Fatalf("stale asset served as HTML")
	}
}

func TestHandler_ClientRouteGetsIndex(t *testing.T) {
	rec := serve(t, "/page/some/note.md")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "text/html; charset=utf-8" {
		t.Fatalf("content-type = %q, want html", ct)
	}
}
