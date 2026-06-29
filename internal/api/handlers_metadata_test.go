package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestReadFile_MetadataOnly(t *testing.T) {
	s := buildTestServer(t)
	mustPutFile(t, s, "doc.md", "---\nstatus: published\ntags:\n  - go\n---\n# Hello\n\nBody text here.\n")

	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/file?path=doc.md&metadata_only=true", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET metadata_only: %d %s", rec.Code, rec.Body.String())
	}

	ct := rec.Header().Get("Content-Type")
	if ct == "" || ct[:16] != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json", ct)
	}

	var fm map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &fm); err != nil {
		t.Fatalf("unmarshal: %v (body=%s)", err, rec.Body.String())
	}
	if fm["status"] != "published" {
		t.Fatalf("status = %v, want published", fm["status"])
	}
	// Body text should NOT appear
	if _, ok := fm["Body"]; ok {
		t.Fatal("body text should not appear in metadata_only response")
	}
}

func TestReadFile_MetadataOnly_NoFrontmatter(t *testing.T) {
	s := buildTestServer(t)
	mustPutFile(t, s, "plain.md", "# No Frontmatter\n\nJust body text.\n")

	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/file?path=plain.md&metadata_only=true", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}

	var fm map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &fm); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(fm) != 0 {
		t.Fatalf("expected empty JSON, got %v", fm)
	}
}

func TestReadFile_MetadataOnly_StillHasETag(t *testing.T) {
	s := buildTestServer(t)
	mustPutFile(t, s, "doc.md", "---\nstatus: draft\n---\n# Doc\n")

	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/file?path=doc.md&metadata_only=true", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	if etag := rec.Header().Get("ETag"); etag == "" {
		t.Fatal("expected ETag header on metadata_only response")
	}
}

func TestReadFile_MetadataOnly_BinaryFile(t *testing.T) {
	s := buildTestServer(t)
	mustPutFile(t, s, "data.json", `{"key": "value"}`)

	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/file?path=data.json&metadata_only=true", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	var fm map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &fm); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(fm) != 0 {
		t.Fatalf("expected empty frontmatter for non-markdown, got %v", fm)
	}
}

func TestReadFile_MetadataOnly_WithIfNoneMatch(t *testing.T) {
	s := buildTestServer(t)
	mustPutFile(t, s, "doc.md", "---\nstatus: draft\n---\n# Doc\n")

	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/file?path=doc.md", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	etag := rec.Header().Get("ETag")

	req = httptest.NewRequest(http.MethodGet, "/api/kiwi/file?path=doc.md&metadata_only=true", nil)
	req.Header.Set("If-None-Match", etag)
	rec = httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotModified {
		t.Fatalf("expected 304 on metadata_only with matching etag, got %d", rec.Code)
	}
}

func TestReadFile_MetadataOnly_NestedYAML(t *testing.T) {
	s := buildTestServer(t)
	content := "---\ntitle: \"Test\"\nderived-from:\n  - type: ingest\n    id: test-123\n    date: \"2026-01-01T00:00:00Z\"\n    actor: agent\n---\n# Test\n\nBody.\n"
	mustPutFile(t, s, "nested.md", content)

	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/file?path=nested.md&metadata_only=true", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET metadata_only with nested YAML: %d %s", rec.Code, rec.Body.String())
	}

	var fm map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &fm); err != nil {
		t.Fatalf("unmarshal nested YAML metadata: %v (body=%s)", err, rec.Body.String())
	}
	if fm["title"] != "Test" {
		t.Fatalf("title = %v, want Test", fm["title"])
	}
	df, ok := fm["derived-from"].([]any)
	if !ok || len(df) == 0 {
		t.Fatalf("derived-from missing or wrong type: %v (%T)", fm["derived-from"], fm["derived-from"])
	}
	entry, ok := df[0].(map[string]any)
	if !ok {
		t.Fatalf("derived-from[0] should be map[string]any, got %T", df[0])
	}
	if entry["id"] != "test-123" {
		t.Fatalf("derived-from[0].id = %v, want test-123", entry["id"])
	}
}

func TestPatchFrontmatterUpdatesFields(t *testing.T) {
	s := buildTestServer(t)
	mustPutFile(t, s, "doc.md", "---\ntitle: Doc\n---\n# Doc\n")

	req := httptest.NewRequest(http.MethodPatch, "/api/kiwi/file/frontmatter?path=doc.md", strings.NewReader(`{"fields":{"order":3}}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH frontmatter: %d %s", rec.Code, rec.Body.String())
	}
	if etag := rec.Header().Get("ETag"); etag == "" {
		t.Fatal("expected ETag header")
	}

	req = httptest.NewRequest(http.MethodGet, "/api/kiwi/file?path=doc.md", nil)
	rec = httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET patched file: %d %s", rec.Code, rec.Body.String())
	}
	got := rec.Body.String()
	if !strings.Contains(got, "title: Doc") || !strings.Contains(got, "order: 3") {
		t.Fatalf("patched content missing expected frontmatter:\n%s", got)
	}
}

func TestPatchFileMergeFrontmatterUpdatesFields(t *testing.T) {
	s := buildTestServer(t)
	body := "# Runbook\n\nStep 1: check CPU\n\nStep 2: restart service\n"
	mustPutFile(t, s, "runbooks/high-cpu.md", "---\ntitle: High CPU\nexecution_count: 1\n---\n"+body)

	req := httptest.NewRequest(http.MethodPatch, "/api/kiwi/file?path=runbooks/high-cpu.md&merge=frontmatter", strings.NewReader(`{"execution_count":2,"last_executed":"2026-06-15T10:00:00Z"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH merge=frontmatter: %d %s", rec.Code, rec.Body.String())
	}
	if etag := rec.Header().Get("ETag"); etag == "" {
		t.Fatal("expected ETag header")
	}

	req = httptest.NewRequest(http.MethodGet, "/api/kiwi/file?path=runbooks/high-cpu.md", nil)
	rec = httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET patched file: %d %s", rec.Code, rec.Body.String())
	}
	got := rec.Body.String()
	if !strings.Contains(got, "title: High CPU") {
		t.Fatalf("expected existing frontmatter preserved:\n%s", got)
	}
	if !strings.Contains(got, "execution_count: 2") {
		t.Fatalf("expected updated execution_count:\n%s", got)
	}
	if !strings.Contains(got, "last_executed:") || !strings.Contains(got, "2026-06-15T10:00:00Z") {
		t.Fatalf("expected added last_executed field:\n%s", got)
	}
	if !strings.Contains(got, body) {
		t.Fatalf("expected markdown body preserved:\n%s", got)
	}
}

func TestPatchFileMergeFrontmatterPreservesBodyByteForByte(t *testing.T) {
	s := buildTestServer(t)
	body := "# Title\n\nLine with trailing spaces:   \n\n\tIndented line\n"
	original := "---\nstatus: draft\n---\n" + body
	mustPutFile(t, s, "doc.md", original)

	req := httptest.NewRequest(http.MethodPatch, "/api/kiwi/file?path=doc.md&merge=frontmatter", strings.NewReader(`{"status":"published"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH merge=frontmatter: %d %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/kiwi/file?path=doc.md", nil)
	rec = httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET patched file: %d %s", rec.Code, rec.Body.String())
	}
	parts := strings.SplitN(rec.Body.String(), "---\n", 3)
	if len(parts) < 3 {
		t.Fatalf("expected frontmatter delimiters, got %q", rec.Body.String())
	}
	if gotBody := parts[2]; gotBody != body {
		t.Fatalf("body changed after frontmatter patch\nwant %q\ngot  %q", body, gotBody)
	}
}

func TestPatchFileMergeFrontmatterNotFound(t *testing.T) {
	s := buildTestServer(t)

	req := httptest.NewRequest(http.MethodPatch, "/api/kiwi/file?path=missing.md&merge=frontmatter", strings.NewReader(`{"status":"published"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for missing file, got %d %s", rec.Code, rec.Body.String())
	}
}

func TestPatchFileMergeFrontmatterIfMatchConflict(t *testing.T) {
	s := buildTestServer(t)
	mustPutFile(t, s, "doc.md", "---\ntitle: Doc\n---\n# Doc\n")

	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/file?path=doc.md", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET file: %d %s", rec.Code, rec.Body.String())
	}
	staleETag := rec.Header().Get("ETag")

	mustPutFile(t, s, "doc.md", "---\ntitle: Doc\n---\n# Updated body\n")

	req = httptest.NewRequest(http.MethodPatch, "/api/kiwi/file?path=doc.md&merge=frontmatter", strings.NewReader(`{"order":1}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("If-Match", staleETag)
	rec = httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409 for stale If-Match, got %d %s", rec.Code, rec.Body.String())
	}
}

func TestPatchFileMergeFrontmatterIfMatchSuccess(t *testing.T) {
	s := buildTestServer(t)
	mustPutFile(t, s, "doc.md", "---\ntitle: Doc\n---\n# Doc\n")

	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/file?path=doc.md", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET file: %d %s", rec.Code, rec.Body.String())
	}
	etag := rec.Header().Get("ETag")

	req = httptest.NewRequest(http.MethodPatch, "/api/kiwi/file?path=doc.md&merge=frontmatter", strings.NewReader(`{"order":1}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("If-Match", etag)
	rec = httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for matching If-Match, got %d %s", rec.Code, rec.Body.String())
	}
}

func TestPatchFileMergeFrontmatterCreatesGitCommit(t *testing.T) {
	s, root := buildTestServerWithGit(t)
	runGit(t, root, "init")
	runGit(t, root, "config", "user.name", "Test User")
	runGit(t, root, "config", "user.email", "test@example.com")
	mustPutFile(t, s, "runbooks/high-cpu.md", "---\ntitle: High CPU\n---\n# Runbook\n")
	runGit(t, root, "add", ".")
	runGit(t, root, "commit", "-m", "seed runbook")

	req := httptest.NewRequest(http.MethodPatch, "/api/kiwi/file?path=runbooks/high-cpu.md&merge=frontmatter", strings.NewReader(`{"execution_count":1}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH merge=frontmatter: %d %s", rec.Code, rec.Body.String())
	}

	out := runGitOutput(t, root, "log", "-1", "--oneline")
	if !strings.Contains(out, "runbooks/high-cpu.md") && !strings.Contains(out, "commit") {
		t.Fatalf("expected git log to show a new commit after frontmatter patch, got %q", out)
	}
}

func TestPatchFileUnsupportedMergeMode(t *testing.T) {
	s := buildTestServer(t)
	mustPutFile(t, s, "doc.md", "---\ntitle: Doc\n---\n# Doc\n")

	req := httptest.NewRequest(http.MethodPatch, "/api/kiwi/file?path=doc.md&merge=body", strings.NewReader(`{"status":"published"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for unsupported merge mode, got %d %s", rec.Code, rec.Body.String())
	}
}

func TestPatchFileMergeFrontmatterRejectsEmptyFields(t *testing.T) {
	s := buildTestServer(t)
	mustPutFile(t, s, "doc.md", "---\ntitle: Doc\n---\n# Doc\n")

	req := httptest.NewRequest(http.MethodPatch, "/api/kiwi/file?path=doc.md&merge=frontmatter", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty frontmatter fields, got %d %s", rec.Code, rec.Body.String())
	}
}

func TestPatchFileMergeFrontmatterRejectsNonMarkdown(t *testing.T) {
	s := buildTestServer(t)
	mustPutFile(t, s, "data.json", `{"key":"value"}`)

	req := httptest.NewRequest(http.MethodPatch, "/api/kiwi/file?path=data.json&merge=frontmatter", strings.NewReader(`{"order":1}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for non-markdown frontmatter patch, got %d %s", rec.Code, rec.Body.String())
	}
}

func TestPatchFrontmatterRejectsNonMarkdown(t *testing.T) {
	s := buildTestServer(t)
	mustPutFile(t, s, "data.json", `{"key":"value"}`)

	req := httptest.NewRequest(http.MethodPatch, "/api/kiwi/file/frontmatter?path=data.json", strings.NewReader(`{"fields":{"order":1}}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for non-markdown frontmatter patch, got %d %s", rec.Code, rec.Body.String())
	}
}

func TestTreeNaturalSortOrder(t *testing.T) {
	s := buildTestServer(t)
	mustPutFile(t, s, "10-graphs/page.md", "# Graphs\n")
	mustPutFile(t, s, "2-arrays/page.md", "# Arrays\n")
	mustPutFile(t, s, "1-math/page.md", "# Math\n")

	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/tree?path=/", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET tree: %d %s", rec.Code, rec.Body.String())
	}
	var tree treeEntry
	if err := json.Unmarshal(rec.Body.Bytes(), &tree); err != nil {
		t.Fatal(err)
	}
	if len(tree.Children) < 3 {
		t.Fatalf("expected 3 children, got %d", len(tree.Children))
	}
	if tree.Children[0].Name != "1-math" || tree.Children[1].Name != "2-arrays" || tree.Children[2].Name != "10-graphs" {
		t.Fatalf("natural sort order wrong: got %s, %s, %s",
			tree.Children[0].Name, tree.Children[1].Name, tree.Children[2].Name)
	}
}
