package eval

import (
	"context"

	"github.com/kiwifs/kiwifs/internal/hybrid"
	"github.com/kiwifs/kiwifs/internal/search"
	"github.com/kiwifs/kiwifs/internal/vectorstore"
)

// Engine names. These are the keys in Report.Engines and the JSON field names
// the API surfaces, so they are part of the contract.
const (
	EngineFTS      = "fts"
	EngineSemantic = "semantic"
	EngineHybrid   = "hybrid"
)

// DefaultEngines is the standard set under test: the FTS5 index, plus — when a
// vector index is configured — the vector index and their RRF fusion. Both the
// REST handler and the MCP backend use it so a run means the same thing
// whichever door you came in.
//
// Hybrid is omitted without a vector index because it would be a second,
// identically-scoring copy of the lexical row.
func DefaultEngines(searcher search.Searcher, vectors *vectorstore.Service) []Engine {
	engines := []Engine{LexicalEngine{Searcher: searcher, Boost: true}}
	if vectors != nil {
		engines = append(engines,
			SemanticEngine{Vectors: vectors},
			HybridEngine{Searcher: searcher, Vectors: vectors},
		)
	}
	return engines
}

// LexicalEngine evaluates the FTS5 index.
type LexicalEngine struct {
	Searcher search.Searcher
	// Boost uses the trust-weighted ranking when the searcher supports it,
	// matching what GET /api/kiwi/search does by default.
	Boost bool
}

func (e LexicalEngine) Name() string { return EngineFTS }

func (e LexicalEngine) Rank(ctx context.Context, question string, topK int, exclude []string) ([]string, error) {
	results, err := SearchExcluding(ctx, e.Searcher, question, topK, exclude, e.Boost)
	if err != nil {
		return nil, err
	}
	paths := make([]string, 0, len(results))
	for _, r := range results {
		paths = append(paths, r.Path)
	}
	return paths, nil
}

// SearchExcluding runs a lexical search with prefix exclusions applied before
// ranking. Backends implementing OptionsSearcher push the exclusion into SQL;
// for anything else (grep) it widens the fetch and filters, which is
// equivalent as long as the widened fetch is not itself truncated.
func SearchExcluding(ctx context.Context, s search.Searcher, query string, topK int, exclude []string, boost bool) ([]search.Result, error) {
	if s == nil {
		return nil, nil
	}
	if topK <= 0 {
		topK = DefaultTopK
	}
	sopts := search.SearchOptions{ExcludePrefixes: exclude}
	if bos, ok := s.(search.BoostedOptionsSearcher); ok && boost {
		return bos.SearchBoostedWithOptions(ctx, query, topK, 0, "", sopts)
	}
	if os, ok := s.(search.OptionsSearcher); ok {
		return os.SearchWithOptions(ctx, query, topK, 0, "", sopts)
	}
	if len(exclude) == 0 {
		if ts, ok := s.(search.TrustSearcher); ok && boost {
			return ts.SearchBoosted(ctx, query, topK, 0, "")
		}
		return s.Search(ctx, query, topK, 0, "")
	}
	// Widen once to the engine's ceiling rather than looping: NormalizeLimit
	// caps at maxSearchLimit anyway, so a second round would fetch the same
	// rows again.
	raw, err := s.Search(ctx, query, search.NormalizeLimit(0), 0, "")
	if err != nil {
		return nil, err
	}
	out := make([]search.Result, 0, topK)
	for _, r := range raw {
		if Excluded(r.Path, exclude) {
			continue
		}
		out = append(out, r)
		if len(out) == topK {
			break
		}
	}
	return out, nil
}

// SemanticEngine evaluates the vector index.
type SemanticEngine struct {
	Vectors *vectorstore.Service
}

func (e SemanticEngine) Name() string { return EngineSemantic }

func (e SemanticEngine) Rank(ctx context.Context, question string, topK int, exclude []string) ([]string, error) {
	if e.Vectors == nil {
		return nil, nil
	}
	results, err := e.Vectors.SearchFiltered(ctx, question, topK, func(path string) bool {
		return !Excluded(path, exclude)
	})
	if err != nil {
		return nil, err
	}
	paths := make([]string, 0, len(results))
	for _, r := range results {
		paths = append(paths, r.Path)
	}
	return paths, nil
}

// HybridEngine evaluates RRF fusion of the two indexes. It calls the same
// hybrid.Search that GET /api/kiwi/search?mode=hybrid and kiwi_search_hybrid
// call, so the measured ranking is the shipped ranking.
type HybridEngine struct {
	Searcher search.Searcher
	Vectors  *vectorstore.Service
	// K is the RRF rank constant. Zero uses search.DefaultRRFK.
	K float64
}

func (e HybridEngine) Name() string { return EngineHybrid }

func (e HybridEngine) Rank(ctx context.Context, question string, topK int, exclude []string) ([]string, error) {
	results, err := hybrid.Search(ctx, e.Searcher, e.Vectors, question, hybrid.Options{
		TopK:            topK,
		K:               e.K,
		ExcludePrefixes: exclude,
		Boost:           true,
	})
	if err != nil {
		return nil, err
	}
	return hybrid.Paths(results), nil
}

// FuncEngine adapts a plain function to Engine, for strategies that are
// composed rather than backed by a single index (hybrid retrieval) and for
// tests.
type FuncEngine struct {
	EngineName string
	Fn         func(ctx context.Context, question string, topK int, exclude []string) ([]string, error)
}

func (e FuncEngine) Name() string { return e.EngineName }

func (e FuncEngine) Rank(ctx context.Context, question string, topK int, exclude []string) ([]string, error) {
	if e.Fn == nil {
		return nil, nil
	}
	return e.Fn(ctx, question, topK, exclude)
}
