package trash

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func newBin(t *testing.T) (*Bin, string) {
	t.Helper()
	root := t.TempDir()
	return New(root), root
}

func writeFile(t *testing.T, root, rel, content string) string {
	t.Helper()
	abs := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(abs, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return abs
}

func TestPutListRestore(t *testing.T) {
	b, root := newBin(t)
	b.now = func() time.Time { return time.Date(2026, 11, 13, 10, 15, 30, 0, time.UTC) }
	src := writeFile(t, root, "notes/Meeting Notes.md", "---\ntitle: x\n---\n# hi\n")

	item, err := b.Put(src, "/notes/Meeting Notes.md", "alice")
	if err != nil {
		t.Fatalf("Put: %v", err)
	}
	if item.ID != "20261113T101530Z_notes-Meeting-Notes.md" {
		t.Errorf("ID = %q", item.ID)
	}
	if item.OriginalPath != "notes/Meeting Notes.md" || item.Actor != "alice" || item.Size != 22 {
		t.Errorf("item = %+v", item)
	}
	if _, err := os.Stat(src); !os.IsNotExist(err) {
		t.Fatalf("source still present after Put: %v", err)
	}
	payload := filepath.Join(root, ".kiwi", "trash", item.ID, "Meeting Notes.md")
	if _, err := os.Stat(payload); err != nil {
		t.Fatalf("payload missing: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, ".kiwi", "trash", "manifest.json")); err != nil {
		t.Fatalf("manifest missing: %v", err)
	}

	items, err := b.List()
	if err != nil || len(items) != 1 || items[0] != item {
		t.Fatalf("List = %+v, %v", items, err)
	}

	restored, err := b.Restore(item.ID, src)
	if err != nil {
		t.Fatalf("Restore: %v", err)
	}
	if restored != item {
		t.Errorf("Restore returned %+v, want %+v", restored, item)
	}
	got, err := os.ReadFile(src)
	if err != nil || string(got) != "---\ntitle: x\n---\n# hi\n" {
		t.Fatalf("restored content = %q, %v", got, err)
	}
	if _, err := os.Stat(filepath.Join(root, ".kiwi", "trash", item.ID)); !os.IsNotExist(err) {
		t.Errorf("item directory left behind: %v", err)
	}
	if items, _ := b.List(); len(items) != 0 {
		t.Errorf("List after restore = %+v", items)
	}
}

func TestRestoreRefusesToOverwrite(t *testing.T) {
	b, root := newBin(t)
	src := writeFile(t, root, "a.md", "old")
	item, err := b.Put(src, "a.md", "")
	if err != nil {
		t.Fatal(err)
	}
	writeFile(t, root, "a.md", "new")

	if _, err := b.Restore(item.ID, src); !errors.Is(err, ErrExists) {
		t.Fatalf("Restore over existing file: err = %v, want ErrExists", err)
	}
	if got, _ := os.ReadFile(src); string(got) != "new" {
		t.Errorf("existing file overwritten: %q", got)
	}
	if items, _ := b.List(); len(items) != 1 {
		t.Errorf("item dropped after failed restore: %+v", items)
	}
}

func TestRestoreRecreatesParentDirs(t *testing.T) {
	b, root := newBin(t)
	src := writeFile(t, root, "deep/er/page.md", "x")
	item, err := b.Put(src, "deep/er/page.md", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(filepath.Join(root, "deep")); err != nil {
		t.Fatal(err)
	}
	if _, err := b.Restore(item.ID, src); err != nil {
		t.Fatalf("Restore: %v", err)
	}
	if _, err := os.Stat(src); err != nil {
		t.Fatalf("restored file missing: %v", err)
	}
}

func TestSamePathTrashedTwiceGetsDistinctIDs(t *testing.T) {
	b, root := newBin(t)
	at := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	b.now = func() time.Time { return at }

	first, err := b.Put(writeFile(t, root, "a.md", "one"), "a.md", "")
	if err != nil {
		t.Fatal(err)
	}
	second, err := b.Put(writeFile(t, root, "a.md", "two"), "a.md", "")
	if err != nil {
		t.Fatal(err)
	}
	if first.ID == second.ID {
		t.Fatalf("both items got id %q", first.ID)
	}
	if second.ID != first.ID+"-2" {
		t.Errorf("second id = %q, want %q", second.ID, first.ID+"-2")
	}

	dst := filepath.Join(root, "a.md")
	if _, err := b.Restore(first.ID, dst); err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(dst); string(got) != "one" {
		t.Errorf("restored %q, want the first version", got)
	}
}

func TestListNewestFirstAndSkipsMissingPayloads(t *testing.T) {
	b, root := newBin(t)
	at := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	b.now = func() time.Time { return at }
	old, _ := b.Put(writeFile(t, root, "old.md", "x"), "old.md", "")
	at = at.Add(time.Hour)
	mid, _ := b.Put(writeFile(t, root, "mid.md", "x"), "mid.md", "")
	at = at.Add(time.Hour)
	recent, _ := b.Put(writeFile(t, root, "new.md", "x"), "new.md", "")

	if err := os.RemoveAll(filepath.Join(root, ".kiwi", "trash", mid.ID)); err != nil {
		t.Fatal(err)
	}
	items, err := b.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 || items[0].ID != recent.ID || items[1].ID != old.ID {
		t.Fatalf("List = %+v", items)
	}
}

func TestDelete(t *testing.T) {
	b, root := newBin(t)
	item, err := b.Put(writeFile(t, root, "a.md", "x"), "a.md", "")
	if err != nil {
		t.Fatal(err)
	}
	got, err := b.Delete(item.ID)
	if err != nil || got != item {
		t.Fatalf("Delete = %+v, %v", got, err)
	}
	if _, err := os.Stat(filepath.Join(root, ".kiwi", "trash", item.ID)); !os.IsNotExist(err) {
		t.Errorf("payload left behind: %v", err)
	}
	if _, err := b.Delete(item.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("second Delete: err = %v, want ErrNotFound", err)
	}
}

func TestUnknownAndMalformedIDs(t *testing.T) {
	b, root := newBin(t)
	if _, err := b.Put(writeFile(t, root, "a.md", "x"), "a.md", ""); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"", "nope", "..", "../manifest.json", "a/b"} {
		if _, err := b.Get(id); !errors.Is(err, ErrNotFound) {
			t.Errorf("Get(%q): err = %v, want ErrNotFound", id, err)
		}
		if _, err := b.Restore(id, filepath.Join(root, "x.md")); !errors.Is(err, ErrNotFound) {
			t.Errorf("Restore(%q): err = %v, want ErrNotFound", id, err)
		}
		if _, err := b.Delete(id); !errors.Is(err, ErrNotFound) {
			t.Errorf("Delete(%q): err = %v, want ErrNotFound", id, err)
		}
	}
}

func TestPurge(t *testing.T) {
	b, root := newBin(t)
	now := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	b.now = func() time.Time { return now.Add(-40 * 24 * time.Hour) }
	expired, _ := b.Put(writeFile(t, root, "expired.md", "x"), "expired.md", "")
	b.now = func() time.Time { return now.Add(-24 * time.Hour) }
	fresh, _ := b.Put(writeFile(t, root, "fresh.md", "x"), "fresh.md", "")
	vanished, _ := b.Put(writeFile(t, root, "vanished.md", "x"), "vanished.md", "")
	if err := os.RemoveAll(filepath.Join(root, ".kiwi", "trash", vanished.ID)); err != nil {
		t.Fatal(err)
	}

	purged, err := b.Purge(now.Add(-30 * 24 * time.Hour))
	if err != nil {
		t.Fatalf("Purge: %v", err)
	}
	if len(purged) != 1 || purged[0].ID != expired.ID {
		t.Fatalf("purged = %+v, want only %s", purged, expired.ID)
	}
	if _, err := os.Stat(filepath.Join(root, ".kiwi", "trash", expired.ID)); !os.IsNotExist(err) {
		t.Errorf("expired payload left behind: %v", err)
	}
	if _, err := b.Get(vanished.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("vanished item still in manifest: %v", err)
	}
	if _, err := b.Get(fresh.ID); err != nil {
		t.Errorf("fresh item purged: %v", err)
	}

	again, err := b.Purge(now.Add(-30 * 24 * time.Hour))
	if err != nil || len(again) != 0 {
		t.Errorf("second Purge = %+v, %v", again, err)
	}
}

func TestPutRejectsDirectories(t *testing.T) {
	b, root := newBin(t)
	dir := filepath.Join(root, "folder")
	if err := os.Mkdir(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := b.Put(dir, "folder", ""); err == nil {
		t.Fatal("Put of a directory succeeded")
	}
	if _, err := os.Stat(dir); err != nil {
		t.Errorf("directory moved: %v", err)
	}
}

func TestCorruptManifestIsAnError(t *testing.T) {
	b, root := newBin(t)
	if err := os.MkdirAll(filepath.Join(root, ".kiwi", "trash"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".kiwi", "trash", "manifest.json"), []byte("{"), 0o644); err != nil {
		t.Fatal(err)
	}
	src := writeFile(t, root, "a.md", "x")
	if _, err := b.Put(src, "a.md", ""); err == nil {
		t.Fatal("Put with a corrupt manifest succeeded")
	}
	if _, err := os.Stat(src); err != nil {
		t.Errorf("file moved despite the error: %v", err)
	}
	if _, err := b.List(); err == nil {
		t.Error("List with a corrupt manifest succeeded")
	}
}

func TestSlugify(t *testing.T) {
	cases := map[string]string{
		"notes/a.md":                     "notes-a.md",
		"Ünïcode/Fïle Name.md":           "n-code-F-le-Name.md",
		"///":                            "file",
		".hidden":                        "hidden",
		strings.Repeat("x", 100) + ".md": strings.Repeat("x", maxSlugLen),
	}
	for in, want := range cases {
		if got := slugify(in); got != want {
			t.Errorf("slugify(%q) = %q, want %q", in, got, want)
		}
		if got := slugify(in); !validID.MatchString("20260101T000000Z_" + got) {
			t.Errorf("slugify(%q) = %q does not form a valid id", in, got)
		}
	}
}
