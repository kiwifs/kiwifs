package dataview

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"testing"
)

// ---------- parsing ----------

func TestParseFromClaims(t *testing.T) {
	cases := []struct {
		name         string
		query        string
		wantEvidence string
		wantFrom     string
	}{
		{"bare", `TABLE text FROM CLAIMS`, "", ""},
		{"evidence", `TABLE text FROM CLAIMS "inferred"`, "inferred", ""},
		{"evidence unquoted", `TABLE text FROM CLAIMS inferred`, "inferred", ""},
		{"evidence and folder", `TABLE text FROM CLAIMS "stated" IN "projects/"`, "stated", "projects/"},
		{"folder only", `TABLE text FROM CLAIMS IN "projects/"`, "", "projects/"},
		// The bare form followed by another clause must not read the clause
		// keyword as an evidence class.
		{"bare then where", `TABLE text FROM CLAIMS WHERE confidence < 0.7`, "", ""},
		{"bare then sort", `TABLE text FROM CLAIMS SORT confidence ASC`, "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			plan, err := ParseQuery(tc.query)
			if err != nil {
				t.Fatalf("ParseDQL: %v", err)
			}
			if plan.Source != SourceClaims {
				t.Errorf("Source = %q, want %q", plan.Source, SourceClaims)
			}
			if plan.RecordKind != tc.wantEvidence {
				t.Errorf("RecordKind = %q, want %q", plan.RecordKind, tc.wantEvidence)
			}
			if plan.From != tc.wantFrom {
				t.Errorf("From = %q, want %q", plan.From, tc.wantFrom)
			}
		})
	}
}

func TestParseFromClaimsInRequiresFolder(t *testing.T) {
	if _, err := ParseQuery(`TABLE text FROM CLAIMS "stated" IN`); err == nil {
		t.Fatal("expected an error for IN with no folder")
	}
}

// ---------- compilation ----------

func TestCompileClaimsUsesProvenanceTable(t *testing.T) {
	plan, err := ParseQuery(`TABLE text, confidence FROM CLAIMS "inferred" WHERE confidence < 0.7`)
	if err != nil {
		t.Fatal(err)
	}
	sqlText, params, err := CompileSQL(plan)
	if err != nil {
		t.Fatalf("CompileSQL: %v", err)
	}
	if !strings.Contains(sqlText, "FROM provenance") {
		t.Errorf("SQL does not drive from provenance:\n%s", sqlText)
	}
	if strings.Contains(sqlText, "page_records") {
		t.Errorf("claims query leaked the kiwi-data table:\n%s", sqlText)
	}
	if !strings.Contains(sqlText, "LEFT JOIN file_meta") {
		t.Errorf("parent page frontmatter is not joined:\n%s", sqlText)
	}
	// The evidence class must be bound, never interpolated.
	if !strings.Contains(sqlText, "provenance.kind = ?") {
		t.Errorf("evidence filter is not parameterised:\n%s", sqlText)
	}
	found := false
	for _, p := range params {
		if p == "inferred" {
			found = true
		}
	}
	if !found {
		t.Errorf("params %v do not carry the evidence class", params)
	}
}

// TestCompileClaimsWithoutEvidenceHasNoKindFilter: an omitted evidence class
// means every class, not the empty-string class.
func TestCompileClaimsWithoutEvidenceHasNoKindFilter(t *testing.T) {
	plan, err := ParseQuery(`TABLE text FROM CLAIMS`)
	if err != nil {
		t.Fatal(err)
	}
	sqlText, _, err := CompileSQL(plan)
	if err != nil {
		t.Fatalf("CompileSQL: %v", err)
	}
	if strings.Contains(sqlText, "provenance.kind = ?") {
		t.Errorf("bare FROM CLAIMS filtered on an empty kind:\n%s", sqlText)
	}
}

// TestCompileRecordsStillRequiresKind guards the asymmetry: making the kind
// optional for claims must not make it optional for records.
func TestCompileRecordsStillRequiresKind(t *testing.T) {
	plan := &QueryPlan{Type: "table", Source: SourceRecords, Fields: []FieldSpec{{Expr: "name"}}, Limit: 50}
	if _, _, err := CompileSQL(plan); err == nil {
		t.Fatal("FROM RECORDS with no kind should still be rejected")
	}
}

func TestCompileClaimsSQLInjectionInEvidence(t *testing.T) {
	plan, err := ParseQuery(`TABLE text FROM CLAIMS "x\" OR 1=1 --"`)
	if err != nil {
		// Rejecting it outright is also a correct outcome.
		return
	}
	sqlText, params, err := CompileSQL(plan)
	if err != nil {
		return
	}
	if strings.Contains(sqlText, "OR 1=1") {
		t.Fatalf("evidence class was interpolated into SQL:\n%s", sqlText)
	}
	if len(params) == 0 {
		t.Fatal("expected the evidence class to be bound as a parameter")
	}
}

// ---------- end to end ----------

func setupClaimsDB(t *testing.T) *sql.DB {
	t.Helper()
	db := setupTestDB(t)

	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS provenance (
		path TEXT NOT NULL,
		block_index INTEGER NOT NULL,
		kind TEXT NOT NULL,
		record_index INTEGER NOT NULL,
		json TEXT NOT NULL DEFAULT '{}',
		PRIMARY KEY (path, block_index, record_index)
	)`); err != nil {
		t.Fatal(err)
	}

	pages := []struct {
		path string
		fm   map[string]any
	}{
		{"projects/atlas/index.md", map[string]any{"kind": "project", "title": "Atlas", "status": "verified"}},
		{"techniques/stacking.md", map[string]any{"kind": "technique", "title": "Stacking", "status": "draft"}},
	}
	for _, p := range pages {
		fm, _ := json.Marshal(p.fm)
		if _, err := db.Exec(`INSERT INTO file_meta(path, frontmatter, tasks, updated_at) VALUES (?, ?, ?, ?)`,
			p.path, string(fm), "[]", "2026-04-24T12:00:00Z"); err != nil {
			t.Fatal(err)
		}
	}

	claims := []struct {
		path     string
		evidence string
		index    int
		payload  map[string]any
	}{
		// Unsupported and low confidence — the two the audit query wants.
		{"projects/atlas/index.md", "inferred", 0, map[string]any{
			"text":  "A non-linear level-2 stacker wins when the dominant feature is sparse",
			"scope": "block", "evidence": "inferred", "confidence": 0.6, "source": nil}},
		{"techniques/stacking.md", "inferred", 0, map[string]any{
			"text": "Hill-climbing underperforms here", "scope": "inline",
			"evidence": "inferred", "confidence": 0.45, "source": nil}},
		// Low confidence but sourced — must not match.
		{"projects/atlas/index.md", "inferred", 1, map[string]any{
			"text": "Row independence holds", "scope": "block",
			"evidence": "inferred", "confidence": 0.5, "source": "sources/reports/575784"}},
		// Unsourced but confident — must not match.
		{"projects/atlas/index.md", "inferred", 2, map[string]any{
			"text": "The metric is RMSE", "scope": "block",
			"evidence": "inferred", "confidence": 0.95, "source": nil}},
		// Unsourced, low confidence, but stated rather than inferred.
		{"techniques/stacking.md", "stated", 1, map[string]any{
			"text": "Stacking is popular", "scope": "block",
			"evidence": "stated", "confidence": 0.3, "source": nil}},
		// No confidence recorded at all — null must not satisfy `< 0.7`.
		{"techniques/stacking.md", "inferred", 2, map[string]any{
			"text": "Unquantified hunch", "scope": "block",
			"evidence": "inferred", "confidence": nil, "source": nil}},
	}
	for _, c := range claims {
		payload, _ := json.Marshal(c.payload)
		if _, err := db.Exec(
			`INSERT INTO provenance(path, block_index, kind, record_index, json) VALUES (?, 0, ?, ?, ?)`,
			c.path, c.evidence, c.index, string(payload)); err != nil {
			t.Fatal(err)
		}
	}
	return db
}

// TestIntegration_ClaimsMotivatingQuery is K7's success criterion: "all
// inferred claims with confidence below 0.7 that have no supporting source",
// across the workspace.
func TestIntegration_ClaimsMotivatingQuery(t *testing.T) {
	db := setupClaimsDB(t)
	defer db.Close()
	exec := NewExecutor(db)

	result, err := exec.Query(context.Background(), `
TABLE title, text, confidence
FROM CLAIMS "inferred"
WHERE confidence < 0.7 AND source IS NULL
SORT confidence ASC`, 0, 0)
	if err != nil {
		t.Fatal(err)
	}

	if len(result.Rows) != 2 {
		t.Fatalf("got %d rows, want 2: %+v", len(result.Rows), result.Rows)
	}
	if result.Rows[0]["confidence"] != 0.45 || result.Rows[1]["confidence"] != 0.6 {
		t.Errorf("confidences = %v, %v; want 0.45 then 0.6",
			result.Rows[0]["confidence"], result.Rows[1]["confidence"])
	}
	// `title` lives on the parent page, not the claim.
	if result.Rows[0]["title"] != "Stacking" {
		t.Errorf("title = %v, want Stacking (inherited from the page)", result.Rows[0]["title"])
	}
	if result.Rows[1]["title"] != "Atlas" {
		t.Errorf("title = %v, want Atlas", result.Rows[1]["title"])
	}
	if result.Rows[0]["_path"] != "techniques/stacking.md" {
		t.Errorf("_path = %v", result.Rows[0]["_path"])
	}
}

// TestIntegration_ClaimsNullConfidenceExcluded is Phase 0 finding #2 at the
// claims grain: an unquantified claim must not satisfy a range filter, and
// must not inherit a value from its page.
func TestIntegration_ClaimsNullConfidenceExcluded(t *testing.T) {
	db := setupClaimsDB(t)
	defer db.Close()
	exec := NewExecutor(db)

	result, err := exec.Query(context.Background(),
		`TABLE text FROM CLAIMS WHERE confidence < 0.7`, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range result.Rows {
		if row["text"] == "Unquantified hunch" {
			t.Fatalf("a null confidence matched a range filter: %+v", result.Rows)
		}
	}
	if len(result.Rows) != 4 {
		t.Errorf("got %d rows, want 4 (0.6, 0.45, 0.5, 0.3): %+v", len(result.Rows), result.Rows)
	}
}

func TestIntegration_ClaimsEvidenceIsolation(t *testing.T) {
	db := setupClaimsDB(t)
	defer db.Close()
	exec := NewExecutor(db)

	stated, err := exec.Query(context.Background(), `TABLE text FROM CLAIMS "stated"`, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(stated.Rows) != 1 || stated.Rows[0]["text"] != "Stacking is popular" {
		t.Fatalf("stated claims = %+v", stated.Rows)
	}

	all, err := exec.Query(context.Background(), `TABLE text FROM CLAIMS`, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(all.Rows) != 6 {
		t.Errorf("bare FROM CLAIMS returned %d rows, want all 6", len(all.Rows))
	}
}

func TestIntegration_ClaimsFolderFilter(t *testing.T) {
	db := setupClaimsDB(t)
	defer db.Close()
	exec := NewExecutor(db)

	result, err := exec.Query(context.Background(),
		`TABLE text FROM CLAIMS IN "projects/"`, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Rows) != 3 {
		t.Fatalf("got %d rows, want 3 under projects/: %+v", len(result.Rows), result.Rows)
	}
}

// TestIntegration_ClaimsImplicitFields: the record-grain implicit fields must
// resolve against provenance, not page_records, or the query errors on a
// missing table.
func TestIntegration_ClaimsImplicitFields(t *testing.T) {
	db := setupClaimsDB(t)
	defer db.Close()
	exec := NewExecutor(db)

	result, err := exec.Query(context.Background(),
		`TABLE _path, _kind, _record, text FROM CLAIMS "stated"`, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Rows) != 1 {
		t.Fatalf("got %d rows, want 1", len(result.Rows))
	}
	row := result.Rows[0]
	if row["_kind"] != "stated" {
		t.Errorf("_kind = %v, want stated", row["_kind"])
	}
	if row["_record"] != int64(1) && row["_record"] != float64(1) {
		t.Errorf("_record = %v (%T), want 1", row["_record"], row["_record"])
	}
}

// TestIntegration_RecordsUnaffectedByClaims makes sure generalising the
// compiler did not repoint kiwi-data queries at the wrong table.
func TestIntegration_RecordsUnaffectedByClaims(t *testing.T) {
	db := setupRecordsDB(t)
	defer db.Close()
	exec := NewExecutor(db)

	result, err := exec.Query(context.Background(),
		`TABLE name, dtype FROM RECORDS "dataset-schema"`, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Rows) != 5 {
		t.Fatalf("got %d rows, want 5 dataset-schema records: %+v", len(result.Rows), result.Rows)
	}
}
