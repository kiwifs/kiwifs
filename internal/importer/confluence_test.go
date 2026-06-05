package importer

import (
	"os"
	"path/filepath"
	"testing"
)

func TestConfluenceHierarchy_PrefersPageIDOverTitle(t *testing.T) {
	dir := t.TempDir()

	// Minimal entities.xml with two pages that share a title but have different parents.
	entities := `<?xml version="1.0" encoding="UTF-8"?>
<hibernate-generic>
  <object class="Page">
    <id>1</id>
    <property name="title">Home</property>
  </object>
  <object class="Page">
    <id>2</id>
    <property name="title">Child</property>
    <property name="parent"><id>1</id></property>
  </object>
  <object class="Page">
    <id>3</id>
    <property name="title">Home</property>
  </object>
  <object class="Page">
    <id>4</id>
    <property name="title">Child</property>
    <property name="parent"><id>3</id></property>
  </object>
</hibernate-generic>`
	if err := os.WriteFile(filepath.Join(dir, "entities.xml"), []byte(entities), 0o644); err != nil {
		t.Fatal(err)
	}

	// Two html files that both have title "Child" but different page IDs.
	htmlA := `<!doctype html><html><head><title>Child</title><meta name="ajs-page-id" content="2"></head><body><p>A</p></body></html>`
	htmlB := `<!doctype html><html><head><title>Child</title><meta name="ajs-page-id" content="4"></head><body><p>B</p></body></html>`
	if err := os.WriteFile(filepath.Join(dir, "a.html"), []byte(htmlA), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "b.html"), []byte(htmlB), 0o644); err != nil {
		t.Fatal(err)
	}

	src, err := NewConfluence(dir)
	if err != nil {
		t.Fatalf("NewConfluence: %v", err)
	}

	if len(src.pages) != 2 {
		t.Fatalf("expected 2 pages, got %d", len(src.pages))
	}
	paths := map[string]bool{}
	for _, p := range src.pages {
		paths[p.relPath] = true
		if p.meta["confluence_page_id"] == nil {
			t.Fatalf("expected confluence_page_id in meta for %s", p.title)
		}
	}
	if !paths["home-1/child"] || !paths["home-3/child"] {
		t.Fatalf("expected distinct hierarchy paths by ID, got: %#v", paths)
	}
}

