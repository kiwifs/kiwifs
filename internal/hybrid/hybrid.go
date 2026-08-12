// Package hybrid combines lexical (FTS5) and semantic (vector) retrieval into
// one ranked list using Reciprocal Rank Fusion.
//
// It exists as its own package so the REST handler, the kiwi_search_hybrid MCP
// tool and the held-out evaluation in internal/eval all run the *same*
// retrieval. A separate fusion path inside the evaluator would measure
// something the users never get.
package hybrid

import (
	"context"
	"log"

	"github.com/kiwifs/kiwifs/internal/search"
	"github.com/kiwifs/kiwifs/internal/vectorstore"
	"golang.org/x/sync/errgroup"
)

// Result is one fused hit. The per-engine ranks are part of the contract:
// "which side found this, and where" is the first question anyone debugging
// retrieval asks, and RRF scores alone cannot answer it.
type Result struct {
	Path string `json:"path"`
	// Score is the RRF score. Comparable within one response only.
	Score float64 `json:"score"`
	// FTSRank and SemanticRank are 1-based; 0 means that engine did not
	// return the path at all.
	FTSRank      int            `json:"fts_rank"`
	SemanticRank int            `json:"semantic_rank"`
	Snippet      string         `json:"snippet,omitempty"`
	Matches      []search.Match `json:"matches,omitempty"`
}

// Options tune one hybrid search.
type Options struct {
	// TopK is how many fused results to return.
	TopK int
	// K is the RRF rank constant. Zero uses search.DefaultRRFK.
	K float64
	// ExcludePrefixes hides path subtrees, applied before ranking on both
	// sides so held-out evaluation stays honest.
	ExcludePrefixes []string
	// PathPrefix restricts results to one subtree (lexical side only pushes
	// this into SQL; the semantic side filters).
	PathPrefix string
	// Boost applies trust weighting to the lexical side, matching the default
	// behaviour of GET /api/kiwi/search.
	Boost bool
	// CandidateDepth is how deep each engine is asked to rank before fusing.
	// Zero derives it from TopK.
	CandidateDepth int
}

// DefaultTopK is the number of fused results returned when TopK is unset.
const DefaultTopK = 15

// minCandidateDepth is the floor on how deep each engine ranks before fusion.
// Fusing two 5-item lists mostly reproduces whichever list the caller already
// had; the reordering RRF exists for needs candidates to reorder.
const minCandidateDepth = 50

// CandidateDepth is how deep each engine ranks before fusion.
func CandidateDepth(topK int) int {
	depth := topK * 4
	if depth < minCandidateDepth {
		depth = minCandidateDepth
	}
	return search.NormalizeLimit(depth)
}

// Search runs both engines concurrently and fuses their rankings.
//
// It degrades rather than failing: with no vector service configured, or when
// the vector side errors, the lexical ranking is returned on its own. A search
// endpoint that 503s because an optional index is missing is worse than one
// that returns the results it does have — and the caller can see which engines
// contributed from the per-engine ranks. Only a failure of *every* engine is
// an error.
func Search(ctx context.Context, s search.Searcher, v *vectorstore.Service, query string, opts Options) ([]Result, error) {
	topK := opts.TopK
	if topK <= 0 {
		topK = DefaultTopK
	}
	depth := opts.CandidateDepth
	if depth <= 0 {
		depth = CandidateDepth(topK)
	}

	var (
		ftsResults []search.Result
		vecResults []vectorstore.Result
		ftsErr     error
		vecErr     error
	)

	// Each goroutine stores its own error instead of returning it: errgroup
	// would cancel the sibling, and a working lexical search should not be
	// thrown away because the embedding provider timed out.
	var g errgroup.Group
	g.Go(func() error {
		ftsResults, ftsErr = lexical(ctx, s, query, depth, opts)
		return nil
	})
	if v != nil {
		g.Go(func() error {
			vecResults, vecErr = semantic(ctx, v, query, depth, opts)
			return nil
		})
	}
	_ = g.Wait()

	if ftsErr != nil {
		if v == nil || vecErr != nil {
			return nil, ftsErr
		}
		log.Printf("hybrid: lexical search failed, returning semantic only: %v", ftsErr)
	}
	if vecErr != nil {
		log.Printf("hybrid: semantic search failed, returning lexical only: %v", vecErr)
	}

	ftsPaths := make([]string, 0, len(ftsResults))
	byPath := make(map[string]search.Result, len(ftsResults))
	for _, r := range ftsResults {
		if _, seen := byPath[r.Path]; seen {
			continue
		}
		byPath[r.Path] = r
		ftsPaths = append(ftsPaths, r.Path)
	}
	vecPaths := make([]string, 0, len(vecResults))
	vecByPath := make(map[string]vectorstore.Result, len(vecResults))
	for _, r := range vecResults {
		if _, seen := vecByPath[r.Path]; seen {
			continue
		}
		vecByPath[r.Path] = r
		vecPaths = append(vecPaths, r.Path)
	}

	fused := search.RRF([][]string{ftsPaths, vecPaths}, opts.K)
	if len(fused) > topK {
		fused = fused[:topK]
	}

	out := make([]Result, 0, len(fused))
	for _, f := range fused {
		res := Result{
			Path:         f.Path,
			Score:        f.Score,
			FTSRank:      f.Ranks[0],
			SemanticRank: f.Ranks[1],
		}
		if fr, ok := byPath[f.Path]; ok {
			res.Snippet = fr.Snippet
			res.Matches = fr.Matches
		}
		// A semantic-only hit has no lexical snippet — the query terms are not
		// in the document, which is the point. Fall back to the chunk text.
		if res.Snippet == "" {
			if vr, ok := vecByPath[f.Path]; ok {
				res.Snippet = vr.Snippet
			}
		}
		out = append(out, res)
	}
	return out, nil
}

func lexical(ctx context.Context, s search.Searcher, query string, depth int, opts Options) ([]search.Result, error) {
	if s == nil {
		return nil, nil
	}
	sopts := search.SearchOptions{ExcludePrefixes: opts.ExcludePrefixes}
	if bos, ok := s.(search.BoostedOptionsSearcher); ok && opts.Boost {
		return bos.SearchBoostedWithOptions(ctx, query, depth, 0, opts.PathPrefix, sopts)
	}
	if os, ok := s.(search.OptionsSearcher); ok {
		return os.SearchWithOptions(ctx, query, depth, 0, opts.PathPrefix, sopts)
	}
	var (
		results []search.Result
		err     error
	)
	if ts, ok := s.(search.TrustSearcher); ok && opts.Boost {
		results, err = ts.SearchBoosted(ctx, query, depth, 0, opts.PathPrefix)
	} else {
		results, err = s.Search(ctx, query, depth, 0, opts.PathPrefix)
	}
	if err != nil || len(opts.ExcludePrefixes) == 0 {
		return results, err
	}
	// Backend without SQL-level exclusion (grep): filter what came back. The
	// list is already at the engine ceiling, so nothing deeper exists to
	// backfill from.
	kept := results[:0]
	for _, r := range results {
		if !hasAnyPrefix(r.Path, opts.ExcludePrefixes) {
			kept = append(kept, r)
		}
	}
	return kept, nil
}

func semantic(ctx context.Context, v *vectorstore.Service, query string, depth int, opts Options) ([]vectorstore.Result, error) {
	keep := func(path string) bool {
		if hasAnyPrefix(path, opts.ExcludePrefixes) {
			return false
		}
		if opts.PathPrefix != "" && !hasPrefix(path, opts.PathPrefix) {
			return false
		}
		return true
	}
	return v.SearchFiltered(ctx, query, depth, keep)
}

func hasAnyPrefix(path string, prefixes []string) bool {
	for _, p := range prefixes {
		if p != "" && hasPrefix(path, p) {
			return true
		}
	}
	return false
}

func hasPrefix(s, prefix string) bool {
	return len(s) >= len(prefix) && s[:len(prefix)] == prefix
}

// Paths extracts the ranked paths, for callers that only need the ordering.
func Paths(results []Result) []string {
	out := make([]string, len(results))
	for i, r := range results {
		out[i] = r.Path
	}
	return out
}
