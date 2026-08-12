package search

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/kiwifs/kiwifs/internal/storage"
)

// newTestSQLiteAt is newTestSQLite over a caller-supplied root, so a test can
// write files into the workspace before reindexing it.
func newTestSQLiteAt(t *testing.T, dir string) *SQLite {
	t.Helper()
	store, err := storage.NewLocal(dir)
	if err != nil {
		t.Fatalf("storage: %v", err)
	}
	s, err := NewSQLite(dir, store)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func dataBlockPage(kind string, body string) []byte {
	return []byte("---\ntitle: Test\n---\n\n```kiwi-data\nkind: " + kind + "\n" + body + "```\n")
}

type recordRow struct {
	blockIndex  int
	kind        string
	recordIndex int
	json        string
}

func pageRecords(t *testing.T, s *SQLite, path string) []recordRow {
	t.Helper()
	rows, err := s.readDB.Query(
		`SELECT block_index, kind, record_index, json FROM page_records WHERE path = ?
		 ORDER BY block_index, record_index`, path)
	if err != nil {
		t.Fatalf("query page_records: %v", err)
	}
	defer rows.Close()
	var out []recordRow
	for rows.Next() {
		var r recordRow
		if err := rows.Scan(&r.blockIndex, &r.kind, &r.recordIndex, &r.json); err != nil {
			t.Fatalf("scan: %v", err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows: %v", err)
	}
	return out
}

func TestIndexMetaStoresDataBlockRecords(t *testing.T) {
	s := newTestSQLite(t)

	content := dataBlockPage("dataset-schema",
		"records:\n  - name: target\n    dtype: float\n    missing-rate: 0.116\n  - name: id\n    dtype: int\n    missing-rate: 0\n")
	if err := s.IndexMeta(ctxBG, "datasets/sales/data.md", content); err != nil {
		t.Fatalf("IndexMeta: %v", err)
	}

	got := pageRecords(t, s, "datasets/sales/data.md")
	if len(got) != 2 {
		t.Fatalf("got %d records, want 2", len(got))
	}
	if got[0].kind != "dataset-schema" || got[0].blockIndex != 0 || got[0].recordIndex != 0 {
		t.Errorf("row 0 = %+v", got[0])
	}
	if got[0].json != `{"dtype":"float","missing-rate":0.116,"name":"target"}` {
		t.Errorf("row 0 json = %s", got[0].json)
	}
	if got[1].recordIndex != 1 {
		t.Errorf("row 1 record_index = %d, want 1", got[1].recordIndex)
	}
}

func TestIndexMetaReplacesStaleRecords(t *testing.T) {
	s := newTestSQLite(t)
	path := "datasets/sales/data.md"

	three := dataBlockPage("dataset-schema",
		"records:\n  - name: a\n  - name: b\n  - name: c\n")
	if err := s.IndexMeta(ctxBG, path, three); err != nil {
		t.Fatalf("IndexMeta: %v", err)
	}
	if n := len(pageRecords(t, s, path)); n != 3 {
		t.Fatalf("got %d records, want 3", n)
	}

	one := dataBlockPage("dataset-schema", "records:\n  - name: a\n")
	if err := s.IndexMeta(ctxBG, path, one); err != nil {
		t.Fatalf("IndexMeta rewrite: %v", err)
	}
	got := pageRecords(t, s, path)
	if len(got) != 1 {
		t.Fatalf("got %d records after shrinking the block, want 1", len(got))
	}
	if got[0].json != `{"name":"a"}` {
		t.Errorf("json = %s", got[0].json)
	}

	// Removing the block entirely must leave nothing behind.
	if err := s.IndexMeta(ctxBG, path, []byte("---\ntitle: Test\n---\n\nJust prose.\n")); err != nil {
		t.Fatalf("IndexMeta prose: %v", err)
	}
	if n := len(pageRecords(t, s, path)); n != 0 {
		t.Fatalf("got %d records after removing the block, want 0", n)
	}
}

func TestIndexMetaMalformedBlockKeepsSiblings(t *testing.T) {
	s := newTestSQLite(t)
	path := "notes/mixed.md"

	content := []byte("```kiwi-data\nkind: good\nrecords:\n  - name: a\n```\n\n" +
		"```kiwi-data\nkind: bad\nrecords:\n  - name: [unterminated\n```\n\n" +
		"```kiwi-data\nkind: also-good\nrecords:\n  - name: c\n```\n")

	if err := s.IndexMeta(ctxBG, path, content); err != nil {
		t.Fatalf("IndexMeta should not fail on a malformed block: %v", err)
	}
	got := pageRecords(t, s, path)
	if len(got) != 2 {
		t.Fatalf("got %d records, want the 2 from the parseable blocks", len(got))
	}
	if got[0].kind != "good" || got[1].kind != "also-good" {
		t.Errorf("kinds = %q, %q", got[0].kind, got[1].kind)
	}
	if got[1].blockIndex != 2 {
		t.Errorf("block_index = %d, want 2 (indices stay stable across the broken block)", got[1].blockIndex)
	}
}

func TestIndexMetaRecordNullIsRealNull(t *testing.T) {
	// Phase 0 finding: SQLite orders NULL < numeric < TEXT, so a string
	// sentinel in a numeric field makes `> 0.1` true. Nulls must survive as
	// JSON nulls so json_extract yields SQL NULL and range filters exclude
	// them.
	s := newTestSQLite(t)
	path := "datasets/revenue/data.md"

	content := dataBlockPage("dataset-schema",
		"records:\n  - name: target\n    missing-rate: null\n  - name: id\n    missing-rate: 0.5\n")
	if err := s.IndexMeta(ctxBG, path, content); err != nil {
		t.Fatalf("IndexMeta: %v", err)
	}

	var n int
	if err := s.readDB.QueryRow(
		`SELECT COUNT(*) FROM page_records WHERE json_extract(json, '$.missing-rate') > 0.1`).Scan(&n); err != nil {
		t.Fatalf("query: %v", err)
	}
	if n != 1 {
		t.Fatalf("missing-rate > 0.1 matched %d rows, want 1 (null must not compare greater)", n)
	}
}

func TestRemoveMetaDropsRecords(t *testing.T) {
	s := newTestSQLite(t)
	path := "datasets/sales/data.md"

	if err := s.IndexMeta(ctxBG, path, dataBlockPage("dataset-schema", "records:\n  - name: a\n")); err != nil {
		t.Fatalf("IndexMeta: %v", err)
	}
	if err := s.RemoveMeta(ctxBG, path); err != nil {
		t.Fatalf("RemoveMeta: %v", err)
	}
	if n := len(pageRecords(t, s, path)); n != 0 {
		t.Fatalf("got %d records after RemoveMeta, want 0", n)
	}
}

func TestRemoveAllDropsRecords(t *testing.T) {
	s := newTestSQLite(t)
	path := "datasets/sales/data.md"

	if err := s.IndexMeta(ctxBG, path, dataBlockPage("dataset-schema", "records:\n  - name: a\n")); err != nil {
		t.Fatalf("IndexMeta: %v", err)
	}
	if err := s.RemoveAll(ctxBG, path); err != nil {
		t.Fatalf("RemoveAll: %v", err)
	}
	if n := len(pageRecords(t, s, path)); n != 0 {
		t.Fatalf("got %d records after RemoveAll, want 0", n)
	}
}

func TestReindexRebuildsRecords(t *testing.T) {
	dir := t.TempDir()
	s := newTestSQLiteAt(t, dir)

	page := filepath.Join(dir, "data.md")
	content := dataBlockPage("dataset-schema", "records:\n  - name: a\n  - name: b\n")
	if err := os.WriteFile(page, content, 0o644); err != nil {
		t.Fatalf("write page: %v", err)
	}

	if _, err := s.Reindex(ctxBG); err != nil {
		t.Fatalf("Reindex: %v", err)
	}
	got := pageRecords(t, s, "data.md")
	if len(got) != 2 {
		t.Fatalf("got %d records after reindex, want 2", len(got))
	}

	// A second pass must be stable, not double-count.
	if _, err := s.Reindex(ctxBG); err != nil {
		t.Fatalf("Reindex 2: %v", err)
	}
	if n := len(pageRecords(t, s, "data.md")); n != 2 {
		t.Fatalf("got %d records after the second reindex, want 2", n)
	}

	// Records for a file that no longer exists must not survive a rebuild.
	if err := os.Remove(page); err != nil {
		t.Fatalf("remove page: %v", err)
	}
	if _, err := s.Reindex(ctxBG); err != nil {
		t.Fatalf("Reindex 3: %v", err)
	}
	if n := len(pageRecords(t, s, "data.md")); n != 0 {
		t.Fatalf("got %d records after deleting the page, want 0", n)
	}
}
