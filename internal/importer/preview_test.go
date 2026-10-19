package importer

import (
	"strings"
	"testing"
)

func TestBuildPreviewItemRawContent(t *testing.T) {
	rec := Record{
		SourceID:   "markdown:vault:0",
		PrimaryKey: "one",
		Fields: map[string]any{
			"_raw_content": "---\nstatus: open\n---\n# One\nSee [[Two]].\n",
			"status":       "open",
		},
	}
	item := BuildPreviewItem(rec, RecordPreviewOpts{Prefix: "notes", SourceName: "vault"})

	if strings.HasPrefix(item.BodyPreview, "---") {
		t.Fatalf("body preview still contains frontmatter delimiter: %q", item.BodyPreview)
	}
	if !strings.HasPrefix(item.BodyPreview, "# One") {
		t.Fatalf("body preview = %q, want it to start with the heading", item.BodyPreview)
	}
	if _, ok := item.Frontmatter["_raw_content"]; ok {
		t.Fatal("_raw_content should not be exposed in preview frontmatter")
	}
	if item.Frontmatter["status"] != "open" {
		t.Fatalf("status = %v, want open", item.Frontmatter["status"])
	}
}

func TestBodyAfterFrontmatterShortInput(t *testing.T) {
	for _, in := range []string{"", "-", "# a", "no frontmatter here"} {
		if got := BodyAfterFrontmatter([]byte(in)); got != in {
			t.Fatalf("BodyAfterFrontmatter(%q) = %q", in, got)
		}
	}
}
