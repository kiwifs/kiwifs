package eval

import (
	"context"
	"errors"
	"math"
	"reflect"
	"testing"
)

const eps = 1e-9

func closeTo(t *testing.T, name string, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > eps {
		t.Errorf("%s = %v, want %v", name, got, want)
	}
}

// The arithmetic below is worked out on paper so a change in the metric
// definitions shows up as a failing constant, not as a re-derived expectation.
//
//	gain(g)   = 2^g - 1
//	DCG@K     = sum_i gain(g_i) / log2(i+1)   (i is 1-based)
//	IDCG@K    = DCG of the judged set in ideal order, truncated at K
//	P@K       = |relevant retrieved| / K      (K, not len(results))
func TestScoreHandComputed(t *testing.T) {
	t.Run("hit at rank 1", func(t *testing.T) {
		got := Score([]string{"a.md", "x.md", "y.md"}, map[string]int{"a.md": 1}, 5)
		if got.Rank != 1 {
			t.Errorf("rank = %d, want 1", got.Rank)
		}
		closeTo(t, "p@5", got.PrecisionAtK, 1.0/5)
		// DCG = 1/log2(2) = 1; IDCG = 1.
		closeTo(t, "ndcg", got.NDCG, 1.0)
	})

	t.Run("graded, two hits out of order", func(t *testing.T) {
		// c.md (grade 1) at rank 2, b.md (grade 2) at rank 4.
		got := Score([]string{"x.md", "c.md", "y.md", "b.md", "z.md"},
			map[string]int{"b.md": 2, "c.md": 1}, 5)
		if got.Rank != 2 {
			t.Errorf("rank = %d, want 2", got.Rank)
		}
		closeTo(t, "p@5", got.PrecisionAtK, 2.0/5)
		// DCG  = 1/log2(3) + 3/log2(5) = 1.9229594277916369
		// IDCG = 3/log2(2) + 1/log2(3) = 3.6309297535714578
		closeTo(t, "ndcg", got.NDCG, 1.9229594277916369/3.6309297535714578)
		if !reflect.DeepEqual(got.Hits, []string{"c.md", "b.md"}) {
			t.Errorf("hits = %v", got.Hits)
		}
	})

	t.Run("miss", func(t *testing.T) {
		got := Score([]string{"x.md", "y.md"}, map[string]int{"d.md": 1}, 5)
		if got.Rank != 0 {
			t.Errorf("rank = %d, want 0", got.Rank)
		}
		closeTo(t, "p@5", got.PrecisionAtK, 0)
		closeTo(t, "ndcg", got.NDCG, 0)
	})
}

// P@K divides by K even when the engine returned fewer than K results.
// Retrieving too little is a failure the metric has to reflect.
func TestScorePrecisionDividesByK(t *testing.T) {
	got := Score([]string{"a.md"}, map[string]int{"a.md": 1}, 5)
	closeTo(t, "p@5", got.PrecisionAtK, 0.2)
}

func TestScoreTruncatesToTopK(t *testing.T) {
	got := Score([]string{"x.md", "y.md", "a.md"}, map[string]int{"a.md": 1}, 2)
	if got.Rank != 0 {
		t.Fatalf("rank = %d; a hit past K must not count", got.Rank)
	}
	if len(got.Retrieved) != 2 {
		t.Fatalf("retrieved = %v, want 2 entries", got.Retrieved)
	}
}

// IDCG is capped at K, so a query with more relevant documents than slots can
// still reach nDCG 1.0 by filling every slot with the best of them.
func TestScoreIDCGCappedAtK(t *testing.T) {
	relevant := map[string]int{"a.md": 1, "b.md": 1, "c.md": 1}
	got := Score([]string{"a.md", "b.md"}, relevant, 2)
	closeTo(t, "ndcg", got.NDCG, 1.0)
}

func TestRunAggregatesThreeQueries(t *testing.T) {
	queries := []Query{
		{ID: "q1", Question: "one", Relevant: map[string]int{"a.md": 1}},
		{ID: "q2", Question: "two", Relevant: map[string]int{"b.md": 2, "c.md": 1}},
		{ID: "q3", Question: "three", Relevant: map[string]int{"d.md": 1}},
	}
	ranked := map[string][]string{
		"one":   {"a.md", "x.md", "y.md"},
		"two":   {"x.md", "c.md", "y.md", "b.md", "z.md"},
		"three": {"x.md", "y.md"},
	}
	engine := FuncEngine{EngineName: "test", Fn: func(_ context.Context, q string, topK int, _ []string) ([]string, error) {
		return ranked[q], nil
	}}

	rep, err := Run(context.Background(), queries, []Engine{engine}, Options{TopK: 5})
	if err != nil {
		t.Fatal(err)
	}
	m := rep.Metrics("test")
	if m.Queries != 3 {
		t.Fatalf("queries = %d, want 3", m.Queries)
	}
	closeTo(t, "hit_rate", m.HitRate, 2.0/3)         // q1 and q2 hit, q3 misses
	closeTo(t, "mrr", m.MRR, (1.0+0.5+0)/3)          // ranks 1, 2, none
	closeTo(t, "p@5", m.PrecisionAtK, (0.2+0.4+0)/3) // 1/5, 2/5, 0
	closeTo(t, "ndcg", m.NDCG, 0.509868413721506)    // (1 + 0.5296052411645183 + 0) / 3
	closeTo(t, "p@5 alias", m.PrecisionAt5, m.PrecisionAtK)
}

func TestRunExcludesBeforeRanking(t *testing.T) {
	queries := []Query{
		{ID: "q1", Question: "one", Relevant: map[string]int{"held/a.md": 1, "keep/b.md": 1}},
	}
	var sawExclude []string
	engine := FuncEngine{EngineName: "test", Fn: func(_ context.Context, _ string, topK int, exclude []string) ([]string, error) {
		sawExclude = exclude
		// A well-behaved engine drops the excluded subtree and backfills.
		return []string{"keep/b.md", "other.md"}, nil
	}}

	rep, err := Run(context.Background(), queries, []Engine{engine}, Options{TopK: 5, ExcludePrefixes: []string{"/held/", ""}})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(sawExclude, []string{"held/"}) {
		t.Fatalf("engine saw exclude = %v; leading slash and empties should be normalized away", sawExclude)
	}
	// held/a.md must leave the ideal set too, or nDCG is scored against a
	// document that was made unreachable on purpose.
	if got := rep.Queries[0].Relevant; !reflect.DeepEqual(got, []string{"keep/b.md"}) {
		t.Fatalf("relevant after exclusion = %v", got)
	}
	closeTo(t, "ndcg", rep.Metrics("test").NDCG, 1.0)
}

func TestRunSkipsFullyExcludedQuery(t *testing.T) {
	queries := []Query{
		{ID: "q1", Question: "one", Relevant: map[string]int{"held/a.md": 1}},
		{ID: "q2", Question: "two", Relevant: map[string]int{"keep/b.md": 1}},
	}
	engine := FuncEngine{EngineName: "test", Fn: func(_ context.Context, _ string, _ int, _ []string) ([]string, error) {
		return []string{"keep/b.md"}, nil
	}}
	rep, err := Run(context.Background(), queries, []Engine{engine}, Options{TopK: 5, ExcludePrefixes: []string{"held/"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(rep.Skipped) != 1 || rep.Skipped[0].ID != "q1" {
		t.Fatalf("skipped = %+v", rep.Skipped)
	}
	if rep.Metrics("test").Queries != 1 {
		t.Fatalf("scored %d queries, want 1", rep.Metrics("test").Queries)
	}
	closeTo(t, "hit_rate", rep.Metrics("test").HitRate, 1.0)
}

// An engine error scores the query as a miss instead of dropping it. Dropping
// would shrink the denominator and make a broken engine look perfect.
func TestRunCountsEngineErrorAsMiss(t *testing.T) {
	queries := []Query{
		{ID: "q1", Question: "one", Relevant: map[string]int{"a.md": 1}},
		{ID: "q2", Question: "two", Relevant: map[string]int{"b.md": 1}},
	}
	engine := FuncEngine{EngineName: "test", Fn: func(_ context.Context, q string, _ int, _ []string) ([]string, error) {
		if q == "two" {
			return nil, errors.New("boom")
		}
		return []string{"a.md"}, nil
	}}
	rep, err := Run(context.Background(), queries, []Engine{engine}, Options{TopK: 5})
	if err != nil {
		t.Fatal(err)
	}
	if rep.Errors != 1 {
		t.Errorf("errors = %d, want 1", rep.Errors)
	}
	m := rep.Metrics("test")
	if m.Queries != 2 {
		t.Fatalf("queries = %d, want 2", m.Queries)
	}
	closeTo(t, "hit_rate", m.HitRate, 0.5)
	if rep.Queries[1].Scores["test"].Error == "" {
		t.Error("per-query score should carry the engine error")
	}
}

func TestRunMultipleEngines(t *testing.T) {
	queries := []Query{{ID: "q1", Question: "one", Relevant: map[string]int{"a.md": 1}}}
	good := FuncEngine{EngineName: EngineFTS, Fn: func(context.Context, string, int, []string) ([]string, error) {
		return []string{"a.md"}, nil
	}}
	bad := FuncEngine{EngineName: EngineSemantic, Fn: func(context.Context, string, int, []string) ([]string, error) {
		return []string{"z.md"}, nil
	}}
	rep, err := Run(context.Background(), queries, []Engine{good, bad}, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if rep.TopK != DefaultTopK {
		t.Errorf("top_k = %d, want %d", rep.TopK, DefaultTopK)
	}
	if !reflect.DeepEqual(rep.EngineOrder, []string{EngineFTS, EngineSemantic}) {
		t.Errorf("engine order = %v", rep.EngineOrder)
	}
	closeTo(t, "fts hit_rate", rep.Metrics(EngineFTS).HitRate, 1)
	closeTo(t, "semantic hit_rate", rep.Metrics(EngineSemantic).HitRate, 0)
}

func TestExcluded(t *testing.T) {
	prefixes := []string{"competitions/s5e4/", "sources/kaggle-writeups/"}
	for path, want := range map[string]bool{
		"competitions/s5e4/index.md":            true,
		"sources/kaggle-writeups/s5e4.md":       true,
		"competitions/s5e5/index.md":            false,
		"techniques/stacking.md":                false,
		"competitions/s5e40-something/index.md": false,
	} {
		if got := Excluded(path, prefixes); got != want {
			t.Errorf("Excluded(%q) = %v, want %v", path, got, want)
		}
	}
}
