package recentpages

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/kiwifs/kiwifs/internal/storage"
	"github.com/kiwifs/kiwifs/internal/versioning"
)

func TestParseGitRecent_DedupesMarkdown(t *testing.T) {
	output := `COMMIT:abc|2026-06-16T10:00:00Z|alice|first
M	pages/a.md
COMMIT:def|2026-06-15T09:00:00Z|bob|second
M	pages/b.md
M	pages/a.md
D	pages/old.md
M	.kiwi/config.toml
M	notes.txt`
	pages := parseGitRecent(output, 10)
	if len(pages) != 2 {
		t.Fatalf("got %d pages, want 2", len(pages))
	}
	if pages[0].Path != "pages/a.md" || pages[0].Actor != "alice" {
		t.Fatalf("first page: %+v", pages[0])
	}
	if pages[1].Path != "pages/b.md" {
		t.Fatalf("second page: %+v", pages[1])
	}
}

func TestListFromStore_SortsByModTime(t *testing.T) {
	root := t.TempDir()
	store, err := storage.NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	oldPath := filepath.Join(root, "old.md")
	newPath := filepath.Join(root, "new.md")
	_ = os.WriteFile(oldPath, []byte("---\ntitle: Old\n---\n"), 0644)
	_ = os.WriteFile(newPath, []byte("---\ntitle: New\n---\n"), 0644)
	oldTime := time.Now().Add(-48 * time.Hour)
	newTime := time.Now().Add(-1 * time.Hour)
	_ = os.Chtimes(oldPath, oldTime, oldTime)
	_ = os.Chtimes(newPath, newTime, newTime)

	pages, err := listFromStore(context.Background(), store, 5)
	if err != nil {
		t.Fatal(err)
	}
	if len(pages) != 2 {
		t.Fatalf("got %d pages", len(pages))
	}
	if pages[0].Path != "new.md" {
		t.Fatalf("expected new.md first, got %s", pages[0].Path)
	}
	if pages[0].Title != "New" {
		t.Fatalf("title = %q", pages[0].Title)
	}
}

func TestTitleize(t *testing.T) {
	if got := titleize("pages/my-note.md"); got != "My Note" {
		t.Fatalf("titleize = %q", got)
	}
}

func TestList_NonASCIIPath(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not in PATH")
	}
	ctx := context.Background()
	root := t.TempDir()
	store, err := storage.NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	g, err := versioning.NewGit(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range []struct{ path, body string }{
		{"plain.md", "body"},
		{"élan-vital.md", "body"},
		{"日本語.md", "---\ntitle: Japanese\n---\n"},
	} {
		if err := os.WriteFile(filepath.Join(root, f.path), []byte(f.body), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := g.Commit(ctx, f.path, "alice", "add "+f.path); err != nil {
			t.Fatal(err)
		}
	}

	pages, err := List(ctx, root, store, 10)
	if err != nil {
		t.Fatal(err)
	}
	want := []struct{ path, title string }{
		{"日本語.md", "Japanese"},
		{"élan-vital.md", "Élan Vital"},
		{"plain.md", "Plain"},
	}
	if len(pages) != len(want) {
		t.Fatalf("got %d pages, want %d: %+v", len(pages), len(want), pages)
	}
	for i, w := range want {
		if pages[i].Path != w.path || pages[i].Title != w.title || pages[i].Actor != "alice" {
			t.Errorf("page %d = %+v, want path %q title %q", i, pages[i], w.path, w.title)
		}
	}
}
