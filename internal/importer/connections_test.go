package importer

import (
	"os"
	"path/filepath"
	"testing"
)

func TestConnectionStore_SaveAndGet(t *testing.T) {
	store := newTestStore(t)

	conn := &ConnectionMeta{From: "postgres", Name: "dev-db", Prefix: "db/"}
	if err := store.Save(conn); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if conn.ID == "" {
		t.Fatal("expected ID to be generated")
	}
	if conn.CreatedAt == "" {
		t.Fatal("expected CreatedAt to be set")
	}

	got, ok := store.Get(conn.ID)
	if !ok {
		t.Fatalf("Get(%q) not found", conn.ID)
	}
	if got.From != "postgres" || got.Name != "dev-db" || got.Prefix != "db/" {
		t.Fatalf("unexpected: %+v", got)
	}
}

func TestConnectionStore_List(t *testing.T) {
	store := newTestStore(t)

	store.Save(&ConnectionMeta{From: "mysql", Name: "a", Prefix: "a/"})
	store.Save(&ConnectionMeta{From: "postgres", Name: "b", Prefix: "b/"})

	list := store.List()
	if len(list) != 2 {
		t.Fatalf("List() = %d, want 2", len(list))
	}
}

func TestConnectionStore_Update(t *testing.T) {
	store := newTestStore(t)

	conn := &ConnectionMeta{From: "postgres", Name: "original", Prefix: "p/"}
	store.Save(conn)

	conn.Name = "updated"
	if err := store.Save(conn); err != nil {
		t.Fatalf("Save (update): %v", err)
	}

	got, _ := store.Get(conn.ID)
	if got.Name != "updated" {
		t.Fatalf("Name = %q, want %q", got.Name, "updated")
	}
	if len(store.List()) != 1 {
		t.Fatal("expected 1 connection after update")
	}
}

func TestConnectionStore_Delete(t *testing.T) {
	store := newTestStore(t)

	conn := &ConnectionMeta{From: "redis", Name: "cache", Prefix: "c/"}
	store.Save(conn)

	if err := store.Delete(conn.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, ok := store.Get(conn.ID); ok {
		t.Fatal("expected connection to be gone after delete")
	}
}

func TestConnectionStore_DeleteNotFound(t *testing.T) {
	store := newTestStore(t)
	if err := store.Delete("nonexistent"); err == nil {
		t.Fatal("expected error deleting nonexistent connection")
	}
}

func TestConnectionStore_Persistence(t *testing.T) {
	dir := t.TempDir()

	store1, err := NewConnectionStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	conn := &ConnectionMeta{From: "mongo", Name: "persist-test", Prefix: "m/"}
	store1.Save(conn)

	store2, err := NewConnectionStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	got, ok := store2.Get(conn.ID)
	if !ok {
		t.Fatal("connection not found after reload")
	}
	if got.Name != "persist-test" {
		t.Fatalf("Name = %q after reload", got.Name)
	}
}

func TestConnectionStore_MissingFileInit(t *testing.T) {
	dir := t.TempDir()
	store, err := NewConnectionStore(dir)
	if err != nil {
		t.Fatalf("NewConnectionStore on empty dir: %v", err)
	}
	if len(store.List()) != 0 {
		t.Fatal("expected empty list on fresh init")
	}
}

func TestConnectionStore_UpdateLastRun(t *testing.T) {
	store := newTestStore(t)
	conn := &ConnectionMeta{From: "postgres", Name: "lr", Prefix: "lr/"}
	store.Save(conn)

	stats := &ConnectionStats{Imported: 10, Skipped: 2}
	if err := store.UpdateLastRun(conn.ID, stats); err != nil {
		t.Fatalf("UpdateLastRun: %v", err)
	}
	got, _ := store.Get(conn.ID)
	if got.LastRun == "" {
		t.Fatal("LastRun not set")
	}
	if got.LastStats == nil || got.LastStats.Imported != 10 {
		t.Fatalf("LastStats = %+v", got.LastStats)
	}
}

func TestConnectionStore_UpdateSyncStatus(t *testing.T) {
	store := newTestStore(t)
	conn := &ConnectionMeta{From: "postgres", Name: "ss", Prefix: "ss/"}
	store.Save(conn)

	if err := store.UpdateSyncStatus(conn.ID, "running", ""); err != nil {
		t.Fatalf("UpdateSyncStatus: %v", err)
	}
	got, _ := store.Get(conn.ID)
	if got.SyncStatus != "running" {
		t.Fatalf("SyncStatus = %q", got.SyncStatus)
	}
}

func TestConnectionStore_FindBySourceAndPrefix(t *testing.T) {
	store := newTestStore(t)
	store.Save(&ConnectionMeta{From: "postgres", Name: "a", Prefix: "pg/"})
	store.Save(&ConnectionMeta{From: "mysql", Name: "b", Prefix: "my/"})

	found := store.FindBySourceAndPrefix("postgres", "pg/")
	if found == nil || found.Name != "a" {
		t.Fatalf("FindBySourceAndPrefix: %+v", found)
	}
	if store.FindBySourceAndPrefix("redis", "x/") != nil {
		t.Fatal("expected nil for unmatched source/prefix")
	}
}

func TestConnectionStore_ListSyncEnabled(t *testing.T) {
	store := newTestStore(t)
	store.Save(&ConnectionMeta{From: "pg", Name: "a", Prefix: "a/", SyncEnabled: true})
	store.Save(&ConnectionMeta{From: "pg", Name: "b", Prefix: "b/", SyncEnabled: false})
	store.Save(&ConnectionMeta{From: "pg", Name: "c", Prefix: "c/", SyncEnabled: true})

	enabled := store.ListSyncEnabled()
	if len(enabled) != 2 {
		t.Fatalf("ListSyncEnabled() = %d, want 2", len(enabled))
	}
}

func TestConnectionStore_FileCreated(t *testing.T) {
	dir := t.TempDir()
	store, _ := NewConnectionStore(dir)
	store.Save(&ConnectionMeta{From: "pg", Name: "test", Prefix: "t/"})

	path := filepath.Join(dir, ".kiwi", "state", "imports.json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("imports.json not created: %v", err)
	}
}

func newTestStore(t *testing.T) *ConnectionStore {
	t.Helper()
	store, err := NewConnectionStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return store
}
