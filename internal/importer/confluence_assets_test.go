package importer

import (
	"os"
	"path/filepath"
	"testing"
	"strings"
)

func TestRewriteConfluenceExportAssetLinks_RewritesToAssets(t *testing.T) {
	in := `<html><body><img src="attachments/123/pic.png"/><a href='download/attachments/999/doc.pdf'>x</a></body></html>`
	out := rewriteConfluenceExportAssetLinks(in)
	if out == in {
		t.Fatal("expected rewrite")
	}
	if !strings.Contains(out, `src="_assets/pic.png"`) {
		t.Fatalf("missing rewritten img src: %s", out)
	}
	if !strings.Contains(out, `href="_assets/doc.pdf"`) {
		t.Fatalf("missing rewritten href: %s", out)
	}
}

func TestConfluenceExport_AttachmentsMappedToPageAssets(t *testing.T) {
	root := t.TempDir()
	// Minimal entities.xml (unused here but present in typical exports)
	_ = os.WriteFile(filepath.Join(root, "entities.xml"), []byte("<hibernate-generic></hibernate-generic>"), 0o644)

	// Page in folder Space/Page.html referencing an attachment.
	if err := os.MkdirAll(filepath.Join(root, "Space", "attachments", "1"), 0o755); err != nil {
		t.Fatal(err)
	}
	pageHTML := `<!doctype html><html><head><title>Page</title><meta name="ajs-page-id" content="1"></head><body><p><img src="attachments/1/pic.png"/></p></body></html>`
	if err := os.WriteFile(filepath.Join(root, "Space", "Page.html"), []byte(pageHTML), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "Space", "attachments", "1", "pic.png"), []byte("PNGDATA"), 0o644); err != nil {
		t.Fatal(err)
	}

	src, err := NewConfluence(root)
	if err != nil {
		t.Fatalf("NewConfluence: %v", err)
	}

	// Expect the attachment to be associated with the page directory ("Space") not the attachment dir.
	foundAsset := false
	for _, att := range src.attachments {
		if att.fileName == "pic.png" && att.pagePath == filepath.Join("Space") {
			foundAsset = true
		}
	}
	if !foundAsset {
		t.Fatalf("expected attachment mapped to Space page dir, got: %+v", src.attachments)
	}
}

