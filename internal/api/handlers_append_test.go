package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAppend_NewFile(t *testing.T) {
	s := buildTestServer(t)
	req := httptest.NewRequest(http.MethodPost, "/api/kiwi/file/append?path=log.md", strings.NewReader("first entry"))
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST /file/append: %d %s", rec.Code, rec.Body.String())
	}
	var resp map[string]string
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["path"] != "log.md" {
		t.Fatalf("path = %q, want log.md", resp["path"])
	}

	// Read it back
	req = httptest.NewRequest(http.MethodGet, "/api/kiwi/file?path=log.md", nil)
	rec = httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET file: %d", rec.Code)
	}
	if got := rec.Body.String(); got != "first entry" {
		t.Fatalf("content = %q, want %q", got, "first entry")
	}
}

func TestAppend_ExistingFile(t *testing.T) {
	s := buildTestServer(t)
	mustPutFile(t, s, "log.md", "line1")

	req := httptest.NewRequest(http.MethodPost, "/api/kiwi/file/append?path=log.md", strings.NewReader("line2"))
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST /file/append: %d %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/kiwi/file?path=log.md", nil)
	rec = httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if got := rec.Body.String(); got != "line1\nline2" {
		t.Fatalf("content = %q, want %q", got, "line1\nline2")
	}
}

func TestAppend_CustomSeparator(t *testing.T) {
	s := buildTestServer(t)
	mustPutFile(t, s, "log.md", "entry1")

	req := httptest.NewRequest(http.MethodPost, "/api/kiwi/file/append?path=log.md&separator=%0A---%0A", strings.NewReader("entry2"))
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST /file/append: %d %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/kiwi/file?path=log.md", nil)
	rec = httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if got := rec.Body.String(); got != "entry1\n---\nentry2" {
		t.Fatalf("content = %q, want %q", got, "entry1\n---\nentry2")
	}
}

func TestAppend_ReturnsETag(t *testing.T) {
	s := buildTestServer(t)
	req := httptest.NewRequest(http.MethodPost, "/api/kiwi/file/append?path=new.md", strings.NewReader("content"))
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	etag := rec.Header().Get("ETag")
	if etag == "" {
		t.Fatal("expected ETag header")
	}
}
