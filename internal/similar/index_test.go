package similar

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

var ctxBG = context.Background()

func setupIndexDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	if _, err := db.Exec(`CREATE TABLE file_meta (
		path TEXT PRIMARY KEY,
		frontmatter TEXT NOT NULL DEFAULT '{}',
		tasks TEXT NOT NULL DEFAULT '[]',
		updated_at TEXT NOT NULL
	)`); err != nil {
		t.Fatal(err)
	}

	pages := []struct {
		path string
		fm   map[string]any
	}{
		// Two csv datasets with near-identical shape.
		{"datasets/sales/index.md", map[string]any{
			"kind": "dataset", "format": "csv", "license": "mit",
			"stats": map[string]any{"ordered": true, "rows": 750000, "columns": 12},
		}},
		{"datasets/revenue/index.md", map[string]any{
			"kind": "dataset", "format": "csv", "license": "mit",
			"stats": map[string]any{"ordered": true, "rows": 700000, "columns": 14},
		}},
		// Same license, different format.
		{"datasets/inventory/index.md", map[string]any{
			"kind": "dataset", "format": "json", "license": "mit",
			"stats": map[string]any{"ordered": true, "rows": 200000, "columns": 40},
		}},
		// A dataset that differs on every field and is much smaller.
		{"datasets/traffic/index.md", map[string]any{
			"kind": "dataset", "format": "parquet", "license": "apache-2.0",
			"stats": map[string]any{"ordered": false, "rows": 3000, "columns": 6},
		}},
		// Non-dataset pages must never be candidates.
		{"techniques/indexing.md", map[string]any{
			"kind": "technique", "format": "csv", "license": "mit",
			"stats": map[string]any{"ordered": true, "rows": 999999, "columns": 1},
		}},
		// A dataset with unfilled stats: it should still rank, but with a
		// visibly small comparable-field count.
		{"datasets/sparse/index.md", map[string]any{
			"kind": "dataset", "format": "csv",
		}},
	}
	for _, p := range pages {
		fm, _ := json.Marshal(p.fm)
		if _, err := db.Exec(`INSERT INTO file_meta(path, frontmatter, tasks, updated_at) VALUES (?, ?, '[]', ?)`,
			p.path, string(fm), "2026-04-24T12:00:00Z"); err != nil {
			t.Fatal(err)
		}
	}
	return db
}

func datasetProfile() Profile {
	return Profile{
		Name:  "dataset",
		Match: map[string]string{"kind": "dataset"},
		Fields: []Field{
			{Name: "format", Kind: Categorical},
			{Name: "license", Kind: Categorical},
			{Name: "stats.ordered", Kind: Categorical},
			{Name: "stats.rows", Kind: Numeric},
			{Name: "stats.columns", Kind: Numeric},
		},
	}
}

func newTestIndex(t *testing.T, profiles ...Profile) *Index {
	t.Helper()
	if len(profiles) == 0 {
		profiles = []Profile{datasetProfile()}
	}
	idx, err := New(setupIndexDB(t), profiles)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return idx
}

func paths(ns []Neighbor) []string {
	out := make([]string, len(ns))
	for i, n := range ns {
		out[i] = n.Path
	}
	return out
}

func TestSimilarByPath(t *testing.T) {
	idx := newTestIndex(t)

	res, err := idx.Similar(ctxBG, Query{Path: "datasets/sales/index.md", Profile: "dataset", K: 3})
	if err != nil {
		t.Fatal(err)
	}
	if res.Neighbors[0].Path != "datasets/revenue/index.md" {
		t.Errorf("nearest = %q, want the other csv dataset; got order %v",
			res.Neighbors[0].Path, paths(res.Neighbors))
	}
	// The query page must not rank against itself.
	for _, n := range res.Neighbors {
		if n.Path == "datasets/sales/index.md" {
			t.Error("the query page appeared in its own neighbour list")
		}
	}
	// The technique page is not a dataset and must not be a candidate.
	for _, n := range res.Neighbors {
		if strings.HasPrefix(n.Path, "techniques/") {
			t.Errorf("profile match ignored: %q ranked", n.Path)
		}
	}
	if res.CandidateCount != 5 {
		t.Errorf("candidate count = %d, want 5 datasets", res.CandidateCount)
	}
	if len(res.Neighbors) != 3 {
		t.Errorf("got %d neighbours, want k=3", len(res.Neighbors))
	}
	if res.Neighbors[0].Score != 1-res.Neighbors[0].RankDistance {
		t.Error("score and rank distance disagree")
	}
	// Every field is filled on both sides here, so the coverage adjustment
	// is a no-op and the headline number is plain Gower.
	if res.Neighbors[0].Coverage != 1 || res.Neighbors[0].Distance != res.Neighbors[0].RankDistance {
		t.Errorf("fully-covered pair was adjusted: %+v", res.Neighbors[0])
	}
}

func TestSimilarSparseCandidateDoesNotWin(t *testing.T) {
	// A page with a single filled field that happens to match scores 0 on
	// textbook Gower — perfect similarity on no evidence. It must not
	// outrank a page that matches on everything.
	idx := newTestIndex(t)
	res, err := idx.Similar(ctxBG, Query{Path: "datasets/sales/index.md", Profile: "dataset", K: 10})
	if err != nil {
		t.Fatal(err)
	}
	if res.Neighbors[0].Path == "datasets/sparse/index.md" {
		t.Fatalf("the near-empty page ranked first: %v", paths(res.Neighbors))
	}
	for _, n := range res.Neighbors {
		if n.Path != "datasets/sparse/index.md" {
			continue
		}
		if n.Distance != 0 {
			t.Errorf("raw Gower distance = %v, want 0 (it matches on its one filled field)", n.Distance)
		}
		if n.Coverage != 0.2 {
			t.Errorf("coverage = %v, want 0.2", n.Coverage)
		}
		if n.RankDistance != 0.8 {
			t.Errorf("rank distance = %v, want 0.8", n.RankDistance)
		}
	}
}

func TestSimilarRanksMostDistantLast(t *testing.T) {
	idx := newTestIndex(t)
	res, err := idx.Similar(ctxBG, Query{Path: "datasets/sales/index.md", Profile: "dataset", K: 10})
	if err != nil {
		t.Fatal(err)
	}
	got := paths(res.Neighbors)
	if got[len(got)-1] == "datasets/revenue/index.md" {
		t.Errorf("order = %v, the closest match ended up last", got)
	}
	for i := 1; i < len(res.Neighbors); i++ {
		if res.Neighbors[i-1].RankDistance > res.Neighbors[i].RankDistance {
			t.Fatalf("rank distances are not ascending: %v", paths(res.Neighbors))
		}
		if res.Neighbors[i-1].Score < res.Neighbors[i].Score {
			t.Fatalf("scores are not descending: %v", paths(res.Neighbors))
		}
	}
}

func TestSimilarInlineVector(t *testing.T) {
	// A dataset that is not in the corpus at all — the case an agent is
	// looking at right now.
	idx := newTestIndex(t)
	res, err := idx.Similar(ctxBG, Query{
		Profile: "dataset",
		Vector: map[string]any{
			"format":        "parquet",
			"license":       "apache-2.0",
			"stats.ordered": false,
			"stats.rows":    3500,
			"stats.columns": 7,
		},
		K: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.QueryPath != "" {
		t.Errorf("query path = %q, want empty for an inline query", res.QueryPath)
	}
	if res.Neighbors[0].Path != "datasets/traffic/index.md" {
		t.Errorf("nearest = %q, want the parquet dataset; order %v",
			res.Neighbors[0].Path, paths(res.Neighbors))
	}
}

func TestSimilarInlineVectorOverlaysPage(t *testing.T) {
	idx := newTestIndex(t)
	// Same page, but ask "what if it were an unordered parquet file?".
	res, err := idx.Similar(ctxBG, Query{
		Path:    "datasets/sales/index.md",
		Profile: "dataset",
		Vector: map[string]any{
			"format":        "parquet",
			"license":       "apache-2.0",
			"stats.ordered": false,
		},
		K: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.QueryVector["format"] != "parquet" {
		t.Errorf("query vector format = %v, want the override", res.QueryVector["format"])
	}
	if res.QueryVector["stats.rows"] != float64(750000) {
		t.Errorf("query vector rows = %v, want the page's own value to survive", res.QueryVector["stats.rows"])
	}
	if res.Neighbors[0].Path != "datasets/traffic/index.md" {
		t.Errorf("nearest = %q, want the hypothetical to move the answer", res.Neighbors[0].Path)
	}
}

func TestSimilarReportsComparableFieldCount(t *testing.T) {
	idx := newTestIndex(t)
	res, err := idx.Similar(ctxBG, Query{Path: "datasets/sales/index.md", Profile: "dataset", K: 10})
	if err != nil {
		t.Fatal(err)
	}
	var sparse *Neighbor
	for i := range res.Neighbors {
		if res.Neighbors[i].Path == "datasets/sparse/index.md" {
			sparse = &res.Neighbors[i]
		}
	}
	if sparse == nil {
		t.Fatal("the sparsely filled dataset was dropped instead of ranked")
	}
	if sparse.ComparableFields != 1 {
		t.Errorf("comparable fields = %d, want 1 (only `format` is filled)", sparse.ComparableFields)
	}
	if sparse.TotalFields != 5 {
		t.Errorf("total fields = %d, want 5", sparse.TotalFields)
	}
	var skipped int
	for _, c := range sparse.Contributions {
		if c.Skipped {
			skipped++
		}
	}
	if skipped != 4 {
		t.Errorf("skipped contributions = %d, want 4", skipped)
	}
}

func TestSimilarContributionsExplainTheScore(t *testing.T) {
	idx := newTestIndex(t)
	res, err := idx.Similar(ctxBG, Query{Path: "datasets/sales/index.md", Profile: "dataset", K: 1})
	if err != nil {
		t.Fatal(err)
	}
	n := res.Neighbors[0]
	if len(n.Contributions) != 5 {
		t.Fatalf("got %d contributions, want one per profile field", len(n.Contributions))
	}
	byField := map[string]Contribution{}
	for _, c := range n.Contributions {
		byField[c.Field] = c
	}
	if c := byField["format"]; c.Distance != 0 || c.Kind != "categorical" {
		t.Errorf("format contribution = %+v, want a categorical match", c)
	}
	if c := byField["stats.rows"]; c.Distance <= 0 || c.Kind != "numeric" {
		t.Errorf("rows contribution = %+v, want a non-zero numeric distance", c)
	}
}

func TestSimilarWeightsReorderResults(t *testing.T) {
	// Weighting a field at 3.0 has to demonstrably reorder the list versus
	// weight 1.0.
	base := datasetProfile()
	weighted := datasetProfile()
	weighted.Name = "dataset-weighted"
	for i := range weighted.Fields {
		if weighted.Fields[i].Name == "stats.ordered" {
			weighted.Fields[i].Weight = 3
		}
	}
	idx, err := New(setupIndexDB(t), []Profile{base, weighted})
	if err != nil {
		t.Fatal(err)
	}

	q := map[string]any{
		"format":        "csv",
		"license":       "mit",
		"stats.ordered": false,
		"stats.rows":    500000,
		"stats.columns": 13,
	}
	plain, err := idx.Similar(ctxBG, Query{Profile: "dataset", Vector: q, K: 5})
	if err != nil {
		t.Fatal(err)
	}
	heavy, err := idx.Similar(ctxBG, Query{Profile: "dataset-weighted", Vector: q, K: 5})
	if err != nil {
		t.Fatal(err)
	}

	rank := func(res *Result, path string) int {
		for i, n := range res.Neighbors {
			if n.Path == path {
				return i
			}
		}
		return -1
	}
	const unordered = "datasets/traffic/index.md"
	if rank(plain, unordered) <= rank(heavy, unordered) {
		t.Errorf("weighting stats.ordered did not promote the only unordered dataset: plain=%v weighted=%v",
			paths(plain.Neighbors), paths(heavy.Neighbors))
	}
}

func TestSimilarProfileErrors(t *testing.T) {
	idx := newTestIndex(t)

	if _, err := idx.Similar(ctxBG, Query{Path: "datasets/sales/index.md", Profile: "nope"}); err == nil {
		t.Error("unknown profile should error")
	} else if !strings.Contains(err.Error(), "dataset") {
		t.Errorf("error should list the configured profiles: %v", err)
	}

	if _, err := idx.Similar(ctxBG, Query{Profile: "dataset"}); err == nil {
		t.Error("a query with neither path nor vector should error")
	}

	if _, err := idx.Similar(ctxBG, Query{Path: "datasets/ghost/index.md", Profile: "dataset"}); err == nil {
		t.Error("an unindexed path should error")
	}
}

func TestSimilarSingleProfileIsImplicit(t *testing.T) {
	idx := newTestIndex(t)
	if _, err := idx.Similar(ctxBG, Query{Path: "datasets/sales/index.md"}); err != nil {
		t.Errorf("with one profile configured, naming it should be optional: %v", err)
	}
}

func TestSimilarPathPrefixScope(t *testing.T) {
	p := datasetProfile()
	p.Match = nil
	p.PathPrefix = "datasets/s"
	idx, err := New(setupIndexDB(t), []Profile{p})
	if err != nil {
		t.Fatal(err)
	}
	res, err := idx.Similar(ctxBG, Query{Path: "datasets/sales/index.md", K: 10})
	if err != nil {
		t.Fatal(err)
	}
	if res.CandidateCount != 2 {
		t.Errorf("candidate count = %d, want the 2 datasets/s* pages", res.CandidateCount)
	}
}

func TestNewProfileValidation(t *testing.T) {
	db := setupIndexDB(t)
	tests := []struct {
		name     string
		profiles []Profile
	}{
		{"no name", []Profile{{Fields: []Field{{Name: "a"}}}}},
		{"no fields", []Profile{{Name: "p"}}},
		{"blank field name", []Profile{{Name: "p", Fields: []Field{{Name: " "}}}}},
		{"duplicate names", []Profile{
			{Name: "p", Fields: []Field{{Name: "a"}}},
			{Name: "p", Fields: []Field{{Name: "b"}}},
		}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := New(db, tc.profiles); err == nil {
				t.Fatal("want an error")
			}
		})
	}
}

func TestMatchFieldIsValidated(t *testing.T) {
	// A match key is config-supplied text that lands in a json_extract path.
	idx, err := New(setupIndexDB(t), []Profile{{
		Name:   "bad",
		Match:  map[string]string{"kind') = 'dataset' OR json_extract(frontmatter, '$.x": "y"},
		Fields: []Field{{Name: "format", Kind: Categorical}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := idx.Similar(ctxBG, Query{Profile: "bad", Vector: map[string]any{"format": "csv"}}); err == nil {
		t.Fatal("an injection-shaped match field should be rejected, not interpolated")
	}
}

func TestExtractVectorNestedAndLiteralKeys(t *testing.T) {
	fields := []Field{
		{Name: "stats.rows", Kind: Numeric},
		{Name: "missing.path", Kind: Numeric},
		{Name: "flat.key", Kind: Categorical},
	}
	fm := map[string]any{
		"stats":    map[string]any{"rows": 100},
		"flat.key": "literal", // a literal dotted key beats the path walk
	}
	got := ExtractVector(fm, fields)
	if got["stats.rows"] != 100 {
		t.Errorf("nested lookup = %v, want 100", got["stats.rows"])
	}
	if _, ok := got["missing.path"]; ok {
		t.Error("a missing path should be absent, not nil-filled")
	}
	if got["flat.key"] != "literal" {
		t.Errorf("literal dotted key = %v, want literal", got["flat.key"])
	}
}
