package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRules_Get_Empty(t *testing.T) {
	s := buildTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/rules", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if rec.Body.String() != "" {
		t.Errorf("expected empty, got %q", rec.Body.String())
	}
}

func TestRules_PutAndGet(t *testing.T) {
	s, dir := buildSQLiteTestServer(t)

	body := "# Agent Rules\n- Always update docs\n"
	req := httptest.NewRequest(http.MethodPut, "/api/kiwi/rules", strings.NewReader(body))
	req.Header.Set("Content-Type", "text/markdown")
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("PUT expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	data, err := os.ReadFile(filepath.Join(dir, ".kiwi", "rules.md"))
	if err != nil {
		t.Fatalf("file not created: %v", err)
	}
	if string(data) != body {
		t.Errorf("file content = %q, want %q", string(data), body)
	}

	req2 := httptest.NewRequest(http.MethodGet, "/api/kiwi/rules", nil)
	rec2 := httptest.NewRecorder()
	s.echo.ServeHTTP(rec2, req2)
	if rec2.Body.String() != body {
		t.Errorf("GET raw = %q, want %q", rec2.Body.String(), body)
	}
}

func TestRules_FormatCursor(t *testing.T) {
	s, dir := buildSQLiteTestServer(t)

	kiwiDir := filepath.Join(dir, ".kiwi")
	os.MkdirAll(kiwiDir, 0755)
	os.WriteFile(filepath.Join(kiwiDir, "rules.md"), []byte("- Always update docs"), 0644)

	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/rules?format=cursor", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "alwaysApply: true") {
		t.Error("cursor format should contain alwaysApply frontmatter")
	}
	if !strings.Contains(body, "- Always update docs") {
		t.Error("cursor format should contain user rules")
	}
	if !strings.Contains(body, "## User rules") {
		t.Error("cursor format should contain User rules section")
	}
}

func TestRules_FormatClaude(t *testing.T) {
	s, dir := buildSQLiteTestServer(t)

	kiwiDir := filepath.Join(dir, ".kiwi")
	os.MkdirAll(kiwiDir, 0755)
	os.WriteFile(filepath.Join(kiwiDir, "rules.md"), []byte("- Always update docs"), 0644)

	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/rules?format=claude", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)

	body := rec.Body.String()
	if !strings.Contains(body, "### Rules") {
		t.Error("claude format should contain Rules heading")
	}
	if !strings.Contains(body, "kiwi_write") {
		t.Error("claude format should mention tools")
	}
}

func TestRules_FormatSkill(t *testing.T) {
	s, dir := buildSQLiteTestServer(t)

	kiwiDir := filepath.Join(dir, ".kiwi")
	os.MkdirAll(kiwiDir, 0755)
	os.WriteFile(filepath.Join(kiwiDir, "rules.md"), []byte("- Check the wiki before answering"), 0644)

	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/rules?format=skill", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "# Team Wiki Skill") {
		t.Error("skill format should contain title")
	}
	if !strings.Contains(body, "kiwi_search") || !strings.Contains(body, "kiwi_read") {
		t.Error("skill format should reference search/read tools")
	}
	if !strings.Contains(body, "Check the wiki before answering") {
		t.Error("skill format should contain user rules")
	}
}
