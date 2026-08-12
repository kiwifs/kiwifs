package markdown

import (
	"strings"
	"testing"
)

func TestExtractDataBlocksMultiplePerPage(t *testing.T) {
	content := []byte("---\ntitle: Sales\n---\n\n" +
		"# Data\n\n" +
		"```kiwi-data\n" +
		"kind: dataset-schema\n" +
		"records:\n" +
		"  - name: target\n" +
		"    dtype: float\n" +
		"    missing-rate: 0.116\n" +
		"  - name: id\n" +
		"    dtype: int\n" +
		"    missing-rate: 0\n" +
		"```\n\n" +
		"```kiwi-data\n" +
		"kind: did-not-work\n" +
		"records:\n" +
		"  - step: dedupe\n" +
		"    delta: -0.055\n" +
		"```\n")

	blocks, err := ExtractDataBlocks(content)
	if err != nil {
		t.Fatalf("ExtractDataBlocks: %v", err)
	}
	if len(blocks) != 2 {
		t.Fatalf("got %d blocks, want 2", len(blocks))
	}
	if blocks[0].Kind != "dataset-schema" || blocks[0].Index != 0 {
		t.Errorf("block 0 = {kind:%q index:%d}, want {dataset-schema 0}", blocks[0].Kind, blocks[0].Index)
	}
	if len(blocks[0].Records) != 2 {
		t.Fatalf("block 0 has %d records, want 2", len(blocks[0].Records))
	}
	if got := blocks[0].Records[0]["name"]; got != "target" {
		t.Errorf("records[0].name = %v, want target", got)
	}
	if got := blocks[0].Records[0]["missing-rate"]; got != 0.116 {
		t.Errorf("records[0].missing-rate = %v (%T), want 0.116 float", got, got)
	}
	if blocks[1].Kind != "did-not-work" || blocks[1].Index != 1 {
		t.Errorf("block 1 = {kind:%q index:%d}, want {did-not-work 1}", blocks[1].Kind, blocks[1].Index)
	}
	if blocks[0].Line == 0 || blocks[1].Line <= blocks[0].Line {
		t.Errorf("lines = %d, %d; want ascending non-zero", blocks[0].Line, blocks[1].Line)
	}
}

func TestExtractDataBlocksIgnoresOtherFences(t *testing.T) {
	content := []byte("```yaml\nkind: dataset-schema\nrecords:\n  - name: x\n```\n\n" +
		"```go\nfunc main() {}\n```\n\n" +
		"```kiwi-query\nTABLE title FROM \"notes\"\n```\n\n" +
		"```\nkind: bare\n```\n")

	blocks, err := ExtractDataBlocks(content)
	if err != nil {
		t.Fatalf("ExtractDataBlocks: %v", err)
	}
	if len(blocks) != 0 {
		t.Fatalf("got %d blocks, want 0", len(blocks))
	}
}

func TestExtractDataBlocksMalformedYAMLDoesNotDropOthers(t *testing.T) {
	content := []byte("```kiwi-data\n" +
		"kind: dataset-schema\n" +
		"records:\n" +
		"  - name: ok\n" +
		"```\n\n" +
		"```kiwi-data\n" +
		"kind: broken\n" +
		"records:\n" +
		"  - name: [unterminated\n" +
		"```\n\n" +
		"```kiwi-data\n" +
		"kind: ledger\n" +
		"records:\n" +
		"  - step: blend\n" +
		"```\n")

	blocks, err := ExtractDataBlocks(content)
	if err == nil {
		t.Fatal("want an error for the malformed block, got nil")
	}
	if !strings.Contains(err.Error(), "block 1") {
		t.Errorf("error should name the offending block index: %v", err)
	}
	if len(blocks) != 2 {
		t.Fatalf("got %d blocks, want the 2 that parsed", len(blocks))
	}
	// Indices stay stable across the broken sibling so a block's identity
	// does not shift when an unrelated block is fixed.
	if blocks[0].Index != 0 || blocks[1].Index != 2 {
		t.Errorf("indices = %d, %d; want 0, 2", blocks[0].Index, blocks[1].Index)
	}
}

func TestExtractDataBlocksSkipsBlockWithoutKind(t *testing.T) {
	content := []byte("```kiwi-data\n" +
		"records:\n" +
		"  - name: target\n" +
		"```\n")

	blocks, err := ExtractDataBlocks(content)
	if err == nil || !strings.Contains(err.Error(), "missing kind") {
		t.Fatalf("want a missing-kind error, got %v", err)
	}
	if len(blocks) != 0 {
		t.Fatalf("got %d blocks, want 0", len(blocks))
	}
}

func TestExtractDataBlocksKindFromInfoString(t *testing.T) {
	tests := []struct {
		name  string
		fence string
	}{
		{"bare word", "```kiwi-data dataset-schema"},
		{"kind= form", "```kiwi-data kind=dataset-schema"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			content := []byte(tc.fence + "\n- name: target\n  dtype: float\n```\n")
			blocks, err := ExtractDataBlocks(content)
			if err != nil {
				t.Fatalf("ExtractDataBlocks: %v", err)
			}
			if len(blocks) != 1 {
				t.Fatalf("got %d blocks, want 1", len(blocks))
			}
			if blocks[0].Kind != "dataset-schema" {
				t.Errorf("kind = %q, want dataset-schema", blocks[0].Kind)
			}
			if len(blocks[0].Records) != 1 || blocks[0].Records[0]["name"] != "target" {
				t.Errorf("records = %v", blocks[0].Records)
			}
		})
	}
}

func TestExtractDataBlocksBodyKindBeatsInfoString(t *testing.T) {
	content := []byte("```kiwi-data from-info\nkind: from-body\nrecords:\n  - a: 1\n```\n")
	blocks, err := ExtractDataBlocks(content)
	if err != nil {
		t.Fatalf("ExtractDataBlocks: %v", err)
	}
	if len(blocks) != 1 || blocks[0].Kind != "from-body" {
		t.Fatalf("blocks = %+v, want kind from-body", blocks)
	}
}

func TestExtractDataBlocksSingleRecordMappingForm(t *testing.T) {
	content := []byte("```kiwi-data\n" +
		"kind: summary\n" +
		"ordered: false\n" +
		"rows: 750000\n" +
		"dominant-missing-rate: 0.116\n" +
		"```\n")

	blocks, err := ExtractDataBlocks(content)
	if err != nil {
		t.Fatalf("ExtractDataBlocks: %v", err)
	}
	if len(blocks) != 1 {
		t.Fatalf("got %d blocks, want 1", len(blocks))
	}
	rec := blocks[0].Records
	if len(rec) != 1 {
		t.Fatalf("got %d records, want 1", len(rec))
	}
	if _, ok := rec[0]["kind"]; ok {
		t.Error("the discriminator should not be re-emitted as a record field")
	}
	if rec[0]["ordered"] != false {
		t.Errorf("ordered = %v, want false", rec[0]["ordered"])
	}
	if rec[0]["rows"] != 750000 {
		t.Errorf("rows = %v (%T), want 750000 int", rec[0]["rows"], rec[0]["rows"])
	}
}

func TestExtractDataBlocksNullStaysNull(t *testing.T) {
	// Phase 0 finding: a TEXT sentinel in a numeric field silently corrupts
	// every range filter, because SQLite orders NULL < numeric < TEXT.
	// `null` must survive the round trip as a real null.
	content := []byte("```kiwi-data\n" +
		"kind: dataset-schema\n" +
		"records:\n" +
		"  - name: target\n" +
		"    missing-rate: null\n" +
		"```\n")

	blocks, err := ExtractDataBlocks(content)
	if err != nil {
		t.Fatalf("ExtractDataBlocks: %v", err)
	}
	rec := blocks[0].Records[0]
	v, ok := rec["missing-rate"]
	if !ok {
		t.Fatal("missing-rate key was dropped")
	}
	if v != nil {
		t.Errorf("missing-rate = %v (%T), want nil", v, v)
	}
}

func TestExtractDataBlocksEmptyAndNonCollectionBodies(t *testing.T) {
	tests := []struct {
		name    string
		content string
		wantErr string
	}{
		{"empty body", "```kiwi-data\n```\n", "empty block"},
		{"scalar body", "```kiwi-data\njust a string\n```\n", "mapping or a list"},
		{"kind only", "```kiwi-data\nkind: dataset-schema\n```\n", "no records"},
		{"empty record list", "```kiwi-data\nkind: x\nrecords: []\n```\n", "no records"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			blocks, err := ExtractDataBlocks([]byte(tc.content))
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("err = %v, want one containing %q", err, tc.wantErr)
			}
			if len(blocks) != 0 {
				t.Errorf("got %d blocks, want 0", len(blocks))
			}
		})
	}
}

func TestExtractDataBlocksNoBlocks(t *testing.T) {
	blocks, err := ExtractDataBlocks([]byte("# Just prose\n\nNothing to see.\n"))
	if err != nil {
		t.Fatalf("ExtractDataBlocks: %v", err)
	}
	if blocks != nil {
		t.Fatalf("got %v, want nil", blocks)
	}
}
