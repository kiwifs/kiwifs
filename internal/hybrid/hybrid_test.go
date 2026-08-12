package hybrid

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/kiwifs/kiwifs/internal/search"
	"github.com/kiwifs/kiwifs/internal/vectorstore"
)

// stubSearcher implements just enough of search.Searcher to drive fusion.
type stubSearcher struct {
	results []search.Result
	err     error
	delay   time.Duration
	calls   int
}

func (s *stubSearcher) Search(ctx context.Context, _ string, limit, _ int, _ string) ([]search.Result, error) {
	s.calls++
	if s.delay > 0 {
		select {
		case <-time.After(s.delay):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if s.err != nil {
		return nil, s.err
	}
	if limit > 0 && limit < len(s.results) {
		return s.results[:limit], nil
	}
	return s.results, nil
}

func (s *stubSearcher) Index(context.Context, string, []byte) error { return nil }
func (s *stubSearcher) Remove(context.Context, string) error        { return nil }
func (s *stubSearcher) Reindex(context.Context) (int, error)        { return 0, nil }
func (s *stubSearcher) Close() error                                { return nil }

func ftsResults(paths ...string) []search.Result {
	out := make([]search.Result, len(paths))
	for i, p := range paths {
		out[i] = search.Result{Path: p, Snippet: "lexical snippet for " + p}
	}
	return out
}

func TestSearchWithoutVectorsIsLexicalOnly(t *testing.T) {
	s := &stubSearcher{results: ftsResults("a.md", "b.md")}

	got, err := Search(context.Background(), s, nil, "q", Options{TopK: 5})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(Paths(got), []string{"a.md", "b.md"}) {
		t.Fatalf("got %v", Paths(got))
	}
	// Ranks make the degradation visible instead of silent.
	if got[0].FTSRank != 1 || got[0].SemanticRank != 0 {
		t.Errorf("ranks = fts %d, semantic %d; want 1 and 0", got[0].FTSRank, got[0].SemanticRank)
	}
	if got[0].Snippet == "" {
		t.Error("lexical snippet should survive fusion")
	}
}

// Without a vector index the endpoint still answers rather than 503ing, and
// the ordering is exactly the lexical ordering — fusing one list is identity.
func TestSearchWithoutVectorsPreservesLexicalOrder(t *testing.T) {
	s := &stubSearcher{results: ftsResults("a.md", "b.md", "c.md", "d.md")}
	got, err := Search(context.Background(), s, nil, "q", Options{TopK: 4})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(Paths(got), []string{"a.md", "b.md", "c.md", "d.md"}) {
		t.Fatalf("got %v", Paths(got))
	}
}

func TestSearchLexicalErrorWithoutVectorsFails(t *testing.T) {
	s := &stubSearcher{err: errors.New("index corrupt")}
	if _, err := Search(context.Background(), s, nil, "q", Options{TopK: 5}); err == nil {
		t.Fatal("expected an error when the only engine fails")
	}
}

func TestSearchTruncatesToTopK(t *testing.T) {
	s := &stubSearcher{results: ftsResults("a.md", "b.md", "c.md")}
	got, err := Search(context.Background(), s, nil, "q", Options{TopK: 2})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d results, want 2", len(got))
	}
}

// Fusion needs a deeper candidate pool than the page being returned, or there
// is nothing for the second engine to reorder.
func TestCandidateDepthExceedsTopK(t *testing.T) {
	if d := CandidateDepth(5); d < minCandidateDepth {
		t.Errorf("CandidateDepth(5) = %d, want at least %d", d, minCandidateDepth)
	}
	if d := CandidateDepth(100); d <= 100 {
		t.Errorf("CandidateDepth(100) = %d, want deeper than topK", d)
	}
	// Never past the engine's own ceiling — asking for more just gets clamped.
	if d := CandidateDepth(1000); d != search.NormalizeLimit(4000) {
		t.Errorf("CandidateDepth(1000) = %d, want the normalized ceiling", d)
	}
}

func TestSearchDedupesLexicalDuplicates(t *testing.T) {
	s := &stubSearcher{results: ftsResults("a.md", "a.md", "b.md")}
	got, err := Search(context.Background(), s, nil, "q", Options{TopK: 5})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(Paths(got), []string{"a.md", "b.md"}) {
		t.Fatalf("got %v", Paths(got))
	}
}

func TestSearchExcludesPrefixes(t *testing.T) {
	s := &stubSearcher{results: ftsResults("held/a.md", "keep/b.md")}
	got, err := Search(context.Background(), s, nil, "q", Options{
		TopK:            5,
		ExcludePrefixes: []string{"held/"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(Paths(got), []string{"keep/b.md"}) {
		t.Fatalf("got %v", Paths(got))
	}
}

// --- vector-backed fusion -------------------------------------------------

type fakeEmbedder struct{}

func (fakeEmbedder) Embed(_ context.Context, texts []string) ([][]float32, error) {
	out := make([][]float32, len(texts))
	for i := range texts {
		out[i] = []float32{1}
	}
	return out, nil
}
func (fakeEmbedder) Dimensions() int { return 1 }

// fakeVectorStore returns a fixed ranking regardless of the query vector, so
// the test controls exactly what the semantic side contributes.
type fakeVectorStore struct {
	results []vectorstore.Result
	err     error
}

func (s *fakeVectorStore) Search(_ context.Context, _ []float32, topK int) ([]vectorstore.Result, error) {
	if s.err != nil {
		return nil, s.err
	}
	if topK > 0 && topK < len(s.results) {
		return s.results[:topK], nil
	}
	return s.results, nil
}
func (s *fakeVectorStore) Upsert(context.Context, []vectorstore.Chunk) error { return nil }
func (s *fakeVectorStore) RemoveByPath(context.Context, string) error        { return nil }
func (s *fakeVectorStore) GetVectors(context.Context, string) ([]vectorstore.Chunk, error) {
	return nil, nil
}
func (s *fakeVectorStore) Reset(context.Context) error        { return nil }
func (s *fakeVectorStore) Count(context.Context) (int, error) { return len(s.results), nil }
func (s *fakeVectorStore) Close() error                       { return nil }

func vecResults(paths ...string) []vectorstore.Result {
	out := make([]vectorstore.Result, len(paths))
	for i, p := range paths {
		out[i] = vectorstore.Result{Path: p, Score: 1 - float64(i)/100, Snippet: "chunk from " + p}
	}
	return out
}

func newVectorService(t *testing.T, store vectorstore.Store) *vectorstore.Service {
	t.Helper()
	svc, err := vectorstore.NewService("/", nil, fakeEmbedder{}, store, vectorstore.Options{WorkerCount: 1})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	return svc
}

// The point of fusion: the page both engines rate highly wins, even though
// neither engine put it first.
func TestSearchFusesBothRankings(t *testing.T) {
	s := &stubSearcher{results: ftsResults("a.md", "b.md", "c.md")}
	v := newVectorService(t, &fakeVectorStore{results: vecResults("b.md", "c.md", "a.md")})

	got, err := Search(context.Background(), s, v, "q", Options{TopK: 3})
	if err != nil {
		t.Fatal(err)
	}
	// b: 1/62 + 1/61 = 0.0325225   a: 1/61 + 1/63 = 0.0322665
	// c: 1/63 + 1/62 = 0.0320020
	if !reflect.DeepEqual(Paths(got), []string{"b.md", "a.md", "c.md"}) {
		t.Fatalf("got %v, want [b.md a.md c.md]", Paths(got))
	}
	if got[0].FTSRank != 2 || got[0].SemanticRank != 1 {
		t.Errorf("b ranks = fts %d, semantic %d; want 2 and 1", got[0].FTSRank, got[0].SemanticRank)
	}
}

// A page only the vector index knows about still appears, carrying its chunk
// text since no lexical snippet exists — the query terms are not in it, which
// is exactly why keyword search missed it.
func TestSearchIncludesSemanticOnlyHits(t *testing.T) {
	s := &stubSearcher{results: ftsResults("a.md")}
	v := newVectorService(t, &fakeVectorStore{results: vecResults("z.md")})

	got, err := Search(context.Background(), s, v, "q", Options{TopK: 5})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("got %v, want both pages", Paths(got))
	}
	var semanticOnly *Result
	for i := range got {
		if got[i].Path == "z.md" {
			semanticOnly = &got[i]
		}
	}
	if semanticOnly == nil {
		t.Fatal("semantic-only hit was dropped")
	}
	if semanticOnly.FTSRank != 0 || semanticOnly.SemanticRank != 1 {
		t.Errorf("ranks = fts %d, semantic %d; want 0 and 1", semanticOnly.FTSRank, semanticOnly.SemanticRank)
	}
	if semanticOnly.Snippet != "chunk from z.md" {
		t.Errorf("snippet = %q; should fall back to the chunk text", semanticOnly.Snippet)
	}
}

// Vector results are per-chunk. Fusing them without collapsing to one row per
// path would score the same page several times for the same evidence.
func TestSearchDedupesVectorChunks(t *testing.T) {
	s := &stubSearcher{results: ftsResults("a.md")}
	v := newVectorService(t, &fakeVectorStore{results: []vectorstore.Result{
		{Path: "z.md", ChunkIdx: 0, Score: 0.9},
		{Path: "z.md", ChunkIdx: 1, Score: 0.8},
		{Path: "y.md", ChunkIdx: 0, Score: 0.7},
	}})

	got, err := Search(context.Background(), s, v, "q", Options{TopK: 5})
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]int{}
	for _, r := range got {
		seen[r.Path]++
	}
	if seen["z.md"] != 1 {
		t.Fatalf("z.md appears %d times, want 1: %v", seen["z.md"], Paths(got))
	}
	// y.md is the second distinct path, so it gets semantic rank 2 — chunk
	// positions must not leak into the rank.
	for _, r := range got {
		if r.Path == "y.md" && r.SemanticRank != 2 {
			t.Errorf("y.md semantic rank = %d, want 2", r.SemanticRank)
		}
	}
}

// A failing vector index degrades to the lexical ranking instead of failing
// the whole search.
func TestSearchDegradesWhenSemanticFails(t *testing.T) {
	s := &stubSearcher{results: ftsResults("a.md", "b.md")}
	v := newVectorService(t, &fakeVectorStore{err: errors.New("provider down")})

	got, err := Search(context.Background(), s, v, "q", Options{TopK: 5})
	if err != nil {
		t.Fatalf("a failing optional engine must not fail the search: %v", err)
	}
	if !reflect.DeepEqual(Paths(got), []string{"a.md", "b.md"}) {
		t.Fatalf("got %v", Paths(got))
	}
}

// ...and symmetrically, a failing lexical index still returns semantic hits.
func TestSearchDegradesWhenLexicalFails(t *testing.T) {
	s := &stubSearcher{err: errors.New("index corrupt")}
	v := newVectorService(t, &fakeVectorStore{results: vecResults("z.md")})

	got, err := Search(context.Background(), s, v, "q", Options{TopK: 5})
	if err != nil {
		t.Fatalf("expected degradation, got %v", err)
	}
	if !reflect.DeepEqual(Paths(got), []string{"z.md"}) {
		t.Fatalf("got %v", Paths(got))
	}
}

func TestSearchBothEnginesFail(t *testing.T) {
	s := &stubSearcher{err: errors.New("boom")}
	v := newVectorService(t, &fakeVectorStore{err: errors.New("boom")})
	if _, err := Search(context.Background(), s, v, "q", Options{TopK: 5}); err == nil {
		t.Fatal("expected an error when every engine fails")
	}
}

// Both engines run concurrently: a slow lexical search and a semantic search
// should overlap rather than serialize.
func TestSearchRunsEnginesConcurrently(t *testing.T) {
	const delay = 120 * time.Millisecond
	s := &stubSearcher{results: ftsResults("a.md"), delay: delay}
	v := newVectorService(t, &slowVectorStore{
		delay:           delay,
		fakeVectorStore: fakeVectorStore{results: vecResults("z.md")},
	})

	start := time.Now()
	if _, err := Search(context.Background(), s, v, "q", Options{TopK: 5}); err != nil {
		t.Fatal(err)
	}
	if elapsed := time.Since(start); elapsed > delay*2 {
		t.Fatalf("took %v; two %v engines run in parallel should finish well under %v", elapsed, delay, delay*2)
	}
}

type slowVectorStore struct {
	fakeVectorStore
	delay time.Duration
}

func (s *slowVectorStore) Search(ctx context.Context, vec []float32, topK int) ([]vectorstore.Result, error) {
	select {
	case <-time.After(s.delay):
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	return s.fakeVectorStore.Search(ctx, vec, topK)
}

func TestSearchEmptyResults(t *testing.T) {
	s := &stubSearcher{}
	got, err := Search(context.Background(), s, nil, "q", Options{TopK: 5})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("got %v, want empty", Paths(got))
	}
}
