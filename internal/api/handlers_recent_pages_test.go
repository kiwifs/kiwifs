package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestRecentPages_FromFilesystem(t *testing.T) {
	s, root := buildTestServerWithRoot(t)
	page := filepath.Join(root, "recent.md")
	_ = os.WriteFile(page, []byte("---\ntitle: Recent Landing\n---\nbody\n"), 0644)

	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/recent-pages?limit=5", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var res struct {
		Pages []struct {
			Path  string `json:"path"`
			Title string `json:"title"`
		} `json:"pages"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if len(res.Pages) == 0 {
		t.Fatal("expected at least one page")
	}
	if res.Pages[0].Path != "recent.md" {
		t.Fatalf("path = %q", res.Pages[0].Path)
	}
	if res.Pages[0].Title != "Recent Landing" {
		t.Fatalf("title = %q", res.Pages[0].Title)
	}
}
