package vectorstore

import (
	"context"
	"reflect"
	"testing"
)

// rankedStore returns a fixed, pre-sorted result list truncated to topK, and
// records the topK values it was asked for so the widening behaviour is
// observable.
type rankedStore struct {
	fakeStore
	results  []Result
	requests []int
}

func (s *rankedStore) Search(_ context.Context, _ []float32, topK int) ([]Result, error) {
	s.requests = append(s.requests, topK)
	if topK > len(s.results) {
		topK = len(s.results)
	}
	return s.results[:topK], nil
}

func newFilterService(t *testing.T, store Store) *Service {
	t.Helper()
	svc, err := NewService("/", nil, &fakeEmbedder{}, store, Options{WorkerCount: 1})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	return svc
}

func paths(results []Result) []string {
	out := make([]string, len(results))
	for i, r := range results {
		out[i] = r.Path
	}
	return out
}

func TestDedupeByPathKeepsBestChunk(t *testing.T) {
	in := []Result{
		{Path: "a.md", ChunkIdx: 3, Score: 0.9},
		{Path: "a.md", ChunkIdx: 1, Score: 0.8},
		{Path: "b.md", ChunkIdx: 0, Score: 0.7},
	}
	got := DedupeByPath(in, nil, 0)
	if len(got) != 2 {
		t.Fatalf("got %d rows, want 2: %+v", len(got), got)
	}
	if got[0].Path != "a.md" || got[0].ChunkIdx != 3 {
		t.Errorf("first row = %+v; the highest-scoring chunk should win", got[0])
	}
}

func TestDedupeByPathAppliesLimitAfterDedupe(t *testing.T) {
	in := []Result{
		{Path: "a.md", ChunkIdx: 0},
		{Path: "a.md", ChunkIdx: 1},
		{Path: "b.md", ChunkIdx: 0},
	}
	got := DedupeByPath(in, nil, 2)
	if !reflect.DeepEqual(paths(got), []string{"a.md", "b.md"}) {
		t.Fatalf("got %v; duplicates must not consume a slot", paths(got))
	}
}

// The point of SearchFiltered: a filtered top-K is filled with the next-best
// eligible chunks, not returned short.
func TestSearchFilteredWidensUntilTopKFilled(t *testing.T) {
	var results []Result
	for i := 0; i < 12; i++ {
		results = append(results, Result{Path: "held/x.md", ChunkIdx: i, Score: 1})
	}
	results = append(results,
		Result{Path: "keep/a.md", Score: 0.5},
		Result{Path: "keep/b.md", Score: 0.4},
	)
	store := &rankedStore{results: results}
	svc := newFilterService(t, store)

	got, err := svc.SearchFiltered(context.Background(), "q", 2, func(p string) bool {
		return p != "held/x.md"
	})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(paths(got), []string{"keep/a.md", "keep/b.md"}) {
		t.Fatalf("got %v, want both eligible pages", paths(got))
	}
	if len(store.requests) < 2 {
		t.Fatalf("expected the fetch to widen, requests = %v", store.requests)
	}
}

// When the index is exhausted the loop stops rather than spinning to the cap.
func TestSearchFilteredStopsWhenIndexExhausted(t *testing.T) {
	store := &rankedStore{results: []Result{
		{Path: "held/x.md"},
		{Path: "keep/a.md"},
	}}
	svc := newFilterService(t, store)

	got, err := svc.SearchFiltered(context.Background(), "q", 5, func(p string) bool {
		return p != "held/x.md"
	})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(paths(got), []string{"keep/a.md"}) {
		t.Fatalf("got %v", paths(got))
	}
	if len(store.requests) != 1 {
		t.Fatalf("requests = %v; a short result means the index is exhausted", store.requests)
	}
}

func TestSearchFilteredDedupesChunks(t *testing.T) {
	store := &rankedStore{results: []Result{
		{Path: "a.md", ChunkIdx: 0, Score: 0.9},
		{Path: "a.md", ChunkIdx: 4, Score: 0.8},
		{Path: "b.md", ChunkIdx: 2, Score: 0.7},
	}}
	svc := newFilterService(t, store)

	got, err := svc.SearchFiltered(context.Background(), "q", 2, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(paths(got), []string{"a.md", "b.md"}) {
		t.Fatalf("got %v", paths(got))
	}
}

func TestSearchFilteredEmptyQuery(t *testing.T) {
	svc := newFilterService(t, &rankedStore{})
	got, err := svc.SearchFiltered(context.Background(), "   ", 5, nil)
	if err != nil || got != nil {
		t.Fatalf("got %v, %v", got, err)
	}
}
