package pipeline

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/kiwifs/kiwifs/internal/events"
	"github.com/kiwifs/kiwifs/internal/storage"
	"github.com/kiwifs/kiwifs/internal/trash"
	"github.com/kiwifs/kiwifs/internal/versioning"
)

func newTrashPipeline(t *testing.T, ver versioning.Versioner) (*Pipeline, *stubSearcher, *events.Hub, string) {
	t.Helper()
	dir := t.TempDir()
	store, err := storage.NewLocal(dir)
	if err != nil {
		t.Fatalf("storage: %v", err)
	}
	searcher := newStubSearcher()
	hub := events.NewHub()
	p := New(store, ver, searcher, nil, hub, nil, dir)
	p.Trash = trash.New(dir)
	return p, searcher, hub, dir
}

func nextEvent(t *testing.T, ch chan events.Message) events.Event {
	t.Helper()
	select {
	case msg := <-ch:
		var ev events.Event
		if err := json.Unmarshal(msg.Data, &ev); err != nil {
			t.Fatalf("decode event: %v", err)
		}
		return ev
	case <-time.After(time.Second):
		t.Fatal("no event broadcast")
	}
	return events.Event{}
}

func TestTrashLifecycle(t *testing.T) {
	p, searcher, hub, dir := newTrashPipeline(t, versioning.NewNoop())
	ctx := context.Background()
	content := "---\ntitle: Plan\n---\n# Plan\n"
	if _, err := p.Write(ctx, "projects/plan.md", []byte(content), "alice"); err != nil {
		t.Fatal(err)
	}
	ch, err := hub.Subscribe()
	if err != nil {
		t.Fatal(err)
	}
	defer hub.Unsubscribe(ch)
	var deleted []string
	p.OnDelete = func(path, _ string) { deleted = append(deleted, path) }

	item, err := p.MoveToTrash(ctx, "projects/plan.md", "bob")
	if err != nil {
		t.Fatalf("MoveToTrash: %v", err)
	}
	if item.OriginalPath != "projects/plan.md" || item.Actor != "bob" {
		t.Errorf("item = %+v", item)
	}
	if _, err := os.Stat(filepath.Join(dir, "projects", "plan.md")); !os.IsNotExist(err) {
		t.Fatalf("file still in place: %v", err)
	}
	if _, ok := searcher.snapshotIndexed()["projects/plan.md"]; ok {
		t.Error("trashed page still indexed")
	}
	ev := nextEvent(t, ch)
	if ev.Op != "delete" || ev.Path != "projects/plan.md" || ev.Extra["trashed"] != true || ev.Extra["restore_id"] != item.ID {
		t.Errorf("trash event = %+v", ev)
	}
	if len(deleted) != 1 || deleted[0] != "projects/plan.md" {
		t.Errorf("OnDelete calls = %v", deleted)
	}

	items, err := p.ListTrash()
	if err != nil || len(items) != 1 || items[0].ID != item.ID {
		t.Fatalf("ListTrash = %+v, %v", items, err)
	}

	restored, res, err := p.RestoreFromTrash(ctx, item.ID, "carol")
	if err != nil {
		t.Fatalf("RestoreFromTrash: %v", err)
	}
	if restored.ID != item.ID || res.Path != "projects/plan.md" || res.ETag != ETag([]byte(content)) {
		t.Errorf("restore = %+v, %+v", restored, res)
	}
	got, err := os.ReadFile(filepath.Join(dir, "projects", "plan.md"))
	if err != nil || string(got) != content {
		t.Fatalf("restored content = %q, %v", got, err)
	}
	if searcher.snapshotIndexed()["projects/plan.md"] != content {
		t.Error("restored page not re-indexed")
	}
	ev = nextEvent(t, ch)
	if ev.Op != "write" || ev.Path != "projects/plan.md" || ev.ETag != res.ETag || ev.Extra["restored_from"] != item.ID {
		t.Errorf("restore event = %+v", ev)
	}
	if items, _ := p.ListTrash(); len(items) != 0 {
		t.Errorf("trash not empty after restore: %+v", items)
	}
}

func TestRestoreFromTrashConflict(t *testing.T) {
	p, _, _, dir := newTrashPipeline(t, versioning.NewNoop())
	ctx := context.Background()
	if _, err := p.Write(ctx, "a.md", []byte("old\n"), "x"); err != nil {
		t.Fatal(err)
	}
	item, err := p.MoveToTrash(ctx, "a.md", "x")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.Write(ctx, "a.md", []byte("new\n"), "x"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := p.RestoreFromTrash(ctx, item.ID, "x"); !errors.Is(err, trash.ErrExists) {
		t.Fatalf("restore over existing file: err = %v, want trash.ErrExists", err)
	}
	if got, _ := os.ReadFile(filepath.Join(dir, "a.md")); string(got) != "new\n" {
		t.Errorf("existing file overwritten: %q", got)
	}
	if _, _, err := p.RestoreFromTrash(ctx, "nope", "x"); !errors.Is(err, trash.ErrNotFound) {
		t.Errorf("unknown id: err = %v, want trash.ErrNotFound", err)
	}
}

func TestMoveToTrashErrors(t *testing.T) {
	p, _, _, dir := newTrashPipeline(t, versioning.NewNoop())
	ctx := context.Background()
	if _, err := p.MoveToTrash(ctx, "missing.md", "x"); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("missing file: err = %v, want os.ErrNotExist", err)
	}
	if err := os.Mkdir(filepath.Join(dir, "folder"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := p.MoveToTrash(ctx, "folder", "x"); !errors.Is(err, ErrIsDirectory) {
		t.Errorf("directory: err = %v, want ErrIsDirectory", err)
	}
	if _, err := p.MoveToTrash(ctx, ".kiwi/config.toml", "x"); !errors.Is(err, storage.ErrPathDenied) {
		t.Errorf("internal path: err = %v, want storage.ErrPathDenied", err)
	}

	p.Trash = nil
	if _, err := p.MoveToTrash(ctx, "a.md", "x"); !errors.Is(err, ErrTrashDisabled) {
		t.Errorf("disabled: err = %v, want ErrTrashDisabled", err)
	}
	if _, err := p.ListTrash(); !errors.Is(err, ErrTrashDisabled) {
		t.Errorf("disabled list: err = %v, want ErrTrashDisabled", err)
	}
}

func TestPurgeTrashHonoursRetention(t *testing.T) {
	p, _, _, _ := newTrashPipeline(t, versioning.NewNoop())
	ctx := context.Background()
	if _, err := p.Write(ctx, "a.md", []byte("x\n"), "x"); err != nil {
		t.Fatal(err)
	}
	if _, err := p.MoveToTrash(ctx, "a.md", "x"); err != nil {
		t.Fatal(err)
	}
	if purged, err := p.PurgeTrash(0); err != nil || len(purged) != 0 {
		t.Fatalf("zero retention purged %+v, %v", purged, err)
	}
	if purged, err := p.PurgeTrash(time.Hour); err != nil || len(purged) != 0 {
		t.Fatalf("fresh item purged: %+v, %v", purged, err)
	}
	if purged, err := p.PurgeTrash(time.Nanosecond); err != nil || len(purged) != 1 {
		t.Fatalf("expired item not purged: %+v, %v", purged, err)
	}
	if items, _ := p.ListTrash(); len(items) != 0 {
		t.Errorf("trash not empty: %+v", items)
	}
}

func TestTrashAndRestoreAreGitCommits(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	dir := t.TempDir()
	g, err := versioning.NewGit(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer g.Close()
	store, err := storage.NewLocal(dir)
	if err != nil {
		t.Fatal(err)
	}
	p := New(store, g, newStubSearcher(), nil, nil, nil, dir)
	p.Trash = trash.New(dir)
	ctx := context.Background()

	if _, err := p.Write(ctx, "notes/a.md", []byte("# A\n"), "alice"); err != nil {
		t.Fatal(err)
	}
	item, err := p.MoveToTrash(ctx, "notes/a.md", "bob")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := p.RestoreFromTrash(ctx, item.ID, "carol"); err != nil {
		t.Fatal(err)
	}

	log := gitOut(t, dir, "log", "--format=%an|%s", "--name-status")
	for _, want := range []string{"carol|restore: notes/a.md", "bob|trash: notes/a.md"} {
		if !strings.Contains(log, want) {
			t.Errorf("git log missing %q:\n%s", want, log)
		}
	}
	if strings.Contains(log, ".kiwi/trash") {
		t.Errorf("trash contents were committed:\n%s", log)
	}
	if status := gitOut(t, dir, "status", "--porcelain", "--", "notes"); status != "" {
		t.Errorf("work tree not clean after restore: %q", status)
	}
}

func gitOut(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

func TestDeleteOrTrash(t *testing.T) {
	p, _, _, dir := newTrashPipeline(t, versioning.NewNoop())
	ctx := context.Background()
	for _, name := range []string{"soft.md", "hard.md"} {
		if _, err := p.Write(ctx, name, []byte("x\n"), "x"); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(dir, "empty"), 0o755); err != nil {
		t.Fatal(err)
	}

	item, err := p.DeleteOrTrash(ctx, "soft.md", "x", false)
	if err != nil || item == nil || item.OriginalPath != "soft.md" {
		t.Fatalf("soft delete = %+v, %v", item, err)
	}
	item, err = p.DeleteOrTrash(ctx, "hard.md", "x", true)
	if err != nil || item != nil {
		t.Fatalf("permanent delete = %+v, %v", item, err)
	}
	item, err = p.DeleteOrTrash(ctx, "empty", "x", false)
	if err != nil || item != nil {
		t.Fatalf("directory delete = %+v, %v", item, err)
	}
	for _, name := range []string{"soft.md", "hard.md", "empty"} {
		if _, err := os.Stat(filepath.Join(dir, name)); !os.IsNotExist(err) {
			t.Errorf("%s still present: %v", name, err)
		}
	}
	if items, _ := p.ListTrash(); len(items) != 1 {
		t.Errorf("trash = %+v, want only soft.md", items)
	}
	if _, err := p.DeleteOrTrash(ctx, "missing.md", "x", false); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("missing file: err = %v, want os.ErrNotExist", err)
	}
}
