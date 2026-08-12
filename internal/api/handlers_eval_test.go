package api

import (
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kiwifs/kiwifs/internal/eval"
)

func postEval(t *testing.T, s *Server, body string) (*httptest.ResponseRecorder, evalResponse) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/kiwi/eval", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	var resp evalResponse
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode response: %v (%s)", err, rec.Body.String())
		}
	}
	return rec, resp
}

func nearly(t *testing.T, name string, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 1e-6 {
		t.Errorf("%s = %v, want %v", name, got, want)
	}
}

// evalCorpus seeds four pages whose BM25 order is forced by term frequency:
// the two held-out pages outrank everything, then borealis, then stacking. That
// makes "did exclusion actually move the ranking" observable rather than a
// coin flip between tied documents.
func evalCorpus(t *testing.T, s *Server) {
	t.Helper()
	mustPutFile(t, s, "projects/atlas/index.md", "# Atlas\n\nzebrabyte zebrabyte zebrabyte held out\n")
	mustPutFile(t, s, "sources/reports/atlas.md", "# Report\n\nzebrabyte zebrabyte zebrabyte held out\n")
	mustPutFile(t, s, "projects/borealis/index.md", "# Borealis\n\nzebrabyte zebrabyte kept\n")
	mustPutFile(t, s, "techniques/stacking.md", "# Stacking\n\nzebrabyte kept\n")
}

func TestEvalInlineQueries(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	evalCorpus(t, s)

	rec, resp := postEval(t, s, `{
		"queries": [{"question": "zebrabyte", "expected_paths": ["projects/atlas/index.md"]}]
	}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	if resp.TopK != eval.DefaultTopK {
		t.Errorf("top_k = %d, want %d", resp.TopK, eval.DefaultTopK)
	}
	if resp.FTS.Queries != 1 {
		t.Fatalf("scored %d queries, want 1", resp.FTS.Queries)
	}
	if resp.FTS.HitRate != 1 {
		t.Errorf("hit_rate = %v, want 1", resp.FTS.HitRate)
	}
	// One relevant page in a top-5 list.
	nearly(t, "precision_at_k", resp.FTS.PrecisionAtK, 0.2)
	nearly(t, "precision_at_5 alias", resp.FTS.PrecisionAt5, resp.FTS.PrecisionAtK)
}

// The core K9 claim: exclusion happens before ranking, so the held-out pages
// vanish from the results *and* the remaining slots are filled by the next-best
// eligible pages.
func TestEvalExcludePrefixRemovesHeldOutSubtree(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	evalCorpus(t, s)

	_, before := postEval(t, s, `{
		"queries": [{"question": "zebrabyte", "expected_paths": ["projects/borealis/index.md"]}]
	}`)
	if len(before.PerQuery) != 1 {
		t.Fatalf("per_query = %+v", before.PerQuery)
	}

	_, after := postEval(t, s, `{
		"queries": [{"question": "zebrabyte", "expected_paths": ["projects/borealis/index.md"]}],
		"exclude_prefix": ["projects/atlas/", "sources/reports/"],
		"top_k": 2
	}`)
	if after.TopK != 2 {
		t.Fatalf("top_k = %d, want 2", after.TopK)
	}
	// With the two highest-scoring pages hidden, the eligible page moves into
	// rank 1 — and P@2 is 0.5, which is only reachable if both slots were
	// filled rather than left short.
	if after.PerQuery[0].FTSRank != 1 {
		t.Errorf("fts_rank = %d, want 1 after exclusion (was %d)", after.PerQuery[0].FTSRank, before.PerQuery[0].FTSRank)
	}
	nearly(t, "precision_at_k", after.FTS.PrecisionAtK, 0.5)
	nearly(t, "ndcg", after.FTS.NDCG, 1)
	if got := after.ExcludePrefix; len(got) != 2 {
		t.Errorf("exclude_prefix echoed as %v", got)
	}
}

// A single string is accepted where a list is expected — the shape people
// reach for first.
func TestEvalExcludePrefixAcceptsScalar(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	evalCorpus(t, s)

	rec, resp := postEval(t, s, `{
		"queries": [{"question": "zebrabyte", "expected_paths": ["techniques/stacking.md"]}],
		"exclude_prefix": "projects/"
	}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	if len(resp.ExcludePrefix) != 1 || resp.ExcludePrefix[0] != "projects/" {
		t.Fatalf("exclude_prefix = %v", resp.ExcludePrefix)
	}
}

// A query whose entire relevant set is hidden is unanswerable. Scoring it as a
// miss would drag every engine down by the same constant and hide real change.
func TestEvalSkipsFullyExcludedQuery(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	evalCorpus(t, s)

	_, resp := postEval(t, s, `{
		"queries": [
			{"question": "zebrabyte", "expected_paths": ["projects/atlas/index.md"]},
			{"question": "zebrabyte", "expected_paths": ["techniques/stacking.md"]}
		],
		"exclude_prefix": ["projects/atlas/"]
	}`)
	if len(resp.Skipped) != 1 {
		t.Fatalf("skipped = %+v, want 1", resp.Skipped)
	}
	if resp.FTS.Queries != 1 {
		t.Errorf("scored %d queries, want 1", resp.FTS.Queries)
	}
	if resp.FTS.HitRate != 1 {
		t.Errorf("hit_rate = %v; the surviving query is answerable", resp.FTS.HitRate)
	}
}

// Hand-computed three-query fixture. The corpus is arranged so each query's
// ranking is forced by term frequency, and every number below is worked out on
// paper in the comments.
func TestEvalMetricsHandComputed(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	// Query "alpha": only a.md matches       -> rank 1
	// Query "beta":  b.md, c.md, d.md match; d.md twice, c.md once, b.md once,
	//                but only c.md and b.md are relevant.
	// Query "gamma": only g.md matches, and it is not relevant -> miss.
	mustPutFile(t, s, "a.md", "# A\n\nalpha\n")
	mustPutFile(t, s, "d.md", "# D\n\nbeta beta beta\n")
	mustPutFile(t, s, "c.md", "# C\n\nbeta beta\n")
	mustPutFile(t, s, "b.md", "# B\n\nbeta\n")
	mustPutFile(t, s, "g.md", "# G\n\ngamma\n")

	_, resp := postEval(t, s, `{
		"top_k": 5,
		"queries": [
			{"question": "alpha", "expected_paths": ["a.md"]},
			{"question": "beta",  "expected_paths": ["b.md", "c.md"], "grades": {"b.md": 2, "c.md": 1}},
			{"question": "gamma", "expected_paths": ["z.md"]}
		]
	}`)

	if resp.FTS.Queries != 3 {
		t.Fatalf("scored %d queries, want 3: %+v", resp.FTS.Queries, resp.PerQuery)
	}
	ranks := []int{resp.PerQuery[0].FTSRank, resp.PerQuery[1].FTSRank, resp.PerQuery[2].FTSRank}
	// alpha: a.md at 1. beta: d.md, c.md, b.md -> first relevant (c.md) at 2.
	// gamma: no relevant document retrieved.
	if ranks[0] != 1 || ranks[1] != 2 || ranks[2] != 0 {
		t.Fatalf("ranks = %v, want [1 2 0]; hits = %v", ranks, [][]string{
			resp.PerQuery[0].FTSHits, resp.PerQuery[1].FTSHits, resp.PerQuery[2].FTSHits,
		})
	}

	nearly(t, "hit_rate", resp.FTS.HitRate, 2.0/3)     // 2 of 3 queries hit
	nearly(t, "mrr", resp.FTS.MRR, (1.0+0.5+0)/3)      // 1/1, 1/2, 0
	nearly(t, "precision", resp.FTS.PrecisionAtK, 0.2) // (1/5 + 2/5 + 0) / 3

	// "beta" ranks d.md, c.md, b.md. c.md has grade 1 at rank 2, b.md grade 2
	// at rank 3:
	//   DCG  = (2^1-1)/log2(3) + (2^2-1)/log2(4) = 0.6309298 + 1.5 = 2.1309298
	//   IDCG = (2^2-1)/log2(2) + (2^1-1)/log2(3) = 3 + 0.6309298   = 3.6309298
	//   nDCG = 0.58688267143572
	nearly(t, "beta ndcg", resp.PerQuery[1].FTSNDCG, 0.58688267143572)
	nearly(t, "ndcg", resp.FTS.NDCG, 0.5289608904785733) // (1 + 0.58688267143572 + 0) / 3
}

func TestEvalGoldenSet(t *testing.T) {
	s, dir := buildSQLiteTestServer(t)
	evalCorpus(t, s)

	evalDir := filepath.Join(dir, filepath.FromSlash(eval.EvalDir))
	if err := os.MkdirAll(evalDir, 0o755); err != nil {
		t.Fatal(err)
	}
	qrels := "q1 0 projects/borealis/index.md 1\nq2 0 techniques/stacking.md 1\n"
	topics := "q1\tzebrabyte\nq2\tzebrabyte\n"
	if err := os.WriteFile(filepath.Join(evalDir, "leave-one-out.qrels"), []byte(qrels), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(evalDir, "leave-one-out.topics"), []byte(topics), 0o644); err != nil {
		t.Fatal(err)
	}

	rec, resp := postEval(t, s, `{"set": "leave-one-out", "exclude_prefix": ["projects/atlas/", "sources/reports/"]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	if resp.FTS.Queries != 2 {
		t.Fatalf("scored %d queries, want 2", resp.FTS.Queries)
	}
	if resp.FTS.HitRate != 1 {
		t.Errorf("hit_rate = %v, want 1: %+v", resp.FTS.HitRate, resp.PerQuery)
	}
}

func TestEvalBadRequests(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	cases := map[string]string{
		"neither set nor queries": `{}`,
		"both set and queries":    `{"set": "x", "queries": [{"question": "q", "expected_paths": ["a.md"]}]}`,
		"unknown set":             `{"set": "does-not-exist"}`,
		"traversal in set name":   `{"set": "../../etc/passwd"}`,
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			rec, _ := postEval(t, s, body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (%s)", rec.Code, rec.Body.String())
			}
		})
	}
}

// Semantic metrics are all zero rather than absent when no vector index is
// configured, and the request still succeeds.
func TestEvalWithoutVectors(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	evalCorpus(t, s)

	rec, resp := postEval(t, s, `{"queries": [{"question": "zebrabyte", "expected_paths": ["techniques/stacking.md"]}]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	if resp.Semantic.Queries != 0 {
		t.Errorf("semantic queries = %d, want 0 when no vector index exists", resp.Semantic.Queries)
	}
	if resp.Errors != 0 {
		t.Errorf("errors = %d, want 0", resp.Errors)
	}
}
