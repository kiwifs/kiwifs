package eval

import (
	"context"

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

// DefaultEngines is the standard pair under test: the FTS5 index, plus the
// vector index when one is configured. Both the REST handler and the MCP
// backend use it so a run means the same thing whichever door you came in.
func DefaultEngines(searcher search.Searcher, vectors *vectorstore.Service) []Engine {
	engines := []Engine{LexicalEngine{Searcher: searcher, Boost: true}}
	if vectors != nil {
		engines = append(engines, SemanticEngine{Vectors: vectors})
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
	if os, ok := s.(search.OptionsSearcher); ok {
		return os.SearchWithOptions(ctx, query, topK, 0, "", search.SearchOptions{ExcludePrefixes: exclude})
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
