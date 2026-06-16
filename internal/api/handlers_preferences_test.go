package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestGetPreferences_Unauthenticated(t *testing.T) {
	s := buildTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/preferences", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestPreferences_RoundTrip(t *testing.T) {
	s, dir := buildTestServerWithRoot(t)
	actor := "alice@example.com"

	getReq := httptest.NewRequest(http.MethodGet, "/api/kiwi/preferences", nil)
	getReq.Header.Set("X-Actor", actor)
	getRec := httptest.NewRecorder()
	s.echo.ServeHTTP(getRec, getReq)
	if getRec.Code != http.StatusOK {
		t.Fatalf("GET expected 200, got %d: %s", getRec.Code, getRec.Body.String())
	}

	collapsed := true
	putBody, _ := json.Marshal(map[string]any{
		"theme":              "ocean",
		"sidebar_collapsed":  collapsed,
		"default_view":       "source",
		"font_size":          "lg",
		"editor_line_numbers": true,
		"vim_mode":           false,
	})
	putReq := httptest.NewRequest(http.MethodPut, "/api/kiwi/preferences", bytes.NewReader(putBody))
	putReq.Header.Set("Content-Type", "application/json")
	putReq.Header.Set("X-Actor", actor)
	putRec := httptest.NewRecorder()
	s.echo.ServeHTTP(putRec, putReq)
	if putRec.Code != http.StatusOK {
		t.Fatalf("PUT expected 200, got %d: %s", putRec.Code, putRec.Body.String())
	}

	var saved struct {
		Theme            string `json:"theme"`
		SidebarCollapsed bool   `json:"sidebar_collapsed"`
		DefaultView      string `json:"default_view"`
		FontSize         string `json:"font_size"`
	}
	if err := json.Unmarshal(putRec.Body.Bytes(), &saved); err != nil {
		t.Fatal(err)
	}
	if saved.Theme != "ocean" || !saved.SidebarCollapsed || saved.DefaultView != "source" || saved.FontSize != "lg" {
		t.Fatalf("unexpected saved prefs: %+v", saved)
	}

	prefsPath := filepath.Join(dir, ".kiwi", "users", "alice_at_example.com", "preferences.json")
	if _, err := os.Stat(prefsPath); err != nil {
		t.Fatalf("preferences file missing: %v", err)
	}

	getRec2 := httptest.NewRecorder()
	s.echo.ServeHTTP(getRec2, getReq)
	if getRec2.Code != http.StatusOK {
		t.Fatalf("GET after PUT expected 200, got %d", getRec2.Code)
	}
	if err := json.Unmarshal(getRec2.Body.Bytes(), &saved); err != nil {
		t.Fatal(err)
	}
	if saved.Theme != "ocean" {
		t.Fatalf("GET theme = %q", saved.Theme)
	}
}

func TestPutPreferences_Merge(t *testing.T) {
	s := buildTestServer(t)
	actor := "bob@example.com"

	first, _ := json.Marshal(map[string]any{
		"theme":             "kiwi",
		"sidebar_collapsed": true,
	})
	req1 := httptest.NewRequest(http.MethodPut, "/api/kiwi/preferences", bytes.NewReader(first))
	req1.Header.Set("Content-Type", "application/json")
	req1.Header.Set("X-Actor", actor)
	rec1 := httptest.NewRecorder()
	s.echo.ServeHTTP(rec1, req1)
	if rec1.Code != http.StatusOK {
		t.Fatalf("first PUT: %d %s", rec1.Code, rec1.Body.String())
	}

	second, _ := json.Marshal(map[string]any{"default_view": "editor"})
	req2 := httptest.NewRequest(http.MethodPut, "/api/kiwi/preferences", bytes.NewReader(second))
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("X-Actor", actor)
	rec2 := httptest.NewRecorder()
	s.echo.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("second PUT: %d %s", rec2.Code, rec2.Body.String())
	}

	var merged struct {
		Theme            string `json:"theme"`
		SidebarCollapsed bool   `json:"sidebar_collapsed"`
		DefaultView      string `json:"default_view"`
	}
	if err := json.Unmarshal(rec2.Body.Bytes(), &merged); err != nil {
		t.Fatal(err)
	}
	if merged.Theme != "kiwi" || !merged.SidebarCollapsed || merged.DefaultView != "editor" {
		t.Fatalf("merge failed: %+v", merged)
	}
}

func TestPutPreferences_PathTraversalActor(t *testing.T) {
	s := buildTestServer(t)
	body, _ := json.Marshal(map[string]any{"theme": "ocean"})
	req := httptest.NewRequest(http.MethodPut, "/api/kiwi/preferences", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Actor", "..")
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for path traversal actor, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestPutPreferences_InvalidField(t *testing.T) {
	s := buildTestServer(t)
	body, _ := json.Marshal(map[string]any{"default_view": "invalid"})
	req := httptest.NewRequest(http.MethodPut, "/api/kiwi/preferences", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Actor", "carol@example.com")
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}
