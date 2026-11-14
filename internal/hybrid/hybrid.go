// Package hybrid combines lexical (FTS5) and semantic (vector) retrieval into
// one ranked list using Reciprocal Rank Fusion. Recall adds a third signal,
// the link graph around the best hits.
//
// It exists as its own package so the REST handlers, the kiwi_search_hybrid
// and kiwi_recall MCP tools and the held-out evaluation in internal/eval all
// run the *same* retrieval. A separate fusion path inside the evaluator would
// measure something the users never get.
package hybrid

import (
	"context"
	"errors"
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
	// Scope restricts results to pages whose frontmatter scope exactly
	// matches. It needs a backend that indexes frontmatter (sqlite); with any
	// other, retrieval fails with ErrScopeUnsupported rather than silently
	// returning out-of-scope pages.
	Scope string
	// Boost applies trust weighting to the lexical side, matching the default
	// behaviour of GET /api/kiwi/search.
	Boost bool
	// CandidateDepth is how deep each engine is asked to rank before fusing.
	// Zero derives it from TopK.
	CandidateDepth int
}

// ErrScopeUnsupported is returned when a scope filter is requested from a
// search backend that does not index frontmatter.
var ErrScopeUnsupported = errors.New("scope search requires sqlite search backend")

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

	c, err := retrieve(ctx, s, v, query, depth, opts, true)
	if err != nil {
		return nil, err
	}

	fused := search.RRF([][]string{c.ftsPaths, c.vecPaths}, opts.K)
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
		if fr, ok := c.fts[f.Path]; ok {
			res.Matches = fr.Matches
		}
		res.Snippet = c.snippet(f.Path)
		out = append(out, res)
	}
	return out, nil
}

// candidates holds the deduped per-engine rankings one query produced.
type candidates struct {
	ftsPaths []string
	fts      map[string]search.Result
	vecPaths []string
	vec      map[string]vectorstore.Result
	// ftsOK and vecOK report whether each engine ran and answered, so callers
	// can say which engines actually contributed.
	ftsOK, vecOK bool
}

// snippet prefers the lexical snippet and falls back to the chunk text: a
// semantic-only hit has no lexical snippet — the query terms are not in the
// document, which is the point.
func (c *candidates) snippet(path string) string {
	if fr, ok := c.fts[path]; ok && fr.Snippet != "" {
		return fr.Snippet
	}
	if vr, ok := c.vec[path]; ok {
		return vr.Snippet
	}
	return ""
}

// retrieve runs the lexical engine (when withFTS) and the vector engine (when
// configured) concurrently and collapses each ranking to one entry per path.
// It fails only when every engine that ran failed.
func retrieve(ctx context.Context, s search.Searcher, v *vectorstore.Service, query string, depth int, opts Options, withFTS bool) (*candidates, error) {
	if opts.Scope != "" {
		if _, ok := s.(search.ScopeFilterer); !ok {
			return nil, ErrScopeUnsupported
		}
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
	if withFTS {
		g.Go(func() error {
			ftsResults, ftsErr = lexical(ctx, s, query, depth, opts)
			return nil
		})
	}
	if v != nil {
		g.Go(func() error {
			vecResults, vecErr = semantic(ctx, s, v, query, depth, opts)
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
		if !withFTS {
			return nil, vecErr
		}
		log.Printf("hybrid: semantic search failed, returning lexical only: %v", vecErr)
	}

	c := &candidates{
		ftsPaths: make([]string, 0, len(ftsResults)),
		fts:      make(map[string]search.Result, len(ftsResults)),
		vecPaths: make([]string, 0, len(vecResults)),
		vec:      make(map[string]vectorstore.Result, len(vecResults)),
		ftsOK:    withFTS && ftsErr == nil,
		vecOK:    v != nil && vecErr == nil,
	}
	for _, r := range ftsResults {
		if _, seen := c.fts[r.Path]; seen {
			continue
		}
		c.fts[r.Path] = r
		c.ftsPaths = append(c.ftsPaths, r.Path)
	}
	for _, r := range vecResults {
		if _, seen := c.vec[r.Path]; seen {
			continue
		}
		c.vec[r.Path] = r
		c.vecPaths = append(c.vecPaths, r.Path)
	}
	return c, nil
}

func lexical(ctx context.Context, s search.Searcher, query string, depth int, opts Options) ([]search.Result, error) {
	if s == nil {
		return nil, nil
	}
	sopts := search.SearchOptions{ExcludePrefixes: opts.ExcludePrefixes, Scope: opts.Scope}
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
	if err != nil || (len(opts.ExcludePrefixes) == 0 && opts.Scope == "") {
		return results, err
	}
	// Backend without SQL-level exclusion (grep): filter what came back. The
	// list is already at the engine ceiling, so nothing deeper exists to
	// backfill from.
	var scoped map[string]bool
	if opts.Scope != "" {
		paths := make([]string, len(results))
		for i, r := range results {
			paths[i] = r.Path
		}
		if scoped, err = inScope(ctx, s, paths, opts.Scope); err != nil {
			return nil, err
		}
	}
	kept := results[:0]
	for _, r := range results {
		if hasAnyPrefix(r.Path, opts.ExcludePrefixes) {
			continue
		}
		if scoped != nil && !scoped[r.Path] {
			continue
		}
		kept = append(kept, r)
	}
	return kept, nil
}

func semantic(ctx context.Context, s search.Searcher, v *vectorstore.Service, query string, depth int, opts Options) ([]vectorstore.Result, error) {
	keep := func(path string) bool {
		if hasAnyPrefix(path, opts.ExcludePrefixes) {
			return false
		}
		if opts.PathPrefix != "" && !hasPrefix(path, opts.PathPrefix) {
			return false
		}
		return true
	}
	if opts.Scope == "" {
		return v.SearchFiltered(ctx, query, depth, keep)
	}
	// The vector index knows nothing about frontmatter, so scope is applied
	// to what comes back. Rank deeper first so the filter leaves something
	// to fuse; the lexical side pushes scope into SQL and needs no headroom.
	results, err := v.SearchFiltered(ctx, query, search.NormalizeLimit(scopedVectorDepth), keep)
	if err != nil {
		return nil, err
	}
	return filterScope(ctx, s, results, opts.Scope)
}

// scopedVectorDepth is how deep the vector side ranks when results must
// then be filtered by frontmatter scope.
const scopedVectorDepth = 200

func filterScope(ctx context.Context, s search.Searcher, results []vectorstore.Result, scope string) ([]vectorstore.Result, error) {
	paths := make([]string, len(results))
	for i, r := range results {
		paths[i] = r.Path
	}
	in, err := inScope(ctx, s, paths, scope)
	if err != nil {
		return nil, err
	}
	out := results[:0]
	for _, r := range results {
		if in[r.Path] {
			out = append(out, r)
		}
	}
	return out, nil
}

// inScope reports which paths carry the given frontmatter scope. The caller
// has already checked that s is a search.ScopeFilterer.
func inScope(ctx context.Context, s search.Searcher, paths []string, scope string) (map[string]bool, error) {
	in := make(map[string]bool, len(paths))
	if len(paths) == 0 {
		return in, nil
	}
	kept, err := s.(search.ScopeFilterer).FilterByScope(ctx, paths, scope)
	if err != nil {
		return nil, err
	}
	for _, p := range kept {
		in[p] = true
	}
	return in, nil
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
