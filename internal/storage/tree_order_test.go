package storage

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type frontmatterOnlyStore struct {
	readCalls            int
	readFrontmatterCalls int
}

func (s *frontmatterOnlyStore) Read(context.Context, string) ([]byte, error) {
	s.readCalls++
	return nil, errors.New("full Read should not be used for tree order metadata")
}

func (s *frontmatterOnlyStore) Write(context.Context, string, []byte) error  { return nil }
func (s *frontmatterOnlyStore) Delete(context.Context, string) error         { return nil }
func (s *frontmatterOnlyStore) Stat(context.Context, string) (*Entry, error) { return nil, nil }
func (s *frontmatterOnlyStore) Exists(context.Context, string) bool          { return false }
func (s *frontmatterOnlyStore) AbsPath(path string) string                   { return path }

func (s *frontmatterOnlyStore) List(context.Context, string) ([]Entry, error) {
	return []Entry{
		{Path: "b.md", Name: "b.md", Size: 1024, ModTime: time.Unix(2, 0)},
		{Path: "a.md", Name: "a.md", Size: 1024, ModTime: time.Unix(1, 0)},
	}, nil
}

func (s *frontmatterOnlyStore) ReadFrontmatter(_ context.Context, path string) (map[string]any, error) {
	s.readFrontmatterCalls++
	if path == "b.md" {
		return map[string]any{"order": 2}, nil
	}
	return map[string]any{"order": 1}, nil
}

func TestBuildTreeReadsOrderFromFrontmatterOnlyWhenAvailable(t *testing.T) {
	store := &frontmatterOnlyStore{}
	tree, err := BuildTree(context.Background(), store, "/", 0)
	if err != nil {
		t.Fatalf("build tree: %v", err)
	}
	if store.readCalls != 0 {
		t.Fatalf("BuildTree used full Read %d time(s); expected frontmatter-only reads", store.readCalls)
	}
	if store.readFrontmatterCalls != 2 {
		t.Fatalf("ReadFrontmatter calls = %d, want 2", store.readFrontmatterCalls)
	}
	if got, want := tree.Children[0].Name, "a.md"; got != want {
		t.Fatalf("first child = %s, want %s", got, want)
	}
}

func TestBuildTreeSortsDirectoriesByStoredOrder(t *testing.T) {
	root := t.TempDir()
	store, err := NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, dir := range []string{"zeta", "alpha"} {
		if err := os.Mkdir(filepath.Join(root, dir), 0755); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.WriteTreeOrder(context.Background(), map[string]int{"zeta": 1, "alpha": 2}); err != nil {
		t.Fatal(err)
	}
	tree, err := BuildTree(context.Background(), store, "", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(tree.Children) < 2 {
		t.Fatalf("expected directories, got %#v", tree.Children)
	}
	if tree.Children[0].Name != "zeta" || tree.Children[1].Name != "alpha" {
		t.Fatalf("directory order = %s, %s; want zeta, alpha", tree.Children[0].Name, tree.Children[1].Name)
	}
}

func TestBuildTreeMarksInvalidFrontmatterWithoutDroppingFile(t *testing.T) {
	root := t.TempDir()
	store, err := NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	content := []byte("---\ntitle: Broken\ntitle: Duplicate\n---\n\n# Broken\n")
	if err := store.Write(context.Background(), "broken.md", content); err != nil {
		t.Fatal(err)
	}

	tree, err := BuildTree(context.Background(), store, "", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(tree.Children) != 1 {
		t.Fatalf("children = %d, want 1", len(tree.Children))
	}
	child := tree.Children[0]
	if child.Name != "broken.md" {
		t.Fatalf("child name = %s, want broken.md", child.Name)
	}
	if child.FrontmatterError == "" {
		t.Fatalf("expected frontmatter error on invalid markdown tree entry")
	}
}
