package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

func postImportJSON(t *testing.T, s *Server, route string, body any) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/kiwi/import/"+route, strings.NewReader(string(raw)))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}

func TestImportPreviewMarkdownUsesPath(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "note.md"), []byte("---\nstatus: open\n---\n\n# Note\n\nHello.\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	for _, route := range []string{"preview", "infer-fields"} {
		rec := postImportJSON(t, s, route, map[string]any{"from": "markdown", "path": dir, "prefix": "docs"})
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status %d: %s", route, rec.Code, rec.Body.String())
		}
	}

	rec := postImportJSON(t, s, "preview", map[string]any{"from": "markdown", "path": dir, "prefix": "docs"})
	var resp previewResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	if len(resp.Records) != 1 {
		t.Fatalf("records = %d, want 1: %s", len(resp.Records), rec.Body.String())
	}
}

func TestImportPreviewObsidianVault(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	vault := t.TempDir()
	if err := os.MkdirAll(filepath.Join(vault, ".obsidian"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(vault, "one.md"), []byte("---\nstatus: open\n---\n# One\nSee [[two]].\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	for _, route := range []string{"preview", "infer-fields"} {
		rec := postImportJSON(t, s, route, map[string]any{"from": "obsidian", "path": vault, "prefix": "vault"})
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status %d: %s", route, rec.Code, rec.Body.String())
		}
	}

	rec := postImportJSON(t, s, "preview", map[string]any{"from": "obsidian", "path": vault, "prefix": "vault"})
	var resp previewResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	if len(resp.Records) != 1 {
		t.Fatalf("records = %d, want 1: %s", len(resp.Records), rec.Body.String())
	}
	if body := resp.Records[0].BodyPreview; !strings.HasPrefix(body, "# One") {
		t.Fatalf("body preview = %q, want it to start with the heading", body)
	}

	rec = postImportJSON(t, s, "preview", map[string]any{"from": "obsidian"})
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "path is required for obsidian") {
		t.Fatalf("missing path: status %d: %s", rec.Code, rec.Body.String())
	}
}

func TestImportPreviewSQLiteUsesQuery(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	dbPath := filepath.Join(t.TempDir(), "data.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE issues (key TEXT, title TEXT); INSERT INTO issues VALUES ('A-1', 'one'), ('A-2', 'two')`); err != nil {
		t.Fatal(err)
	}
	db.Close()

	rec := postImportJSON(t, s, "preview", map[string]any{
		"from":  "sqlite",
		"db":    dbPath,
		"query": "SELECT key, title FROM issues WHERE key = 'A-2'",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	var resp previewResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	if len(resp.Records) != 1 {
		t.Fatalf("records = %d, want 1: %s", len(resp.Records), rec.Body.String())
	}
}
