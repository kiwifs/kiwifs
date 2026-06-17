package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/kiwifs/kiwifs/internal/config"
)

func TestGetThemePresets_DefaultsWhenMissing(t *testing.T) {
	s := buildTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/theme/presets", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var res struct {
		Presets []struct {
			ID string `json:"id"`
		} `json:"presets"`
		Builtin []string `json:"builtin"`
		Errors  []struct {
			File string `json:"file"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if len(res.Presets) != 0 {
		t.Fatalf("expected no workspace presets, got %+v", res.Presets)
	}
	if len(res.Builtin) != 5 {
		t.Fatalf("builtin = %+v", res.Builtin)
	}
}

func TestGetThemePresets_WorkspacePresets(t *testing.T) {
	s, dir := buildTestServerWithRoot(t)

	themesDir := filepath.Join(dir, ".kiwi", "themes")
	if err := os.MkdirAll(themesDir, 0o755); err != nil {
		t.Fatal(err)
	}
	body := `{
  "name": "Corporate Light",
  "description": "Brand palette",
  "light": {"background": "hsl(0 0% 100%)"},
  "dark": {"background": "hsl(0 0% 5%)"}
}`
	if err := os.WriteFile(filepath.Join(themesDir, "corporate-light.json"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/theme/presets", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)

	var res struct {
		Presets []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"presets"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if len(res.Presets) != 1 || res.Presets[0].ID != "corporate-light" {
		t.Fatalf("presets = %+v", res.Presets)
	}
}

func TestGetThemePresets_InvalidJSON(t *testing.T) {
	s, dir := buildTestServerWithRoot(t)

	themesDir := filepath.Join(dir, ".kiwi", "themes")
	if err := os.MkdirAll(themesDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(themesDir, "broken.json"), []byte(`{bad`), 0o644); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/theme/presets", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)

	var res struct {
		Errors []struct {
			File    string `json:"file"`
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if len(res.Errors) != 1 || res.Errors[0].File != "broken.json" {
		t.Fatalf("errors = %+v", res.Errors)
	}
}

func TestGetThemePresets_AllowedFilter(t *testing.T) {
	dir, pipe, cstore := buildTestPipeline(t)
	themesDir := filepath.Join(dir, ".kiwi", "themes")
	if err := os.MkdirAll(themesDir, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"corporate-light", "corporate-dark"} {
		body := `{
  "name": "` + name + `",
  "light": {"background": "white"},
  "dark": {"background": "black"}
}`
		if err := os.WriteFile(filepath.Join(themesDir, name+".json"), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	cfg := &config.Config{}
	cfg.Storage.Root = dir
	cfg.UI.Theme.AllowedPresets = []string{"default", "corporate-light"}
	s := NewServer(cfg, pipe, nil, cstore, nil, nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/theme/presets", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)

	var res struct {
		Presets []struct {
			ID string `json:"id"`
		} `json:"presets"`
		Builtin []string `json:"builtin"`
		Allowed []string `json:"allowed"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if len(res.Presets) != 1 || res.Presets[0].ID != "corporate-light" {
		t.Fatalf("presets = %+v", res.Presets)
	}
	if len(res.Builtin) != 1 || res.Builtin[0] != "kiwi" {
		t.Fatalf("builtin = %+v", res.Builtin)
	}
	if len(res.Allowed) != 2 {
		t.Fatalf("allowed = %+v", res.Allowed)
	}
}

func TestGetThemePresets_CustomPresetsDir(t *testing.T) {
	dir, pipe, cstore := buildTestPipeline(t)
	themesDir := filepath.Join(dir, "brand", "themes")
	if err := os.MkdirAll(themesDir, 0o755); err != nil {
		t.Fatal(err)
	}
	body := `{
  "name": "Corp",
  "light": {"background": "white"},
  "dark": {"background": "black"}
}`
	if err := os.WriteFile(filepath.Join(themesDir, "corp.json"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}

	cfg := &config.Config{}
	cfg.Storage.Root = dir
	cfg.UI.Theme.PresetsDir = "brand/themes"
	s := NewServer(cfg, pipe, nil, cstore, nil, nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/theme/presets", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)

	var res struct {
		Presets []struct {
			ID string `json:"id"`
		} `json:"presets"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if len(res.Presets) != 1 || res.Presets[0].ID != "corp" {
		t.Fatalf("presets = %+v", res.Presets)
	}
}
