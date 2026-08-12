package dataview

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"testing"
)

// ---------- parser ----------

func TestParseFromRecords(t *testing.T) {
	plan, err := ParseQuery(`TABLE name, dtype FROM RECORDS "dataset-schema" WHERE dtype = "float"`)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Source != SourceRecords {
		t.Errorf("source = %q, want %q", plan.Source, SourceRecords)
	}
	if plan.RecordKind != "dataset-schema" {
		t.Errorf("record kind = %q, want dataset-schema", plan.RecordKind)
	}
	if plan.From != "" {
		t.Errorf("from = %q, want empty", plan.From)
	}
	if len(plan.Fields) != 2 {
		t.Errorf("fields = %d, want 2", len(plan.Fields))
	}
	if plan.Where == nil {
		t.Error("where = nil, want the parsed dtype filter")
	}
}

func TestParseFromRecordsVariants(t *testing.T) {
	tests := []struct {
		name       string
		dql        string
		wantKind   string
		wantFolder string
	}{
		{"single quotes", `LIST FROM RECORDS 'dataset-schema'`, "dataset-schema", ""},
		{"bare word", `LIST FROM RECORDS dataset-schema`, "dataset-schema", ""},
		{"lowercase keyword", `LIST FROM records "dataset-schema"`, "dataset-schema", ""},
		{"folder scope", `LIST FROM RECORDS "dataset-schema" IN "datasets/"`, "dataset-schema", "datasets/"},
		{"folder scope then clause", `COUNT FROM RECORDS "ledger" IN "datasets/" WHERE delta > 0`, "ledger", "datasets/"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			plan, err := ParseQuery(tc.dql)
			if err != nil {
				t.Fatal(err)
			}
			if plan.Source != SourceRecords || plan.RecordKind != tc.wantKind {
				t.Errorf("source/kind = %q/%q, want %q/%q", plan.Source, plan.RecordKind, SourceRecords, tc.wantKind)
			}
			if plan.From != tc.wantFolder {
				t.Errorf("from = %q, want %q", plan.From, tc.wantFolder)
			}
		})
	}
}

func TestParseFromRecordsErrors(t *testing.T) {
	tests := []struct {
		name string
		dql  string
	}{
		{"no kind", `TABLE name FROM RECORDS`},
		{"kind is a clause keyword", `TABLE name FROM RECORDS WHERE dtype = "float"`},
		{"unterminated quote", `TABLE name FROM RECORDS "dataset-schema`},
		{"IN without folder", `TABLE name FROM RECORDS "dataset-schema" IN`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := ParseQuery(tc.dql); err == nil {
				t.Fatalf("ParseQuery(%q) succeeded, want an error", tc.dql)
			}
		})
	}
}

func TestParseFromFolderStillWorks(t *testing.T) {
	// "RECORDS" is only special right after FROM; a folder literally named
	// records/ must still parse as a folder.
	plan, err := ParseQuery(`TABLE name FROM "records/"`)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Source == SourceRecords {
		t.Error("quoted folder was misread as a record source")
	}
	if plan.From != "records/" {
		t.Errorf("from = %q, want records/", plan.From)
	}
}

// ---------- compiler ----------

func TestCompileRecordsSQL(t *testing.T) {
	plan := &QueryPlan{
		Type:       "table",
		Source:     SourceRecords,
		RecordKind: "dataset-schema",
		Fields:     []FieldSpec{{Expr: "name"}, {Expr: "dtype"}},
		Limit:      50,
	}
	sqlStr, args, err := CompileSQL(plan)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sqlStr, "FROM page_records LEFT JOIN file_meta ON file_meta.path = page_records.path") {
		t.Errorf("sql = %q, missing the page_records join", sqlStr)
	}
	if !strings.Contains(sqlStr, "page_records.kind = ?") {
		t.Errorf("sql = %q, kind must be a bound parameter", sqlStr)
	}
	if !strings.Contains(sqlStr, "SELECT page_records.path") {
		t.Errorf("sql = %q, want page_records.path as the id column", sqlStr)
	}
	if !strings.Contains(sqlStr, "COALESCE(file_meta.frontmatter, '{}')") {
		t.Errorf("sql = %q, want a non-null frontmatter column", sqlStr)
	}
	if len(args) == 0 || args[0] != "dataset-schema" {
		t.Errorf("args = %v, want the kind bound first", args)
	}
}

func TestCompileRecordsFieldNamespacing(t *testing.T) {
	plan := &QueryPlan{
		Type:       "table",
		Source:     SourceRecords,
		RecordKind: "dataset-schema",
		Fields: []FieldSpec{
			{Expr: "name"},
			{Expr: "record.name"},
			{Expr: "page.dataset"},
			{Expr: "_kind"},
		},
		Limit: 50,
	}
	sqlStr, _, err := CompileSQL(plan)
	if err != nil {
		t.Fatal(err)
	}
	// Bare field: record wins, page frontmatter is the fallback, and the
	// fallback is keyed on json_type so an explicit null stays null.
	if !strings.Contains(sqlStr, "CASE WHEN json_type(page_records.json, '$.name') IS NOT NULL THEN json_extract(page_records.json, '$.name') ELSE json_extract(file_meta.frontmatter, '$.name') END") {
		t.Errorf("sql = %q, missing the bare-field fallback form", sqlStr)
	}
	if !strings.Contains(sqlStr, "json_extract(page_records.json, '$.name') AS record_name") {
		t.Errorf("sql = %q, record. prefix must read the record only", sqlStr)
	}
	if !strings.Contains(sqlStr, "json_extract(file_meta.frontmatter, '$.dataset') AS page_dataset") {
		t.Errorf("sql = %q, page. prefix must read frontmatter only", sqlStr)
	}
	if !strings.Contains(sqlStr, "page_records.kind AS _kind") {
		t.Errorf("sql = %q, _kind must resolve to the column", sqlStr)
	}
}

func TestCompileRecordsImplicitPathFields(t *testing.T) {
	plan := &QueryPlan{
		Type:       "table",
		Source:     SourceRecords,
		RecordKind: "ledger",
		Fields:     []FieldSpec{{Expr: "_path"}, {Expr: "_folder"}},
		Limit:      50,
	}
	sqlStr, _, err := CompileSQL(plan)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(sqlStr, "file_meta.path") && !strings.Contains(sqlStr, "ON file_meta.path = page_records.path") {
		t.Errorf("sql = %q, implicit fields should read page_records.path", sqlStr)
	}
	if !strings.Contains(sqlStr, "page_records.path AS _path") {
		t.Errorf("sql = %q, want _path from the driving table", sqlStr)
	}
}

func TestCompileRecordsRejectsTaskQueries(t *testing.T) {
	plan := &QueryPlan{Type: "task", Source: SourceRecords, RecordKind: "ledger", Limit: 50}
	if _, _, err := CompileSQL(plan); err == nil {
		t.Fatal("TASK over records should be rejected")
	}
}

func TestCompileRecordsRequiresKind(t *testing.T) {
	plan := &QueryPlan{Type: "table", Source: SourceRecords, Fields: []FieldSpec{{Expr: "name"}}, Limit: 50}
	if _, _, err := CompileSQL(plan); err == nil {
		t.Fatal("records source without a kind should be rejected")
	}
}

// ---------- end to end ----------

func setupRecordsDB(t *testing.T) *sql.DB {
	t.Helper()
	db := setupTestDB(t)

	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS page_records (
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
		{"datasets/sales/data.md", map[string]any{"kind": "dataset-data", "dataset": "sales", "status": "verified"}},
		{"datasets/revenue/data.md", map[string]any{"kind": "dataset-data", "dataset": "revenue", "status": "draft"}},
	}
	for _, p := range pages {
		fm, _ := json.Marshal(p.fm)
		if _, err := db.Exec(`INSERT INTO file_meta(path, frontmatter, tasks, updated_at) VALUES (?, ?, ?, ?)`,
			p.path, string(fm), "[]", "2026-04-24T12:00:00Z"); err != nil {
			t.Fatal(err)
		}
	}

	records := []struct {
		path    string
		block   int
		kind    string
		index   int
		payload map[string]any
	}{
		{"datasets/sales/data.md", 0, "dataset-schema", 0, map[string]any{"name": "target", "dtype": "float", "missing-rate": 0.116}},
		{"datasets/sales/data.md", 0, "dataset-schema", 1, map[string]any{"name": "id", "dtype": "int", "missing-rate": 0}},
		{"datasets/sales/data.md", 0, "dataset-schema", 2, map[string]any{"name": "notes", "dtype": "str", "missing-rate": nil}},
		{"datasets/sales/data.md", 1, "did-not-work", 0, map[string]any{"step": "dedupe", "delta": -0.055}},
		{"datasets/revenue/data.md", 0, "dataset-schema", 0, map[string]any{"name": "feature_a", "dtype": "float", "missing-rate": 0.42}},
		// A record that shadows nothing but relies on the parent page for
		// `dataset`, and one that overrides the page's `status`.
		{"datasets/revenue/data.md", 0, "dataset-schema", 1, map[string]any{"name": "feature_b", "dtype": "float", "missing-rate": 0.05, "status": "checked"}},
	}
	for _, r := range records {
		payload, _ := json.Marshal(r.payload)
		if _, err := db.Exec(
			`INSERT INTO page_records(path, block_index, kind, record_index, json) VALUES (?, ?, ?, ?, ?)`,
			r.path, r.block, r.kind, r.index, string(payload)); err != nil {
			t.Fatal(err)
		}
	}
	return db
}

// TestIntegration_RecordsMotivatingQuery is feature.md §4.2's motivating
// query — the success criterion for K3.
func TestIntegration_RecordsMotivatingQuery(t *testing.T) {
	db := setupRecordsDB(t)
	defer db.Close()
	exec := NewExecutor(db)

	result, err := exec.Query(context.Background(), `
TABLE dataset, name, dtype, missing-rate
FROM RECORDS "dataset-schema"
WHERE missing-rate > 0.1
SORT missing-rate DESC`, 0, 0)
	if err != nil {
		t.Fatal(err)
	}

	if len(result.Rows) != 2 {
		t.Fatalf("got %d rows, want 2: %+v", len(result.Rows), result.Rows)
	}
	// Sorted by missing-rate DESC: revenue/feature_a (0.42) then sales/target (0.116).
	if result.Rows[0]["name"] != "feature_a" || result.Rows[1]["name"] != "target" {
		t.Errorf("order = %v, %v; want feature_a, target", result.Rows[0]["name"], result.Rows[1]["name"])
	}
	// `dataset` lives on the parent page, not the record.
	if result.Rows[0]["dataset"] != "revenue" {
		t.Errorf("dataset = %v, want revenue (inherited from the page)", result.Rows[0]["dataset"])
	}
	if result.Rows[1]["dataset"] != "sales" {
		t.Errorf("dataset = %v, want sales", result.Rows[1]["dataset"])
	}
	if result.Rows[0]["_path"] != "datasets/revenue/data.md" {
		t.Errorf("_path = %v, want the page that owns the record", result.Rows[0]["_path"])
	}
	if result.Rows[1]["missing-rate"] != 0.116 {
		t.Errorf("missing-rate = %v (%T), want 0.116", result.Rows[1]["missing-rate"], result.Rows[1]["missing-rate"])
	}
}

func TestIntegration_RecordsNullExcludedFromRangeFilter(t *testing.T) {
	db := setupRecordsDB(t)
	defer db.Close()
	exec := NewExecutor(db)

	// A null missing-rate must not satisfy either side of a range filter,
	// and must not inherit a value from the parent page.
	result, err := exec.Query(context.Background(),
		`TABLE name FROM RECORDS "dataset-schema" WHERE missing-rate >= 0`, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range result.Rows {
		if row["name"] == "notes" {
			t.Fatalf("the null-valued record matched a range filter: %+v", result.Rows)
		}
	}
	if len(result.Rows) != 4 {
		t.Errorf("got %d rows, want 4 non-null records", len(result.Rows))
	}
}

func TestIntegration_RecordsKindIsolation(t *testing.T) {
	db := setupRecordsDB(t)
	defer db.Close()
	exec := NewExecutor(db)

	result, err := exec.Query(context.Background(), `TABLE step, delta FROM RECORDS "did-not-work"`, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Rows) != 1 {
		t.Fatalf("got %d rows, want 1", len(result.Rows))
	}
	if result.Rows[0]["step"] != "dedupe" {
		t.Errorf("step = %v", result.Rows[0]["step"])
	}
}

func TestIntegration_RecordsFieldPrecedence(t *testing.T) {
	db := setupRecordsDB(t)
	defer db.Close()
	exec := NewExecutor(db)

	result, err := exec.Query(context.Background(),
		`TABLE status, record.status, page.status FROM RECORDS "dataset-schema" WHERE name = "feature_b"`, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Rows) != 1 {
		t.Fatalf("got %d rows, want 1", len(result.Rows))
	}
	row := result.Rows[0]
	if row["status"] != "checked" {
		t.Errorf("bare status = %v, want the record's own value", row["status"])
	}
	if row["record.status"] != "checked" {
		t.Errorf("record.status = %v, want checked", row["record.status"])
	}
	if row["page.status"] != "draft" {
		t.Errorf("page.status = %v, want the page's draft", row["page.status"])
	}
}

func TestIntegration_RecordsFolderScopeAndCount(t *testing.T) {
	db := setupRecordsDB(t)
	defer db.Close()
	exec := NewExecutor(db)

	result, err := exec.Query(context.Background(),
		`COUNT FROM RECORDS "dataset-schema" IN "datasets/sales/"`, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if result.Total != 3 {
		t.Errorf("count = %d, want 3", result.Total)
	}
}

func TestIntegration_RecordsGroupBy(t *testing.T) {
	db := setupRecordsDB(t)
	defer db.Close()
	exec := NewExecutor(db)

	result, err := exec.Query(context.Background(),
		`TABLE name FROM RECORDS "dataset-schema" GROUP BY dtype`, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	counts := map[string]int{}
	for _, g := range result.Groups {
		counts[g.Key] = g.Count
	}
	if counts["float"] != 3 || counts["int"] != 1 || counts["str"] != 1 {
		t.Errorf("group counts = %v, want float:3 int:1 str:1", counts)
	}
}

func TestIntegration_RecordsDefaultOrderIsDocumentOrder(t *testing.T) {
	db := setupRecordsDB(t)
	defer db.Close()
	exec := NewExecutor(db)

	result, err := exec.Query(context.Background(), `TABLE name FROM RECORDS "dataset-schema"`, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, row := range result.Rows {
		got = append(got, row["name"].(string))
	}
	// Pages come in path order, then records in the order they were written.
	want := []string{"feature_a", "feature_b", "target", "id", "notes"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("order = %v, want %v", got, want)
	}
}

func TestIntegration_RecordsKindIsParameterized(t *testing.T) {
	db := setupRecordsDB(t)
	defer db.Close()
	exec := NewExecutor(db)

	// A kind carrying quotes must be bound, not interpolated. The query
	// should simply match nothing rather than corrupt the SQL.
	result, err := exec.Query(context.Background(),
		`TABLE name FROM RECORDS "x' OR '1'='1"`, 0, 0)
	if err != nil {
		t.Fatalf("injection attempt should be a clean miss, got: %v", err)
	}
	if len(result.Rows) != 0 {
		t.Fatalf("got %d rows, want 0", len(result.Rows))
	}

	// Same for the DROP TABLE classic.
	if _, err := exec.Query(context.Background(),
		`TABLE name FROM RECORDS "a'; DROP TABLE page_records; --"`, 0, 0); err != nil {
		t.Fatalf("query: %v", err)
	}
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM page_records`).Scan(&n); err != nil {
		t.Fatalf("page_records is gone: %v", err)
	}
	if n != 6 {
		t.Errorf("page_records has %d rows, want 6", n)
	}
}
