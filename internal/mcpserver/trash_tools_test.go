package mcpserver

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestTrashToolsLifecycle(t *testing.T) {
	b, tmp := setupTestBackend(t)
	defer b.Close()

	res := callTool(t, handleDelete(b), "kiwi_delete", map[string]any{"path": "concepts/auth.md", "actor": "agent-a"})
	if res.IsError {
		t.Fatalf("kiwi_delete: %s", resultText(res))
	}
	m := regexp.MustCompile(`restore_id: (\S+)\)`).FindStringSubmatch(resultText(res))
	if m == nil {
		t.Fatalf("kiwi_delete did not report a restore_id: %s", resultText(res))
	}
	id := m[1]
	if _, err := os.Stat(filepath.Join(tmp, "concepts", "auth.md")); !os.IsNotExist(err) {
		t.Fatalf("file still in place: %v", err)
	}

	res = callTool(t, handleTrashList(b), "kiwi_trash_list", nil)
	if res.IsError || !strings.Contains(resultText(res), "concepts/auth.md (restore_id: "+id) || !strings.Contains(resultText(res), "by agent-a") {
		t.Fatalf("kiwi_trash_list: %s", resultText(res))
	}

	res = callTool(t, handleTrashRestore(b), "kiwi_trash_restore", map[string]any{"restore_id": id})
	if res.IsError || resultText(res) != "Restored concepts/auth.md" {
		t.Fatalf("kiwi_trash_restore: %s", resultText(res))
	}
	got, err := os.ReadFile(filepath.Join(tmp, "concepts", "auth.md"))
	if err != nil || !strings.Contains(string(got), "# Authentication") {
		t.Fatalf("restored content = %q, %v", got, err)
	}

	res = callTool(t, handleTrashRestore(b), "kiwi_trash_restore", map[string]any{"restore_id": id})
	if !res.IsError || !strings.Contains(resultText(res), "kiwi_trash_list") {
		t.Errorf("restoring twice: %s", resultText(res))
	}
	res = callTool(t, handleTrashList(b), "kiwi_trash_list", nil)
	if resultText(res) != "The trash is empty." {
		t.Errorf("kiwi_trash_list after restore: %s", resultText(res))
	}
}

func TestTrashRestoreToolConflict(t *testing.T) {
	b, tmp := setupTestBackend(t)
	defer b.Close()

	res := callTool(t, handleDelete(b), "kiwi_delete", map[string]any{"path": "index.md"})
	id := regexp.MustCompile(`restore_id: (\S+)\)`).FindStringSubmatch(resultText(res))[1]
	if err := os.WriteFile(filepath.Join(tmp, "index.md"), []byte("# New\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	res = callTool(t, handleTrashRestore(b), "kiwi_trash_restore", map[string]any{"restore_id": id})
	if !res.IsError || !strings.Contains(resultText(res), "already exists") {
		t.Fatalf("restore over existing file: %s", resultText(res))
	}
	if got, _ := os.ReadFile(filepath.Join(tmp, "index.md")); string(got) != "# New\n" {
		t.Errorf("existing file overwritten: %q", got)
	}
}

func TestDeleteToolPermanent(t *testing.T) {
	b, tmp := setupTestBackend(t)
	defer b.Close()

	res := callTool(t, handleDelete(b), "kiwi_delete", map[string]any{"path": "index.md", "permanent": true})
	if res.IsError || resultText(res) != "Deleted index.md" {
		t.Fatalf("permanent kiwi_delete: %s", resultText(res))
	}
	if _, err := os.Stat(filepath.Join(tmp, "index.md")); !os.IsNotExist(err) {
		t.Fatalf("file still present: %v", err)
	}
	res = callTool(t, handleTrashList(b), "kiwi_trash_list", nil)
	if resultText(res) != "The trash is empty." {
		t.Errorf("permanent delete went to the trash: %s", resultText(res))
	}
}

func TestRemoteTrashCalls(t *testing.T) {
	var gotQuery, gotActor, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		gotActor = r.Header.Get("X-Actor")
		body, _ := io.ReadAll(r.Body)
		gotBody = string(body)
		switch {
		case r.Method == http.MethodDelete && r.URL.Path == "/api/kiwi/file":
			if r.URL.Query().Get("permanent") == "true" {
				w.Write([]byte(`{"deleted":"a.md"}`))
				return
			}
			w.Write([]byte(`{"deleted":"a.md","trashed":true,"restore_id":"20260101T000000Z_a.md"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/api/kiwi/trash":
			w.Write([]byte(`{"items":[{"id":"20260101T000000Z_a.md","original_path":"a.md","deleted_at":"2026-01-01T00:00:00Z","actor":"x","size":3}]}`))
		case r.Method == http.MethodPost && r.URL.Path == "/api/kiwi/trash/restore":
			w.Write([]byte(`{"restored":"a.md","item":{"id":"20260101T000000Z_a.md","original_path":"a.md"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	rb := NewRemoteBackend(srv.URL, "", "default")
	ctx := t.Context()

	res, err := rb.DeleteFile(ctx, "a.md", "agent", false)
	if err != nil || !res.Trashed || res.RestoreID != "20260101T000000Z_a.md" {
		t.Fatalf("DeleteFile = %+v, %v", res, err)
	}
	if gotQuery != "path=a.md" {
		t.Errorf("soft delete query = %q", gotQuery)
	}
	res, err = rb.DeleteFile(ctx, "a.md", "agent", true)
	if err != nil || res.Trashed {
		t.Fatalf("permanent DeleteFile = %+v, %v", res, err)
	}
	if gotQuery != "path=a.md&permanent=true" {
		t.Errorf("permanent delete query = %q", gotQuery)
	}

	items, err := rb.TrashList(ctx)
	if err != nil || len(items) != 1 || items[0].OriginalPath != "a.md" || items[0].Size != 3 {
		t.Fatalf("TrashList = %+v, %v", items, err)
	}

	item, err := rb.TrashRestore(ctx, "20260101T000000Z_a.md", "restorer")
	if err != nil || item.OriginalPath != "a.md" {
		t.Fatalf("TrashRestore = %+v, %v", item, err)
	}
	var body map[string]string
	if err := json.Unmarshal([]byte(gotBody), &body); err != nil || body["restore_id"] != "20260101T000000Z_a.md" {
		t.Errorf("restore body = %q", gotBody)
	}
	if gotActor != "restorer" {
		t.Errorf("X-Actor = %q, want restorer", gotActor)
	}
}

func TestRemoteTrashErrorsMapToToolErrors(t *testing.T) {
	status, msg := http.StatusNotFound, "trash is disabled"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(map[string]string{"error": msg})
	}))
	defer srv.Close()
	rb := NewRemoteBackend(srv.URL, "", "default")

	res := callTool(t, handleTrashList(rb), "kiwi_trash_list", nil)
	if !res.IsError || !strings.Contains(resultText(res), "disabled") {
		t.Errorf("disabled list: %s", resultText(res))
	}
	status, msg = http.StatusConflict, "restore a.md: destination already exists"
	res = callTool(t, handleTrashRestore(rb), "kiwi_trash_restore", map[string]any{"restore_id": "x"})
	if !res.IsError || !strings.Contains(resultText(res), "already exists") {
		t.Errorf("conflict: %s", resultText(res))
	}
	status, msg = http.StatusNotFound, "trash item not found"
	res = callTool(t, handleTrashRestore(rb), "kiwi_trash_restore", map[string]any{"restore_id": "x"})
	if !res.IsError || !strings.Contains(resultText(res), "No trashed file") {
		t.Errorf("not found: %s", resultText(res))
	}
}
