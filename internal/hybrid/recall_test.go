package hybrid

import (
	"context"
	"errors"
	"math"
	"reflect"
	"testing"

	"github.com/kiwifs/kiwifs/internal/links"
)

// stubBacklinks maps a target to the pages that link to it.
type stubBacklinks struct {
	in    map[string][]string
	err   error
	calls []string
}

func (s *stubBacklinks) Backlinks(_ context.Context, target string) ([]links.Entry, error) {
	s.calls = append(s.calls, target)
	if s.err != nil {
		return nil, s.err
	}
	var out []links.Entry
	for _, src := range s.in[target] {
		out = append(out, links.Entry{Path: src, Count: 1})
	}
	return out, nil
}

// metaSearcher adds the frontmatter-backed capabilities Recall uses.
type metaSearcher struct {
	stubSearcher
	scopes      map[string]string
	confidences map[string]float64
}

func (s *metaSearcher) FilterByScope(_ context.Context, paths []string, scope string) ([]string, error) {
	var out []string
	for _, p := range paths {
		if s.scopes[p] == scope {
			out = append(out, p)
		}
	}
	return out, nil
}

func (s *metaSearcher) Confidences(_ context.Context, paths []string) (map[string]float64, error) {
	out := map[string]float64{}
	for _, p := range paths {
		if c, ok := s.confidences[p]; ok {
			out[p] = c
		}
	}
	return out, nil
}

func recallPaths(resp *RecallResponse) []string {
	out := make([]string, len(resp.Results))
	for i, r := range resp.Results {
		out[i] = r.Path
	}
	return out
}

func TestParseSources(t *testing.T) {
	for _, tc := range []struct {
		in      []string
		want    []string
		wantErr bool
	}{
		{in: nil, want: []string{"fts", "vector", "graph"}},
		{in: []string{"graph", "FTS", "fts"}, want: []string{"fts", "graph"}},
		{in: []string{" vector "}, want: []string{"vector"}},
		{in: []string{"graph"}, wantErr: true},
		{in: []string{"fts", "keyword"}, wantErr: true},
	} {
		got, err := ParseSources(tc.in)
		if tc.wantErr {
			if err == nil {
				t.Errorf("ParseSources(%v) = %v; want an error", tc.in, got)
			}
			continue
		}
		if err != nil || !reflect.DeepEqual(got, tc.want) {
			t.Errorf("ParseSources(%v) = %v, %v; want %v", tc.in, got, err, tc.want)
		}
	}
}

// With only a lexical index, recall is the lexical ranking and says so.
func TestRecallLexicalOnly(t *testing.T) {
	s := &stubSearcher{results: ftsResults("a.md", "b.md")}

	resp, err := Recall(context.Background(), s, nil, nil, "q", RecallOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(recallPaths(resp), []string{"a.md", "b.md"}) {
		t.Fatalf("got %v", recallPaths(resp))
	}
	if !reflect.DeepEqual(resp.Engines, []string{"fts"}) {
		t.Errorf("engines = %v, want [fts]", resp.Engines)
	}
	r := resp.Results[0]
	if r.FTSRank != 1 || r.VectorRank != 0 || r.GraphRank != 0 {
		t.Errorf("ranks = %d/%d/%d", r.FTSRank, r.VectorRank, r.GraphRank)
	}
	if !reflect.DeepEqual(r.Sources, []string{"fts"}) {
		t.Errorf("sources = %v", r.Sources)
	}
	if r.Snippet == "" {
		t.Error("lexical snippet should survive fusion")
	}
}

// A page that matches no query term but links to several of the best hits is
// recalled through the graph, with the hits it links to as its provenance.
func TestRecallGraphSurfacesLinkingPages(t *testing.T) {
	s := &stubSearcher{results: ftsResults("a.md", "b.md", "c.md")}
	l := &stubBacklinks{in: map[string][]string{
		"a.md": {"hub.md", "side.md"},
		"b.md": {"hub.md"},
	}}

	resp, err := Recall(context.Background(), s, nil, l, "q", RecallOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(resp.Engines, []string{"fts", "graph"}) {
		t.Errorf("engines = %v", resp.Engines)
	}
	byPath := map[string]RecallResult{}
	for _, r := range resp.Results {
		byPath[r.Path] = r
	}
	hub, ok := byPath["hub.md"]
	if !ok {
		t.Fatalf("hub.md was not recalled: %v", recallPaths(resp))
	}
	if hub.GraphRank != 1 || hub.FTSRank != 0 {
		t.Errorf("hub ranks = fts %d graph %d; it links to two hits so it ranks first", hub.FTSRank, hub.GraphRank)
	}
	if !reflect.DeepEqual(hub.LinksTo, []string{"a.md", "b.md"}) {
		t.Errorf("hub links_to = %v", hub.LinksTo)
	}
	if !reflect.DeepEqual(hub.Sources, []string{"graph"}) {
		t.Errorf("hub sources = %v", hub.Sources)
	}
	if side := byPath["side.md"]; side.GraphRank != 2 {
		t.Errorf("side graph rank = %d, want 2", side.GraphRank)
	}
}

// Graph evidence on top of a lexical match lifts a page above one the lexical
// engine alone ranked higher.
func TestRecallGraphReordersLexicalHits(t *testing.T) {
	s := &stubSearcher{results: ftsResults("a.md", "b.md", "c.md")}
	// c.md links to a.md: it is lexical #3 and graph #1.
	l := &stubBacklinks{in: map[string][]string{"a.md": {"c.md"}}}

	resp, err := Recall(context.Background(), s, nil, l, "q", RecallOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if got := recallPaths(resp); got[0] != "c.md" {
		t.Fatalf("order = %v; c.md has two signals and should lead", got)
	}
	if !reflect.DeepEqual(resp.Results[0].Sources, []string{"fts", "graph"}) {
		t.Errorf("sources = %v", resp.Results[0].Sources)
	}
}

func TestRecallSkipsGraphWhenNotRequested(t *testing.T) {
	s := &stubSearcher{results: ftsResults("a.md")}
	l := &stubBacklinks{in: map[string][]string{"a.md": {"hub.md"}}}

	resp, err := Recall(context.Background(), s, nil, l, "q", RecallOptions{Sources: []string{"fts"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(l.calls) != 0 {
		t.Errorf("backlinks were queried for %v", l.calls)
	}
	if !reflect.DeepEqual(recallPaths(resp), []string{"a.md"}) {
		t.Errorf("got %v", recallPaths(resp))
	}
}

// A self-link is not evidence, and only the top hits seed the expansion.
func TestRecallGraphSeedsAndSelfLinks(t *testing.T) {
	paths := make([]string, 0, graphSeeds+2)
	for i := 0; i < graphSeeds+2; i++ {
		paths = append(paths, string(rune('a'+i))+".md")
	}
	s := &stubSearcher{results: ftsResults(paths...)}
	l := &stubBacklinks{in: map[string][]string{"a.md": {"a.md"}}}

	resp, err := Recall(context.Background(), s, nil, l, "q", RecallOptions{TopK: 20})
	if err != nil {
		t.Fatal(err)
	}
	if len(l.calls) != graphSeeds {
		t.Errorf("expanded %d seeds, want %d", len(l.calls), graphSeeds)
	}
	if resp.Results[0].Path != "a.md" || resp.Results[0].GraphRank != 0 {
		t.Errorf("a.md linking to itself gained graph rank %d", resp.Results[0].GraphRank)
	}
}

// A broken link index costs the graph signal, not the whole recall.
func TestRecallDegradesWhenGraphFails(t *testing.T) {
	s := &stubSearcher{results: ftsResults("a.md", "b.md")}
	l := &stubBacklinks{err: errors.New("links table locked")}

	resp, err := Recall(context.Background(), s, nil, l, "q", RecallOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(resp.Engines, []string{"fts"}) {
		t.Errorf("engines = %v; a failed signal must not be reported", resp.Engines)
	}
	if !reflect.DeepEqual(recallPaths(resp), []string{"a.md", "b.md"}) {
		t.Errorf("got %v", recallPaths(resp))
	}
}

func TestRecallFusesVectorHits(t *testing.T) {
	s := &stubSearcher{results: ftsResults("a.md", "b.md")}
	v := newVectorService(t, &fakeVectorStore{results: vecResults("b.md", "sem.md")})
	l := &stubBacklinks{in: map[string][]string{"sem.md": {"hub.md"}}}

	resp, err := Recall(context.Background(), s, v, l, "q", RecallOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(resp.Engines, []string{"fts", "vector", "graph"}) {
		t.Errorf("engines = %v", resp.Engines)
	}
	got := recallPaths(resp)
	if got[0] != "b.md" {
		t.Errorf("order = %v; b.md is found by both engines", got)
	}
	byPath := map[string]RecallResult{}
	for _, r := range resp.Results {
		byPath[r.Path] = r
	}
	if r := byPath["sem.md"]; r.VectorRank != 2 || r.Snippet != "chunk from sem.md" {
		t.Errorf("semantic-only hit = %+v", r)
	}
	// Semantic hits seed the graph too.
	if r := byPath["hub.md"]; r.GraphRank != 1 || !reflect.DeepEqual(r.LinksTo, []string{"sem.md"}) {
		t.Errorf("hub.md = %+v", r)
	}
}

func TestRecallVectorOnlyWithoutIndex(t *testing.T) {
	s := &stubSearcher{results: ftsResults("a.md")}
	_, err := Recall(context.Background(), s, nil, nil, "q", RecallOptions{Sources: []string{"vector"}})
	if !errors.Is(err, ErrNoVectorIndex) {
		t.Fatalf("err = %v, want ErrNoVectorIndex", err)
	}
	if s.calls != 0 {
		t.Error("the lexical engine ran although it was not requested")
	}
}

func TestRecallVectorOnly(t *testing.T) {
	s := &stubSearcher{results: ftsResults("a.md")}
	v := newVectorService(t, &fakeVectorStore{results: vecResults("sem.md")})

	resp, err := Recall(context.Background(), s, v, nil, "q", RecallOptions{Sources: []string{"vector"}})
	if err != nil {
		t.Fatal(err)
	}
	if s.calls != 0 {
		t.Error("the lexical engine ran although it was not requested")
	}
	if !reflect.DeepEqual(recallPaths(resp), []string{"sem.md"}) || !reflect.DeepEqual(resp.Engines, []string{"vector"}) {
		t.Errorf("got %v from %v", recallPaths(resp), resp.Engines)
	}
}

func TestRecallInvalidSource(t *testing.T) {
	s := &stubSearcher{results: ftsResults("a.md")}
	if _, err := Recall(context.Background(), s, nil, nil, "q", RecallOptions{Sources: []string{"bm25"}}); err == nil {
		t.Fatal("expected an error for an unknown source")
	}
}

func TestRecallScopeNeedsFrontmatterIndex(t *testing.T) {
	s := &stubSearcher{results: ftsResults("a.md")}
	_, err := Recall(context.Background(), s, nil, nil, "q", RecallOptions{Scope: "user:alice"})
	if !errors.Is(err, ErrScopeUnsupported) {
		t.Fatalf("err = %v, want ErrScopeUnsupported", err)
	}
}

// Scope and path prefix apply to graph neighbours too: the link index knows
// nothing about either.
func TestRecallFiltersGraphNeighbours(t *testing.T) {
	s := &metaSearcher{
		stubSearcher: stubSearcher{results: ftsResults("notes/a.md")},
		scopes: map[string]string{
			"notes/a.md":     "user:alice",
			"notes/alice.md": "user:alice",
			"notes/bob.md":   "user:bob",
			"other/alice.md": "user:alice",
		},
	}
	l := &stubBacklinks{in: map[string][]string{
		"notes/a.md": {"notes/alice.md", "notes/bob.md", "other/alice.md"},
	}}

	resp, err := Recall(context.Background(), s, nil, l, "q", RecallOptions{Scope: "user:alice", PathPrefix: "notes/"})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(recallPaths(resp), []string{"notes/a.md", "notes/alice.md"}) {
		t.Fatalf("got %v", recallPaths(resp))
	}
}

func TestRecallBoostVerified(t *testing.T) {
	s := &metaSearcher{
		stubSearcher: stubSearcher{results: ftsResults("a.md", "b.md", "c.md")},
		confidences:  map[string]float64{"c.md": 0.9},
	}

	plain, err := Recall(context.Background(), s, nil, nil, "q", RecallOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if plain.Results[2].Confidence != nil {
		t.Error("confidence reported without boost_verified")
	}

	boosted, err := Recall(context.Background(), s, nil, nil, "q", RecallOptions{BoostVerified: true})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(recallPaths(boosted), []string{"c.md", "a.md", "b.md"}) {
		t.Fatalf("order = %v; c.md's confidence should lift it", recallPaths(boosted))
	}
	top := boosted.Results[0]
	if top.Confidence == nil || *top.Confidence != 0.9 {
		t.Fatalf("confidence = %v", top.Confidence)
	}
	if want := plain.Results[2].Score * 1.9; math.Abs(top.Score-want) > 1e-12 {
		t.Errorf("score = %v, want %v", top.Score, want)
	}
	if boosted.Results[1].Confidence != nil {
		t.Error("unannotated page reported a confidence")
	}
}

func TestRecallTruncatesToTopK(t *testing.T) {
	s := &stubSearcher{results: ftsResults("a.md", "b.md", "c.md")}
	l := &stubBacklinks{in: map[string][]string{"a.md": {"x.md", "y.md"}}}

	resp, err := Recall(context.Background(), s, nil, l, "q", RecallOptions{TopK: 2})
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.Results) != 2 {
		t.Fatalf("got %d results, want 2", len(resp.Results))
	}
}

func TestRecallEmpty(t *testing.T) {
	s := &stubSearcher{}
	l := &stubBacklinks{}
	resp, err := Recall(context.Background(), s, nil, l, "q", RecallOptions{BoostVerified: true})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Results == nil || len(resp.Results) != 0 {
		t.Errorf("results = %#v; want an empty, non-nil slice", resp.Results)
	}
	if len(l.calls) != 0 {
		t.Errorf("backlinks queried with no seeds: %v", l.calls)
	}
}
