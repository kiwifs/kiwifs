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

func TestUIConfig_SidebarFromConfig(t *testing.T) {
	dir, pipe, cstore := buildTestPipeline(t)
	cfg := &config.Config{}
	cfg.Storage.Root = dir
	cfg.UI.Sidebar.Pinned = []string{"index.md", "getting-started.md"}
	cfg.UI.Sidebar.Hidden = []string{".kiwi", "templates"}
	cfg.UI.Sidebar.Sections = []config.UISidebarSectionConfig{
		{Label: "Core", Paths: []string{"architecture/", "api/"}},
		{Label: "", Paths: []string{"skip-me/"}},
	}
	s := NewServer(cfg, pipe, nil, cstore, nil, nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/ui-config", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var res struct {
		Sidebar struct {
			Pinned   []string `json:"pinned"`
			Hidden   []string `json:"hidden"`
			Sections []struct {
				Label string   `json:"label"`
				Paths []string `json:"paths"`
			} `json:"sections"`
		} `json:"sidebar"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if len(res.Sidebar.Pinned) != 2 || res.Sidebar.Pinned[0] != "index.md" {
		t.Fatalf("pinned = %+v", res.Sidebar.Pinned)
	}
	if len(res.Sidebar.Hidden) != 2 {
		t.Fatalf("hidden = %+v", res.Sidebar.Hidden)
	}
	if len(res.Sidebar.Sections) != 1 || res.Sidebar.Sections[0].Label != "Core" {
		t.Fatalf("sections = %+v", res.Sidebar.Sections)
	}
}
