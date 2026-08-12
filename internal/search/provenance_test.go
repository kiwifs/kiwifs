package search

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

type claimRow struct {
	kind        string
	recordIndex int
	payload     map[string]any
}

func provenanceRows(t *testing.T, s *SQLite, path string) []claimRow {
	t.Helper()
	rows, err := s.readDB.Query(
		`SELECT kind, record_index, json FROM provenance WHERE path = ? ORDER BY record_index`, path)
	if err != nil {
		t.Fatalf("query provenance: %v", err)
	}
	defer rows.Close()

	var out []claimRow
	for rows.Next() {
		var (
			r   claimRow
			raw string
		)
		if err := rows.Scan(&r.kind, &r.recordIndex, &raw); err != nil {
			t.Fatalf("scan: %v", err)
		}
		if err := json.Unmarshal([]byte(raw), &r.payload); err != nil {
			t.Fatalf("unmarshal %q: %v", raw, err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows: %v", err)
	}
	return out
}

const claimPage = `---
title: Atlas
kind: project
---

# Findings

:::claim{evidence=inferred confidence=0.6}
A non-linear level-2 stacker wins when the dominant feature is sparse.
:::

Also worth noting: :claim[hill-climbing is measurably worse]{evidence=stated confidence=0.9 source="sources/reports/575784"} on this data.
`

func TestIndexMetaPopulatesProvenance(t *testing.T) {
	s := newTestSQLite(t)
	ctx := context.Background()

	if err := s.IndexMeta(ctx, "projects/atlas/index.md", []byte(claimPage)); err != nil {
		t.Fatalf("IndexMeta: %v", err)
	}

	rows := provenanceRows(t, s, "projects/atlas/index.md")
	if len(rows) != 2 {
		t.Fatalf("got %d provenance rows, want 2: %+v", len(rows), rows)
	}

	if rows[0].kind != "inferred" {
		t.Errorf("row 0 kind = %q, want inferred", rows[0].kind)
	}
	if rows[0].recordIndex != 0 || rows[1].recordIndex != 1 {
		t.Errorf("record indexes = %d, %d; want 0, 1", rows[0].recordIndex, rows[1].recordIndex)
	}
	if got := rows[0].payload["scope"]; got != "block" {
		t.Errorf("row 0 scope = %v, want block", got)
	}
	// A JSON number, not the string "0.6" — SQLite orders NULL < numeric <
	// TEXT, so a string sentinel would corrupt every confidence comparison.
	if got, ok := rows[0].payload["confidence"].(float64); !ok || got != 0.6 {
		t.Errorf("row 0 confidence = %#v, want the number 0.6", rows[0].payload["confidence"])
	}
	// An unsourced claim must be null so `source IS NULL` finds it.
	if got, present := rows[0].payload["source"]; !present || got != nil {
		t.Errorf("row 0 source = %#v, want nil", got)
	}

	if rows[1].kind != "stated" {
		t.Errorf("row 1 kind = %q, want stated", rows[1].kind)
	}
	if got := rows[1].payload["scope"]; got != "inline" {
		t.Errorf("row 1 scope = %v, want inline", got)
	}
	if got := rows[1].payload["source"]; got != "sources/reports/575784" {
		t.Errorf("row 1 source = %v", got)
	}
	if got := rows[1].payload["text"]; got != "hill-climbing is measurably worse" {
		t.Errorf("row 1 text = %v", got)
	}
}

// TestIndexMetaReplacesProvenance: rewriting a page with fewer claims must
// leave no stale rows, the same contract page_records has.
func TestIndexMetaReplacesProvenance(t *testing.T) {
	s := newTestSQLite(t)
	ctx := context.Background()
	path := "projects/atlas/index.md"

	if err := s.IndexMeta(ctx, path, []byte(claimPage)); err != nil {
		t.Fatalf("IndexMeta: %v", err)
	}
	if got := len(provenanceRows(t, s, path)); got != 2 {
		t.Fatalf("setup: got %d rows, want 2", got)
	}

	shorter := "---\ntitle: Atlas\n---\n\n:::claim{evidence=stated}\nOnly one left.\n:::\n"
	if err := s.IndexMeta(ctx, path, []byte(shorter)); err != nil {
		t.Fatalf("IndexMeta: %v", err)
	}
	rows := provenanceRows(t, s, path)
	if len(rows) != 1 {
		t.Fatalf("got %d rows after rewrite, want 1: %+v", len(rows), rows)
	}
	if rows[0].payload["text"] != "Only one left." {
		t.Errorf("text = %v", rows[0].payload["text"])
	}

	// And a page that loses every claim keeps none.
	if err := s.IndexMeta(ctx, path, []byte("---\ntitle: Atlas\n---\n\nJust prose.\n")); err != nil {
		t.Fatalf("IndexMeta: %v", err)
	}
	if rows := provenanceRows(t, s, path); len(rows) != 0 {
		t.Fatalf("got %d rows, want 0: %+v", len(rows), rows)
	}
}

func TestRemoveMetaClearsProvenance(t *testing.T) {
	s := newTestSQLite(t)
	ctx := context.Background()
	path := "projects/atlas/index.md"

	if err := s.IndexMeta(ctx, path, []byte(claimPage)); err != nil {
		t.Fatalf("IndexMeta: %v", err)
	}
	if err := s.RemoveMeta(ctx, path); err != nil {
		t.Fatalf("RemoveMeta: %v", err)
	}
	if rows := provenanceRows(t, s, path); len(rows) != 0 {
		t.Fatalf("got %d rows after RemoveMeta, want 0", len(rows))
	}
}

func TestRemoveAllClearsProvenance(t *testing.T) {
	s := newTestSQLite(t)
	ctx := context.Background()
	path := "projects/atlas/index.md"

	if err := s.IndexMeta(ctx, path, []byte(claimPage)); err != nil {
		t.Fatalf("IndexMeta: %v", err)
	}
	if err := s.RemoveAll(ctx, path); err != nil {
		t.Fatalf("RemoveAll: %v", err)
	}
	if rows := provenanceRows(t, s, path); len(rows) != 0 {
		t.Fatalf("got %d rows after RemoveAll, want 0", len(rows))
	}
}

func TestReindexRebuildsProvenance(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "projects", "atlas"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "projects", "atlas", "index.md"), []byte(claimPage), 0o644); err != nil {
		t.Fatal(err)
	}

	s := newTestSQLiteAt(t, dir)
	ctx := context.Background()
	if _, err := s.Reindex(ctx); err != nil {
		t.Fatalf("Reindex: %v", err)
	}

	rows := provenanceRows(t, s, "projects/atlas/index.md")
	if len(rows) != 2 {
		t.Fatalf("got %d rows after reindex, want 2: %+v", len(rows), rows)
	}
	if got, ok := rows[0].payload["confidence"].(float64); !ok || got != 0.6 {
		t.Errorf("confidence = %#v, want 0.6 — the reindex path must agree with IndexMeta",
			rows[0].payload["confidence"])
	}

	// A second reindex must not double the rows.
	if _, err := s.Reindex(ctx); err != nil {
		t.Fatalf("Reindex: %v", err)
	}
	if got := len(provenanceRows(t, s, "projects/atlas/index.md")); got != 2 {
		t.Fatalf("got %d rows after a second reindex, want 2", got)
	}
}

// TestIndexMetaSurvivesBadConfidence: a non-numeric confidence is an authoring
// mistake, not a write failure. The claim must still be indexed — hiding it
// would remove it from the audit query that exists to find weak claims.
func TestIndexMetaSurvivesBadConfidence(t *testing.T) {
	s := newTestSQLite(t)
	ctx := context.Background()
	path := "notes/bad.md"
	page := "---\ntitle: Bad\n---\n\n:::claim{evidence=inferred confidence=high}\nGuessy.\n:::\n"

	if err := s.IndexMeta(ctx, path, []byte(page)); err != nil {
		t.Fatalf("IndexMeta must not fail on a malformed attribute: %v", err)
	}
	rows := provenanceRows(t, s, path)
	if len(rows) != 1 {
		t.Fatalf("got %d rows, want the claim to survive: %+v", len(rows), rows)
	}
	if got, present := rows[0].payload["confidence"]; !present || got != nil {
		t.Errorf("confidence = %#v, want nil rather than the string \"high\"", got)
	}
}

// TestIndexMetaClaimsAndDataBlocksCoexist: the two record grains are separate
// tables and must not consume each other's content.
func TestIndexMetaClaimsAndDataBlocksCoexist(t *testing.T) {
	s := newTestSQLite(t)
	ctx := context.Background()
	path := "datasets/sales/data.md"
	page := "---\ntitle: Sales\n---\n\n```kiwi-data\nkind: dataset-schema\nrecords:\n  - name: target\n    dtype: float\n```\n\n:::claim{evidence=inferred confidence=0.5}\nThe target is skewed.\n:::\n"

	if err := s.IndexMeta(ctx, path, []byte(page)); err != nil {
		t.Fatalf("IndexMeta: %v", err)
	}
	if got := len(pageRecords(t, s, path)); got != 1 {
		t.Errorf("got %d page_records rows, want 1", got)
	}
	if got := len(provenanceRows(t, s, path)); got != 1 {
		t.Errorf("got %d provenance rows, want 1", got)
	}
}
