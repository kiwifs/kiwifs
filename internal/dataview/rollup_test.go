package dataview

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// ---------- SQL emission ----------

func compileRollupQuery(t *testing.T, dql string) (string, []any) {
	t.Helper()
	plan, err := ParseQuery(dql)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	sqlStr, args, err := CompileSQL(plan)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	return sqlStr, args
}

func TestCompileRollupEmitsCorrelatedSubquery(t *testing.T) {
	sqlStr, args := compileRollupQuery(t, `TABLE rollup(related-notes, title) AS notes FROM "datasets"`)

	if !strings.Contains(sqlStr, "json_group_array(") {
		t.Errorf("sql = %q, want json_group_array", sqlStr)
	}
	if !strings.Contains(sqlStr, "FROM links AS _rl JOIN file_meta AS _rt") {
		t.Errorf("sql = %q, want a links → file_meta join", sqlStr)
	}
	if !strings.Contains(sqlStr, "_rl.source = file_meta.path") {
		t.Errorf("sql = %q, the subquery must correlate on the outer page", sqlStr)
	}
	if !strings.Contains(sqlStr, "_rl.relation = ?") {
		t.Errorf("sql = %q, the link field must be a bound parameter", sqlStr)
	}
	// The rolled-up expression reads the *target* page's frontmatter.
	if !strings.Contains(sqlStr, "json_extract(_rt.frontmatter, '$.title')") {
		t.Errorf("sql = %q, the expression must resolve against the linked page", sqlStr)
	}
	if strings.Contains(sqlStr, "json_group_array(json_extract(file_meta.frontmatter, '$.title')") {
		t.Errorf("sql = %q, the expression resolved against the outer page", sqlStr)
	}
	found := false
	for _, a := range args {
		if a == "related-notes" {
			found = true
		}
	}
	if !found {
		t.Errorf("args = %v, want the link field bound", args)
	}
}

func TestCompileRollupAllOutlinks(t *testing.T) {
	for _, name := range []string{"links", "outlinks"} {
		sqlStr, args := compileRollupQuery(t, `TABLE rollup(`+name+`, title) AS t FROM "notes"`)
		if !strings.Contains(sqlStr, "1=1") {
			t.Errorf("%s: sql = %q, want an unfiltered relation", name, sqlStr)
		}
		for _, a := range args {
			if a == name {
				t.Errorf("%s: the reserved name should not be bound as a relation", name)
			}
		}
	}
}

func TestCompileRollupImplicitFieldsUseTheTarget(t *testing.T) {
	sqlStr, _ := compileRollupQuery(t, `TABLE rollup(cites, _path) AS sources FROM "notes"`)
	if !strings.Contains(sqlStr, "json_group_array(_rt.path)") {
		t.Errorf("sql = %q, want _path to resolve to the linked page", sqlStr)
	}
}

func TestCompileRollupErrors(t *testing.T) {
	tests := []struct {
		name string
		dql  string
	}{
		{"one argument", `TABLE rollup(cites) AS x FROM "notes"`},
		{"three arguments", `TABLE rollup(cites, title, extra) AS x FROM "notes"`},
		{"literal link field", `TABLE rollup("cites", title) AS x FROM "notes"`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			plan, err := ParseQuery(tc.dql)
			if err != nil {
				return // rejected at parse time is also fine
			}
			if _, _, err := CompileSQL(plan); err == nil {
				t.Fatalf("CompileSQL(%q) succeeded, want an error", tc.dql)
			}
		})
	}
}

// ---------- end to end ----------

func setupRollupDB(t *testing.T) *sql.DB {
	t.Helper()
	db := setupTestDB(t)

	if _, err := db.Exec(`CREATE TABLE links (
		source TEXT NOT NULL,
		target TEXT NOT NULL,
		target_lc TEXT NOT NULL,
		relation TEXT NOT NULL DEFAULT '',
		PRIMARY KEY (source, target_lc, relation)
	)`); err != nil {
		t.Fatal(err)
	}

	pages := []struct {
		path string
		fm   map[string]any
	}{
		{"datasets/sales.md", map[string]any{"title": "Sales", "kind": "dataset"}},
		{"datasets/revenue.md", map[string]any{"title": "Revenue", "kind": "dataset"}},
		{"datasets/lonely.md", map[string]any{"title": "Lonely", "kind": "dataset"}},
		{"notes/cleaning.md", map[string]any{"title": "Cleaning", "impact": 0.9}},
		{"notes/blending.md", map[string]any{"title": "Blending", "impact": 0.4}},
		{"notes/cycles-a.md", map[string]any{"title": "Cycle A"}},
		{"notes/cycles-b.md", map[string]any{"title": "Cycle B"}},
	}
	for _, p := range pages {
		fm, _ := json.Marshal(p.fm)
		if _, err := db.Exec(`INSERT INTO file_meta(path, frontmatter, tasks, updated_at) VALUES (?, ?, '[]', ?)`,
			p.path, string(fm), "2026-04-24T12:00:00Z"); err != nil {
			t.Fatal(err)
		}
	}

	links := []struct{ source, target, relation string }{
		// Written without the .md extension, as wiki links usually are.
		{"datasets/sales.md", "notes/cleaning", "related-notes"},
		{"datasets/sales.md", "notes/blending", "related-notes"},
		// A body wiki link, i.e. no relation.
		{"datasets/sales.md", "notes/cleaning", ""},
		{"datasets/revenue.md", "notes/cleaning", "related-notes"},
		// A link to a page that does not exist.
		{"datasets/revenue.md", "notes/ghost", "related-notes"},
		// A cycle: two pages that link to each other.
		{"notes/cycles-a.md", "notes/cycles-b", "related-notes"},
		{"notes/cycles-b.md", "notes/cycles-a", "related-notes"},
	}
	for _, l := range links {
		if _, err := db.Exec(
			`INSERT INTO links(source, target, target_lc, relation) VALUES (?, ?, ?, ?)`,
			l.source, l.target, strings.ToLower(l.target), l.relation); err != nil {
			t.Fatal(err)
		}
	}
	return db
}

func rollupValues(t *testing.T, row map[string]any, col string) []string {
	t.Helper()
	items, ok := row[col].([]any)
	if !ok {
		t.Fatalf("%s = %#v, want a decoded JSON array", col, row[col])
	}
	out := make([]string, len(items))
	for i, v := range items {
		out[i] = strings.TrimSpace(strings.Trim(strings.TrimSpace(toStringValue(v)), `"`))
	}
	return out
}

func toStringValue(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	b, _ := json.Marshal(v)
	return string(b)
}

// TestIntegration_RollupCollectsLinkedTitles is K5's success criterion.
func TestIntegration_RollupCollectsLinkedTitles(t *testing.T) {
	db := setupRollupDB(t)
	defer db.Close()
	exec := NewExecutor(db)

	result, err := exec.Query(context.Background(),
		`TABLE title, rollup(related-notes, title) AS notes FROM "datasets" SORT title ASC`, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Rows) != 3 {
		t.Fatalf("got %d rows, want one per dataset: %+v", len(result.Rows), result.Rows)
	}

	byTitle := map[string]map[string]any{}
	for _, row := range result.Rows {
		byTitle[row["title"].(string)] = row
	}

	got := rollupValues(t, byTitle["Sales"], "notes")
	if len(got) != 2 {
		t.Fatalf("Sales notes = %v, want 2 (the body link must not double-count)", got)
	}
	joined := strings.Join(got, ",")
	if !strings.Contains(joined, "Cleaning") || !strings.Contains(joined, "Blending") {
		t.Errorf("Sales notes = %v, want Cleaning and Blending", got)
	}
}

func TestIntegration_RollupEmptyIsArrayNotNull(t *testing.T) {
	db := setupRollupDB(t)
	defer db.Close()
	exec := NewExecutor(db)

	result, err := exec.Query(context.Background(),
		`TABLE rollup(related-notes, title) AS notes FROM "datasets/lonely.md"`, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Rows) != 1 {
		t.Fatalf("got %d rows, want 1", len(result.Rows))
	}
	got := rollupValues(t, result.Rows[0], "notes")
	if len(got) != 0 {
		t.Errorf("notes = %v, want an empty array", got)
	}
}

func TestIntegration_RollupSkipsDanglingTargets(t *testing.T) {
	db := setupRollupDB(t)
	defer db.Close()
	exec := NewExecutor(db)

	result, err := exec.Query(context.Background(),
		`TABLE rollup(related-notes, title) AS notes FROM "datasets/revenue.md"`, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	got := rollupValues(t, result.Rows[0], "notes")
	if len(got) != 1 || got[0] != "Cleaning" {
		t.Errorf("notes = %v, want just Cleaning — the link to a missing page has no title to collect", got)
	}
}

func TestIntegration_RollupCycleTerminates(t *testing.T) {
	db := setupRollupDB(t)
	defer db.Close()
	exec := NewExecutor(db)

	done := make(chan struct{})
	var result *QueryResult
	var err error
	go func() {
		defer close(done)
		result, err = exec.Query(context.Background(),
			`TABLE title, rollup(related-notes, title) AS related FROM "notes/cycles"`, 0, 0)
	}()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("a mutual link cycle made the query hang")
	}
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Rows) != 2 {
		t.Fatalf("got %d rows, want 2", len(result.Rows))
	}
	// One hop only: A collects B's title and stops.
	for _, row := range result.Rows {
		if got := rollupValues(t, row, "related"); len(got) != 1 {
			t.Errorf("%v related = %v, want exactly one hop", row["title"], got)
		}
	}
}

func TestIntegration_RollupAllOutlinks(t *testing.T) {
	db := setupRollupDB(t)
	defer db.Close()
	exec := NewExecutor(db)

	result, err := exec.Query(context.Background(),
		`TABLE rollup(links, title) AS linked FROM "datasets/sales.md"`, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	got := rollupValues(t, result.Rows[0], "linked")
	// Two typed links plus one body link, all three collected.
	if len(got) != 3 {
		t.Errorf("linked = %v, want all 3 outbound links", got)
	}
}

func TestIntegration_RollupNonTitleExpression(t *testing.T) {
	db := setupRollupDB(t)
	defer db.Close()
	exec := NewExecutor(db)

	result, err := exec.Query(context.Background(),
		`TABLE rollup(related-notes, _path) AS paths FROM "datasets/sales.md"`, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	got := rollupValues(t, result.Rows[0], "paths")
	joined := strings.Join(got, ",")
	if !strings.Contains(joined, "notes/cleaning.md") {
		t.Errorf("paths = %v, want resolved page paths", got)
	}
}
