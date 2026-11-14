package hybrid

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"

	"github.com/kiwifs/kiwifs/internal/links"
	"github.com/kiwifs/kiwifs/internal/search"
	"github.com/kiwifs/kiwifs/internal/vectorstore"
)

// Retrieval signals Recall can fuse.
const (
	SourceFTS    = "fts"
	SourceVector = "vector"
	SourceGraph  = "graph"
)

// AllSources is the default signal set, in the order results report them.
var AllSources = []string{SourceFTS, SourceVector, SourceGraph}

// ErrNoVectorIndex is returned when only the vector signal is requested and
// no vector index is configured.
var ErrNoVectorIndex = errors.New("the vector source was requested but no vector index is configured")

// DefaultRecallTopK is the number of results Recall returns when TopK is unset.
const DefaultRecallTopK = 10

// graphSeeds is how many of the best lexical/semantic hits the graph signal
// expands from. Pages linking to the top of the ranking are evidence; pages
// linking to the fiftieth hit are mostly noise.
const graphSeeds = 10

// Backlinker is the part of links.Linker the graph signal needs.
type Backlinker interface {
	Backlinks(ctx context.Context, target string) ([]links.Entry, error)
}

// RecallOptions tune one Recall.
type RecallOptions struct {
	// TopK is how many fused results to return.
	TopK int
	// K is the RRF rank constant. Zero uses search.DefaultRRFK.
	K float64
	// Sources picks which signals to fuse; nil means all of them. Recall
	// rejects anything ParseSources rejects.
	Sources []string
	// Scope restricts results to pages whose frontmatter scope matches.
	Scope string
	// PathPrefix restricts results to one subtree.
	PathPrefix string
	// BoostVerified multiplies each fused score by (1 + confidence) for pages
	// whose frontmatter carries a numeric confidence in (0, 1].
	BoostVerified bool
}

// RecallResult is one fused hit with its provenance.
type RecallResult struct {
	Path string `json:"path"`
	// Score is the RRF score, after the confidence boost when requested.
	// Comparable within one response only.
	Score float64 `json:"score"`
	// Sources names the signals that ranked this page.
	Sources []string `json:"sources"`
	// FTSRank, VectorRank and GraphRank are 1-based; 0 means that signal did
	// not rank the path.
	FTSRank    int `json:"fts_rank"`
	VectorRank int `json:"vector_rank"`
	GraphRank  int `json:"graph_rank"`
	// LinksTo lists the top lexical/semantic hits this page links to — the
	// reason the graph signal ranked it.
	LinksTo []string `json:"links_to,omitempty"`
	// Confidence is the frontmatter confidence applied by BoostVerified.
	Confidence *float64 `json:"confidence,omitempty"`
	Snippet    string   `json:"snippet,omitempty"`
}

// RecallResponse is the fused ranking plus the signals that produced it.
type RecallResponse struct {
	// Engines lists the signals that actually contributed. A requested signal
	// is missing when it is not configured (no vector index, no link index)
	// or when it failed and the others carried the query.
	Engines []string       `json:"engines"`
	Results []RecallResult `json:"results"`
}

// ParseSources validates and normalises a requested signal list. Empty input
// selects every signal. The graph signal expands from lexical and semantic
// hits, so it cannot be requested on its own.
func ParseSources(raw []string) ([]string, error) {
	if len(raw) == 0 {
		return append([]string(nil), AllSources...), nil
	}
	want := make(map[string]bool, len(raw))
	for _, r := range raw {
		src := strings.ToLower(strings.TrimSpace(r))
		switch src {
		case SourceFTS, SourceVector, SourceGraph:
			want[src] = true
		default:
			return nil, fmt.Errorf("invalid source %q: expected fts, vector or graph", r)
		}
	}
	if !want[SourceFTS] && !want[SourceVector] {
		return nil, fmt.Errorf("the graph source expands from fts or vector hits; request at least one of them")
	}
	out := make([]string, 0, len(want))
	for _, src := range AllSources {
		if want[src] {
			out = append(out, src)
		}
	}
	return out, nil
}

// Recall fuses lexical, semantic and link-graph evidence into one ranking
// with Reciprocal Rank Fusion.
//
// The lexical and semantic engines run concurrently, exactly as in Search.
// The graph signal then takes the top graphSeeds pages of their fused
// ranking and ranks every page that links to them, most-connected first:
// a page that cites three of the best hits is likely relevant even when it
// shares no words or embedding neighbourhood with the query.
//
// Like Search it degrades rather than failing: a signal that is not
// configured or errors is left out and reported through Engines.
func Recall(ctx context.Context, s search.Searcher, v *vectorstore.Service, l Backlinker, query string, opts RecallOptions) (*RecallResponse, error) {
	sources, err := ParseSources(opts.Sources)
	if err != nil {
		return nil, err
	}
	want := make(map[string]bool, len(sources))
	for _, src := range sources {
		want[src] = true
	}

	topK := opts.TopK
	if topK <= 0 {
		topK = DefaultRecallTopK
	}
	depth := CandidateDepth(topK)

	if !want[SourceVector] {
		v = nil
	}
	if !want[SourceFTS] && v == nil {
		// Falling back to lexical here would answer a question nobody asked.
		return nil, ErrNoVectorIndex
	}

	c, err := retrieve(ctx, s, v, query, depth, Options{
		PathPrefix: opts.PathPrefix,
		Scope:      opts.Scope,
		Boost:      true,
	}, want[SourceFTS])
	if err != nil {
		return nil, err
	}

	var (
		graphPaths []string
		linksTo    map[string][]string
		graphOK    bool
	)
	if want[SourceGraph] && l != nil {
		seeds := search.RRF([][]string{c.ftsPaths, c.vecPaths}, opts.K)
		if len(seeds) > graphSeeds {
			seeds = seeds[:graphSeeds]
		}
		seedPaths := make([]string, len(seeds))
		for i, sp := range seeds {
			seedPaths[i] = sp.Path
		}
		graphPaths, linksTo, err = expandGraph(ctx, s, l, seedPaths, depth, opts)
		if err != nil {
			log.Printf("hybrid: graph expansion failed, recalling without it: %v", err)
			graphPaths, linksTo = nil, nil
		} else {
			graphOK = true
		}
	}

	fused := search.RRF([][]string{c.ftsPaths, c.vecPaths, graphPaths}, opts.K)

	var confidences map[string]float64
	if opts.BoostVerified && len(fused) > 0 {
		if cr, ok := s.(search.ConfidenceReader); ok {
			paths := make([]string, len(fused))
			for i, f := range fused {
				paths[i] = f.Path
			}
			confidences, err = cr.Confidences(ctx, paths)
			if err != nil {
				return nil, err
			}
			for i := range fused {
				if cv, ok := confidences[fused[i].Path]; ok {
					fused[i].Score *= 1 + cv
				}
			}
			search.SortScored(fused)
		}
	}
	if len(fused) > topK {
		fused = fused[:topK]
	}

	resp := &RecallResponse{Engines: []string{}, Results: make([]RecallResult, 0, len(fused))}
	if c.ftsOK {
		resp.Engines = append(resp.Engines, SourceFTS)
	}
	if c.vecOK {
		resp.Engines = append(resp.Engines, SourceVector)
	}
	if graphOK {
		resp.Engines = append(resp.Engines, SourceGraph)
	}
	for _, f := range fused {
		res := RecallResult{
			Path:       f.Path,
			Score:      f.Score,
			Sources:    []string{},
			FTSRank:    f.Ranks[0],
			VectorRank: f.Ranks[1],
			GraphRank:  f.Ranks[2],
			LinksTo:    linksTo[f.Path],
			Snippet:    c.snippet(f.Path),
		}
		for i, src := range AllSources {
			if f.Ranks[i] > 0 {
				res.Sources = append(res.Sources, src)
			}
		}
		if cv, ok := confidences[f.Path]; ok {
			res.Confidence = &cv
		}
		resp.Results = append(resp.Results, res)
	}
	return resp, nil
}

// expandGraph ranks the pages that link to any seed: more seeds linked first,
// then the best-ranked seed linked, then path. The returned map records which
// seeds each page links to, in seed order.
func expandGraph(ctx context.Context, s search.Searcher, l Backlinker, seeds []string, depth int, opts RecallOptions) ([]string, map[string][]string, error) {
	type neighbour struct {
		path     string
		seeds    []string
		bestSeed int
	}
	byPath := make(map[string]*neighbour)
	for seedIdx, seed := range seeds {
		if err := ctx.Err(); err != nil {
			return nil, nil, err
		}
		entries, err := l.Backlinks(ctx, seed)
		if err != nil {
			return nil, nil, err
		}
		for _, e := range entries {
			if e.Path == "" || e.Path == seed {
				continue
			}
			if opts.PathPrefix != "" && !hasPrefix(e.Path, opts.PathPrefix) {
				continue
			}
			n := byPath[e.Path]
			if n == nil {
				n = &neighbour{path: e.Path, bestSeed: seedIdx}
				byPath[e.Path] = n
			}
			// Backlinks reports one entry per relation, so the same source
			// can appear twice for one seed.
			if len(n.seeds) == 0 || n.seeds[len(n.seeds)-1] != seed {
				n.seeds = append(n.seeds, seed)
			}
		}
	}

	ranked := make([]*neighbour, 0, len(byPath))
	for _, n := range byPath {
		ranked = append(ranked, n)
	}

	if opts.Scope != "" && len(ranked) > 0 {
		paths := make([]string, len(ranked))
		for i, n := range ranked {
			paths[i] = n.path
		}
		in, err := inScope(ctx, s, paths, opts.Scope)
		if err != nil {
			return nil, nil, err
		}
		filtered := ranked[:0]
		for _, n := range ranked {
			if in[n.path] {
				filtered = append(filtered, n)
			}
		}
		ranked = filtered
	}

	sort.Slice(ranked, func(i, j int) bool {
		if len(ranked[i].seeds) != len(ranked[j].seeds) {
			return len(ranked[i].seeds) > len(ranked[j].seeds)
		}
		if ranked[i].bestSeed != ranked[j].bestSeed {
			return ranked[i].bestSeed < ranked[j].bestSeed
		}
		return ranked[i].path < ranked[j].path
	})
	if len(ranked) > depth {
		ranked = ranked[:depth]
	}

	paths := make([]string, len(ranked))
	linksTo := make(map[string][]string, len(ranked))
	for i, n := range ranked {
		paths[i] = n.path
		linksTo[n.path] = n.seeds
	}
	return paths, linksTo, nil
}
