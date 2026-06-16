package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kiwifs/kiwifs/internal/config"
)

func TestUIConfig_DefaultStartPage(t *testing.T) {
	s := buildTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/ui-config", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var res struct {
		ThemeLocked bool   `json:"themeLocked"`
		StartPage   string `json:"startPage"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if res.StartPage != "welcome" {
		t.Fatalf("startPage = %q, want welcome", res.StartPage)
	}
}

func TestUIConfig_StartPageFromConfig(t *testing.T) {
	dir, pipe, cstore := buildTestPipeline(t)
	cfg := &config.Config{}
	cfg.Storage.Root = dir
	cfg.UI.StartPage = "index.md"
	s := NewServer(cfg, pipe, nil, cstore, nil, nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/ui-config", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var res struct {
		StartPage string `json:"startPage"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if res.StartPage != "index.md" {
		t.Fatalf("startPage = %q, want index.md", res.StartPage)
	}
}
