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

func TestBuildTreeSortsAlphabetically(t *testing.T) {
	store := &frontmatterOnlyStore{}
	tree, err := BuildTree(context.Background(), store, "/", 0)
	if err != nil {
		t.Fatalf("build tree: %v", err)
	}
	if got, want := tree.Children[0].Name, "a.md"; got != want {
		t.Fatalf("first child = %s, want %s (natural sort)", got, want)
	}
}

func TestBuildTreeNaturalSortDirectories(t *testing.T) {
	root := t.TempDir()
	store, err := NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, dir := range []string{"10-graphs", "2-arrays", "1-math"} {
		if err := os.Mkdir(filepath.Join(root, dir), 0755); err != nil {
			t.Fatal(err)
		}
	}
	tree, err := BuildTree(context.Background(), store, "", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(tree.Children) < 3 {
		t.Fatalf("expected 3 directories, got %d", len(tree.Children))
	}
	want := []string{"1-math", "2-arrays", "10-graphs"}
	for i, w := range want {
		if tree.Children[i].Name != w {
			t.Fatalf("child[%d] = %s, want %s", i, tree.Children[i].Name, w)
		}
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
