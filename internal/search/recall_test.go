package search

import (
	"context"
	"testing"
)

func TestFuseRRFCombinesSources(t *testing.T) {
	lists := []RankedList{
		{
			Source: SourceFTS,
			Hits: []RankedHit{
				{Path: "pages/a.md", Snippet: "alpha"},
				{Path: "pages/b.md", Snippet: "beta"},
			},
		},
		{
			Source: SourceVector,
			Hits: []RankedHit{
				{Path: "pages/b.md", Snippet: "beta vec"},
				{Path: "pages/c.md", Snippet: "gamma"},
			},
		},
	}
	fused := FuseRRF(lists, 60)
	if len(fused) != 3 {
		t.Fatalf("expected 3 fused paths, got %d", len(fused))
	}
	b := fused["pages/b.md"]
	if b == nil {
		t.Fatal("expected pages/b.md in fused results")
	}
	if b.ranks[SourceFTS] != 2 || b.ranks[SourceVector] != 1 {
		t.Fatalf("unexpected ranks for b: %+v", b.ranks)
	}
	wantB := 1.0/(60+2) + 1.0/(60+1)
	if diff := b.score - wantB; diff > 1e-9 || diff < -1e-9 {
		t.Fatalf("b score = %v, want %v", b.score, wantB)
	}
	if b.snippet != "beta" {
		t.Fatalf("snippet = %q, want beta from fts hit", b.snippet)
	}
}

func TestFuseRRFSingleSource(t *testing.T) {
	fused := FuseRRF([]RankedList{{
		Source: SourceFTS,
		Hits:   []RankedHit{{Path: "x.md"}},
	}}, 60)
	if len(fused) != 1 {
		t.Fatalf("expected 1 result, got %d", len(fused))
	}
	want := 1.0 / 61.0
	if fused["x.md"].score != want {
		t.Fatalf("score = %v, want %v", fused["x.md"].score, want)
	}
}

func TestRecallerFTSOnlyWhenVectorDisabled(t *testing.T) {
	searcher := &mockRecallSearcher{results: []Result{
		{Path: "auth.md", Snippet: "auth migration", Score: 1.0},
	}}
	r := &Recaller{Searcher: searcher}
	out, err := r.Recall(context.Background(), RecallOptions{
		Query:   "auth migration",
		Limit:   5,
		Sources: []string{SourceFTS, SourceVector},
	})
	if err != nil {
		t.Fatalf("Recall: %v", err)
	}
	if len(out) != 1 || out[0].Path != "auth.md" {
		t.Fatalf("unexpected results: %+v", out)
	}
	if len(out[0].Sources) != 1 || out[0].Sources[0] != SourceFTS {
		t.Fatalf("sources = %v, want [fts]", out[0].Sources)
	}
	if out[0].FTSRank != 1 {
		t.Fatalf("fts_rank = %d, want 1", out[0].FTSRank)
	}
}

func TestRecallerBoostVerifiedUsesConfidence(t *testing.T) {
	searcher := &mockRecallSearcher{results: []Result{{Path: "verified.md", Snippet: "note"}}}
	meta := &mockMetaReader{data: map[string]map[string]any{
		"verified.md": {"confidence": 0.8, "title": "Verified"},
	}}
	r := &Recaller{Searcher: searcher, Meta: meta}
	out, err := r.Recall(context.Background(), RecallOptions{
		Query:         "note",
		Limit:         5,
		Sources:       []string{SourceFTS},
		BoostVerified: true,
	})
	if err != nil {
		t.Fatalf("Recall: %v", err)
	}
	if len(out) != 1 {
		t.Fatalf("expected 1 result, got %+v", out)
	}
	base := 1.0 / (DefaultRRFK + 1)
	if out[0].Score != base*0.8 {
		t.Fatalf("score = %v, want %v", out[0].Score, base*0.8)
	}
	if out[0].Title != "Verified" {
		t.Fatalf("title = %q, want Verified", out[0].Title)
	}
}

func TestRecallerGraphExpandsSeedBacklinks(t *testing.T) {
	searcher := &mockRecallSearcher{results: []Result{{Path: "seed.md", Snippet: "seed"}}}
	linker := &mockBacklinkFinder{links: map[string][]BacklinkHit{
		"seed.md": {{Path: "related.md"}},
	}}
	r := &Recaller{Searcher: searcher, Linker: linker}
	out, err := r.Recall(context.Background(), RecallOptions{
		Query:   "seed",
		Limit:   10,
		Sources: []string{SourceFTS, SourceGraph},
	})
	if err != nil {
		t.Fatalf("Recall: %v", err)
	}
	if len(out) != 2 {
		t.Fatalf("expected seed + related, got %+v", out)
	}
	var related *RecallResult
	for i := range out {
		if out[i].Path == "related.md" {
			related = &out[i]
			break
		}
	}
	if related == nil {
		t.Fatal("related.md not in results")
	}
	if related.GraphRank != 1 {
		t.Fatalf("graph_rank = %d, want 1", related.GraphRank)
	}
}

type mockRecallSearcher struct {
	results []Result
}

func (m *mockRecallSearcher) Search(ctx context.Context, query string, limit, offset int, pathPrefix string) ([]Result, error) {
	end := len(m.results)
	if limit > 0 && limit < end {
		end = limit
	}
	return m.results[:end], nil
}

func (m *mockRecallSearcher) Index(ctx context.Context, path string, content []byte) error {
	return nil
}

func (m *mockRecallSearcher) Remove(ctx context.Context, path string) error { return nil }

func (m *mockRecallSearcher) Reindex(ctx context.Context) (int, error) { return 0, nil }

func (m *mockRecallSearcher) Close() error { return nil }

type mockMetaReader struct {
	data map[string]map[string]any
}

func (m *mockMetaReader) FrontmatterForPaths(ctx context.Context, paths []string) (map[string]map[string]any, error) {
	out := map[string]map[string]any{}
	for _, path := range paths {
		if fm, ok := m.data[path]; ok {
			out[path] = fm
		}
	}
	return out, nil
}

type mockBacklinkFinder struct {
	links map[string][]BacklinkHit
}

func (m *mockBacklinkFinder) Backlinks(ctx context.Context, path string) ([]BacklinkHit, error) {
	return m.links[path], nil
}
