package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/kiwifs/kiwifs/internal/comments"
	"github.com/kiwifs/kiwifs/internal/config"
	"github.com/kiwifs/kiwifs/internal/events"
	"github.com/kiwifs/kiwifs/internal/pipeline"
	"github.com/kiwifs/kiwifs/internal/search"
	"github.com/kiwifs/kiwifs/internal/similar"
	"github.com/kiwifs/kiwifs/internal/storage"
	"github.com/kiwifs/kiwifs/internal/versioning"
)

// buildSimilarityTestServer is buildSQLiteTestServer with a dataset
// similarity profile configured.
func buildSimilarityTestServer(t *testing.T, profiles []config.SimilarityProfileConfig) *Server {
	t.Helper()
	dir := t.TempDir()
	store, err := storage.NewLocal(dir)
	if err != nil {
		t.Fatalf("storage: %v", err)
	}
	searcher, err := search.NewSQLite(dir, store)
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	t.Cleanup(func() { _ = searcher.Close() })
	pipe := pipeline.New(store, versioning.NewNoop(), searcher, searcher, events.NewHub(), nil, "")
	cstore, err := comments.New(dir)
	if err != nil {
		t.Fatalf("comments: %v", err)
	}
	cfg := &config.Config{}
	cfg.Storage.Root = dir
	cfg.Similarity.Profiles = profiles
	return NewServer(cfg, pipe, nil, cstore, nil, nil, nil)
}

func datasetProfileConfig() []config.SimilarityProfileConfig {
	return []config.SimilarityProfileConfig{{
		Name:        "dataset",
		Match:       map[string]string{"kind": "dataset"},
		Numeric:     []string{"stats.rows"},
		Categorical: []string{"format", "license", "stats.ordered"},
	}}
}

func seedDatasets(t *testing.T, s *Server) {
	t.Helper()
	mustPutFile(t, s, "datasets/sales.md",
		"---\nkind: dataset\nformat: csv\nlicense: mit\nstats:\n  ordered: true\n  rows: 750000\n---\n# Sales\n")
	mustPutFile(t, s, "datasets/revenue.md",
		"---\nkind: dataset\nformat: csv\nlicense: mit\nstats:\n  ordered: true\n  rows: 700000\n---\n# Revenue\n")
	mustPutFile(t, s, "datasets/traffic.md",
		"---\nkind: dataset\nformat: parquet\nlicense: apache-2.0\nstats:\n  ordered: false\n  rows: 3000\n---\n# Traffic\n")
	mustPutFile(t, s, "techniques/caching.md",
		"---\nkind: technique\nformat: csv\nlicense: mit\n---\n# Caching\n")
}

func getSimilar(t *testing.T, s *Server, query string) (int, *similar.Result) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/similar?"+query, nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		return rec.Code, nil
	}
	var res similar.Result
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatalf("decode: %v (body %s)", err, rec.Body.String())
	}
	return rec.Code, &res
}

func TestSimilarByPath(t *testing.T) {
	s := buildSimilarityTestServer(t, datasetProfileConfig())
	seedDatasets(t, s)

	code, res := getSimilar(t, s, "path=datasets/sales.md&profile=dataset&k=2")
	if code != http.StatusOK {
		t.Fatalf("status = %d", code)
	}
	if len(res.Neighbors) != 2 {
		t.Fatalf("got %d neighbours, want 2", len(res.Neighbors))
	}
	if res.Neighbors[0].Path != "datasets/revenue.md" {
		t.Errorf("nearest = %q, want datasets/revenue.md", res.Neighbors[0].Path)
	}
	for _, n := range res.Neighbors {
		if n.Path == "techniques/caching.md" {
			t.Error("a non-dataset page was ranked despite the profile match")
		}
	}
	// The per-field breakdown is the point of the endpoint.
	if len(res.Neighbors[0].Contributions) != 4 {
		t.Errorf("got %d contributions, want one per profile field", len(res.Neighbors[0].Contributions))
	}
}

func TestSimilarInlineVector(t *testing.T) {
	s := buildSimilarityTestServer(t, datasetProfileConfig())
	seedDatasets(t, s)

	vector := url.QueryEscape(`{"format":"parquet","license":"apache-2.0","stats.ordered":false,"stats.rows":3500}`)
	code, res := getSimilar(t, s, "profile=dataset&k=1&vector="+vector)
	if code != http.StatusOK {
		t.Fatalf("status = %d", code)
	}
	if res.Neighbors[0].Path != "datasets/traffic.md" {
		t.Errorf("nearest = %q, want the parquet dataset", res.Neighbors[0].Path)
	}
}

func TestSimilarRequestErrors(t *testing.T) {
	s := buildSimilarityTestServer(t, datasetProfileConfig())
	seedDatasets(t, s)

	tests := []struct {
		name  string
		query string
		want  int
	}{
		{"no path or vector", "profile=dataset", http.StatusBadRequest},
		{"unknown profile", "path=datasets/sales.md&profile=nope", http.StatusBadRequest},
		{"malformed vector", "profile=dataset&vector=" + url.QueryEscape("not json"), http.StatusBadRequest},
		{"non-numeric k", "path=datasets/sales.md&profile=dataset&k=abc", http.StatusBadRequest},
		{"unindexed path", "path=datasets/ghost.md&profile=dataset", http.StatusBadRequest},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if code, _ := getSimilar(t, s, tc.query); code != tc.want {
				t.Errorf("status = %d, want %d", code, tc.want)
			}
		})
	}
}

func TestSimilarWithoutProfilesIsUnavailable(t *testing.T) {
	s := buildSimilarityTestServer(t, nil)
	seedDatasets(t, s)

	code, _ := getSimilar(t, s, "path=datasets/sales.md")
	if code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503 when no profiles are configured", code)
	}
}

func TestSimilarWeightsReorderResults(t *testing.T) {
	// End to end through the API: stats.ordered weighted 3.0 demonstrably
	// reorders the list versus weight 1.0.
	profiles := datasetProfileConfig()
	heavy := datasetProfileConfig()[0]
	heavy.Name = "dataset-weighted"
	heavy.Weights = map[string]float64{"stats.ordered": 3}
	profiles = append(profiles, heavy)

	s := buildSimilarityTestServer(t, profiles)
	seedDatasets(t, s)

	vector := url.QueryEscape(`{"format":"csv","license":"mit","stats.ordered":false,"stats.rows":500000}`)
	_, plain := getSimilar(t, s, "profile=dataset&k=5&vector="+vector)
	_, weighted := getSimilar(t, s, "profile=dataset-weighted&k=5&vector="+vector)

	rank := func(res *similar.Result, path string) int {
		for i, n := range res.Neighbors {
			if n.Path == path {
				return i
			}
		}
		return -1
	}
	const unordered = "datasets/traffic.md"
	if rank(plain, unordered) <= rank(weighted, unordered) {
		t.Errorf("weighting stats.ordered did not promote the unordered dataset (plain rank %d, weighted rank %d)",
			rank(plain, unordered), rank(weighted, unordered))
	}
}
