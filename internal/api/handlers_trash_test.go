package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kiwifs/kiwifs/internal/config"
	"github.com/kiwifs/kiwifs/internal/trash"
)

func buildTrashTestServer(t *testing.T) (*Server, string) {
	t.Helper()
	dir, pipe, cstore := buildTestPipeline(t)
	pipe.Root = dir
	pipe.Trash = trash.New(dir)
	cfg := &config.Config{}
	cfg.Storage.Root = dir
	return NewServer(cfg, pipe, nil, cstore, nil, nil, nil), dir
}

func doRequest(t *testing.T, s *Server, method, target, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("X-Actor", "tester")
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}

func TestTrashDeleteListRestore(t *testing.T) {
	s, dir := buildTrashTestServer(t)
	content := "---\ntitle: Plan\n---\n# Plan\n"
	mustPutFile(t, s, "projects/plan.md", content)

	rec := doRequest(t, s, http.MethodDelete, "/api/kiwi/file?path=projects/plan.md", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("DELETE: %d %s", rec.Code, rec.Body.String())
	}
	var del deleteFileResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &del); err != nil {
		t.Fatal(err)
	}
	if del.Deleted != "projects/plan.md" || !del.Trashed || del.RestoreID == "" {
		t.Fatalf("DELETE response = %+v", del)
	}
	if _, err := os.Stat(filepath.Join(dir, "projects", "plan.md")); !os.IsNotExist(err) {
		t.Fatalf("file still in place: %v", err)
	}
	if rec := doRequest(t, s, http.MethodGet, "/api/kiwi/file?path=projects/plan.md", ""); rec.Code != http.StatusNotFound {
		t.Errorf("GET trashed file: %d, want 404", rec.Code)
	}

	rec = doRequest(t, s, http.MethodGet, "/api/kiwi/trash", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET trash: %d %s", rec.Code, rec.Body.String())
	}
	var list listTrashResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list.Items) != 1 {
		t.Fatalf("trash items = %+v", list.Items)
	}
	if it := list.Items[0]; it.ID != del.RestoreID || it.OriginalPath != "projects/plan.md" || it.Actor != "tester" || it.DeletedAt.IsZero() {
		t.Errorf("trash item = %+v", it)
	}

	rec = doRequest(t, s, http.MethodPost, "/api/kiwi/trash/restore", `{"restore_id":"`+del.RestoreID+`"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("restore: %d %s", rec.Code, rec.Body.String())
	}
	var restored restoreTrashResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &restored); err != nil {
		t.Fatal(err)
	}
	if restored.Restored != "projects/plan.md" || restored.Item.ID != del.RestoreID || restored.ETag == "" {
		t.Errorf("restore response = %+v", restored)
	}
	if got := rec.Header().Get("ETag"); got != `"`+restored.ETag+`"` {
		t.Errorf("ETag header = %q, want %q", got, restored.ETag)
	}

	rec = doRequest(t, s, http.MethodGet, "/api/kiwi/file?path=projects/plan.md", "")
	if rec.Code != http.StatusOK || rec.Body.String() != content {
		t.Fatalf("GET restored file: %d %q", rec.Code, rec.Body.String())
	}
	rec = doRequest(t, s, http.MethodGet, "/api/kiwi/trash", "")
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil || len(list.Items) != 0 {
		t.Errorf("trash after restore = %s", rec.Body.String())
	}
}

func TestTrashRestoreConflict(t *testing.T) {
	s, dir := buildTrashTestServer(t)
	mustPutFile(t, s, "a.md", "old\n")
	rec := doRequest(t, s, http.MethodDelete, "/api/kiwi/file?path=a.md", "")
	var del deleteFileResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &del); err != nil {
		t.Fatal(err)
	}
	mustPutFile(t, s, "a.md", "new\n")

	rec = doRequest(t, s, http.MethodPost, "/api/kiwi/trash/restore", `{"restore_id":"`+del.RestoreID+`"}`)
	if rec.Code != http.StatusConflict {
		t.Fatalf("restore over existing file: %d %s, want 409", rec.Code, rec.Body.String())
	}
	if got, _ := os.ReadFile(filepath.Join(dir, "a.md")); string(got) != "new\n" {
		t.Errorf("existing file overwritten: %q", got)
	}
}

func TestTrashRestoreErrors(t *testing.T) {
	s, _ := buildTrashTestServer(t)
	cases := []struct {
		body string
		want int
	}{
		{`{}`, http.StatusBadRequest},
		{`not json`, http.StatusBadRequest},
		{`{"restore_id":"20260101T000000Z_missing.md"}`, http.StatusNotFound},
		{`{"restore_id":"../manifest.json"}`, http.StatusNotFound},
	}
	for _, tc := range cases {
		if rec := doRequest(t, s, http.MethodPost, "/api/kiwi/trash/restore", tc.body); rec.Code != tc.want {
			t.Errorf("restore %s: %d %s, want %d", tc.body, rec.Code, rec.Body.String(), tc.want)
		}
	}
}

func TestTrashPurgeItem(t *testing.T) {
	s, dir := buildTrashTestServer(t)
	mustPutFile(t, s, "a.md", "x\n")
	rec := doRequest(t, s, http.MethodDelete, "/api/kiwi/file?path=a.md", "")
	var del deleteFileResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &del); err != nil {
		t.Fatal(err)
	}

	rec = doRequest(t, s, http.MethodDelete, "/api/kiwi/trash/"+del.RestoreID, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("purge: %d %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Join(dir, ".kiwi", "trash", del.RestoreID)); !os.IsNotExist(err) {
		t.Errorf("trashed file left on disk: %v", err)
	}
	if rec := doRequest(t, s, http.MethodDelete, "/api/kiwi/trash/"+del.RestoreID, ""); rec.Code != http.StatusNotFound {
		t.Errorf("second purge: %d, want 404", rec.Code)
	}
	if rec := doRequest(t, s, http.MethodPost, "/api/kiwi/trash/restore", `{"restore_id":"`+del.RestoreID+`"}`); rec.Code != http.StatusNotFound {
		t.Errorf("restore after purge: %d, want 404", rec.Code)
	}
}

func TestDeleteFilePermanentSkipsTrash(t *testing.T) {
	s, dir := buildTrashTestServer(t)
	mustPutFile(t, s, "a.md", "x\n")
	rec := doRequest(t, s, http.MethodDelete, "/api/kiwi/file?path=a.md&permanent=true", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("DELETE: %d %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "trashed") {
		t.Errorf("permanent delete reported a trash item: %s", rec.Body.String())
	}
	if _, err := os.Stat(filepath.Join(dir, "a.md")); !os.IsNotExist(err) {
		t.Fatalf("file still present: %v", err)
	}
	rec = doRequest(t, s, http.MethodGet, "/api/kiwi/trash", "")
	var list listTrashResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil || len(list.Items) != 0 {
		t.Errorf("trash after permanent delete = %s", rec.Body.String())
	}
}

func TestDeleteFileRemovesEmptyDirectoryWithTrashEnabled(t *testing.T) {
	s, dir := buildTrashTestServer(t)
	if err := os.Mkdir(filepath.Join(dir, "empty"), 0o755); err != nil {
		t.Fatal(err)
	}
	rec := doRequest(t, s, http.MethodDelete, "/api/kiwi/file?path=empty", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("DELETE dir: %d %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Join(dir, "empty")); !os.IsNotExist(err) {
		t.Errorf("directory still present: %v", err)
	}
}

func TestTrashDisabled(t *testing.T) {
	s, dir := buildTestServerWithRoot(t)
	mustPutFile(t, s, "a.md", "x\n")
	rec := doRequest(t, s, http.MethodDelete, "/api/kiwi/file?path=a.md", "")
	if rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), "trashed") {
		t.Fatalf("DELETE without trash: %d %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Join(dir, "a.md")); !os.IsNotExist(err) {
		t.Fatalf("file still present: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, ".kiwi", "trash")); !os.IsNotExist(err) {
		t.Errorf("trash created while disabled: %v", err)
	}
	for _, r := range []struct{ method, target, body string }{
		{http.MethodGet, "/api/kiwi/trash", ""},
		{http.MethodPost, "/api/kiwi/trash/restore", `{"restore_id":"x"}`},
		{http.MethodDelete, "/api/kiwi/trash/x", ""},
	} {
		if rec := doRequest(t, s, r.method, r.target, r.body); rec.Code != http.StatusNotFound {
			t.Errorf("%s %s with trash disabled: %d, want 404", r.method, r.target, rec.Code)
		}
	}
}
