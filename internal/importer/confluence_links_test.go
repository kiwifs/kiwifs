package importer

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRewriteConfluenceExportPageLinks_RewritesAnchors(t *testing.T) {
	index := map[string]string{
		"child.html": "home/child",
		"child":        "home/child",
	}
	in := `<html><body><p>See <a href="Child.html">the child page</a> and <a href='child.html#section'>section</a>.</p></body></html>`
	out := rewriteConfluenceExportPageLinks(in, index)
	if !strings.Contains(out, "[[home/child|the child page]]") {
		t.Fatalf("expected wiki link with label, got: %s", out)
	}
	if !strings.Contains(out, "[[home/child#section") {
		t.Fatalf("expected wiki link with fragment, got: %s", out)
	}
}

func TestRewriteConfluenceExportPageLinks_SkipsExternalAndAssets(t *testing.T) {
	index := map[string]string{"child.html": "home/child"}
	in := `<a href="https://example.com/x.html">ext</a><a href="_assets/doc.pdf">doc</a>`
	out := rewriteConfluenceExportPageLinks(in, index)
	if out != in {
		t.Fatalf("expected unchanged external/asset links, got: %s", out)
	}
}

func TestConfluenceExport_PageLinksRewrittenToWikiPaths(t *testing.T) {
	root := t.TempDir()
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
</hibernate-generic>`
	if err := os.WriteFile(filepath.Join(root, "entities.xml"), []byte(entities), 0o644); err != nil {
		t.Fatal(err)
	}

	homeHTML := `<!doctype html><html><head><title>Home</title><meta name="ajs-page-id" content="1"></head><body><p>Go to <a href="child.html">Child</a>.</p></body></html>`
	childHTML := `<!doctype html><html><head><title>Child</title><meta name="ajs-page-id" content="2"></head><body><p>Child body</p></body></html>`
	if err := os.WriteFile(filepath.Join(root, "home.html"), []byte(homeHTML), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "child.html"), []byte(childHTML), 0o644); err != nil {
		t.Fatal(err)
	}

	src, err := NewConfluence(root)
	if err != nil {
		t.Fatalf("NewConfluence: %v", err)
	}

	var homeMD string
	for _, p := range src.pages {
		if p.relPath == "home" {
			homeMD = p.markdown
		}
	}
	if homeMD == "" {
		t.Fatalf("expected home page, got: %+v", src.pages)
	}
	if !strings.Contains(homeMD, "[[home/child") {
		t.Fatalf("expected wiki page link in home markdown, got: %q", homeMD)
	}
}

func TestConfluenceExport_PageLinksFromTestdataFixture(t *testing.T) {
	root := filepath.Join("testdata", "confluence-mini")
	if _, err := os.Stat(root); err != nil {
		t.Skip("testdata/confluence-mini not present")
	}

	src, err := NewConfluence(root)
	if err != nil {
		t.Fatalf("NewConfluence: %v", err)
	}

	var homeMD string
	for _, p := range src.pages {
		if strings.EqualFold(p.title, "Home") || p.relPath == "home" {
			homeMD = p.markdown
		}
	}
	if !strings.Contains(homeMD, "[[home/child") {
		t.Fatalf("expected wiki link from fixture, got home markdown: %q pages=%+v", homeMD, src.pages)
	}
}
