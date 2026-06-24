package search

import (
	"context"
	"encoding/json"
	"sort"
	"strings"
	"sync"

	"golang.org/x/sync/errgroup"
)

const DefaultRRFK = 60

// Recall source identifiers used in fusion and API responses.
const (
	SourceFTS    = "fts"
	SourceVector = "vector"
	SourceGraph  = "graph"
)

// MetaReader loads frontmatter for a set of paths (used for title/confidence boosts).
type MetaReader interface {
	FrontmatterForPaths(ctx context.Context, paths []string) (map[string]map[string]any, error)
}

// RecallOptions configures a fused recall query.
type RecallOptions struct {
	Query         string
	Limit         int
	Sources       []string
	Scope         string
	BoostVerified bool
	K             int
	PathPrefix    string
}

// RecallResult is a single fused recall hit with per-source provenance.
type RecallResult struct {
	Path       string   `json:"path"`
	Title      string   `json:"title,omitempty"`
	Snippet    string   `json:"snippet,omitempty"`
	Score      float64  `json:"score"`
	Sources    []string `json:"sources"`
	FTSRank    int      `json:"fts_rank,omitempty"`
	VectorRank int      `json:"vector_rank,omitempty"`
	GraphRank  int      `json:"graph_rank,omitempty"`
}

// RankedHit is one entry in a ranked list before fusion.
type RankedHit struct {
	Path    string
	Snippet string
	Title   string
}

// RankedList is a ranked result list from one retrieval source.
type RankedList struct {
	Source string
	Hits   []RankedHit
}

// VectorSearcher performs semantic search. nil/disabled implementations are skipped.
type VectorSearcher interface {
	Search(ctx context.Context, query string, topK int) ([]VectorHit, error)
}

// VectorHit is a semantic search result used by recall fusion.
type VectorHit struct {
	Path    string
	Snippet string
	Score   float64
}

// BacklinkFinder resolves 1-hop backlinks for graph signal expansion.
type BacklinkFinder interface {
	Backlinks(ctx context.Context, path string) ([]BacklinkHit, error)
}

// BacklinkHit is a page that links to a seed result.
type BacklinkHit struct {
	Path string
}

// Recaller fuses FTS, vector, and graph retrieval signals with RRF.
type Recaller struct {
	Searcher Searcher
	Vectors  VectorSearcher
	Linker   BacklinkFinder
	Meta     MetaReader
}

// Recall runs parallel retrieval and merges results with Reciprocal Rank Fusion.
func (r *Recaller) Recall(ctx context.Context, opts RecallOptions) ([]RecallResult, error) {
	if strings.TrimSpace(opts.Query) == "" {
		return nil, nil
	}
	limit := NormalizeLimit(opts.Limit)
	if limit <= 0 {
		limit = 10
	}
	k := opts.K
	if k <= 0 {
		k = DefaultRRFK
	}
	sources := normalizeRecallSources(opts.Sources)
	fetchLimit := limit * 3
	if fetchLimit < 30 {
		fetchLimit = 30
	}
	if fetchLimit > maxSearchLimit {
		fetchLimit = maxSearchLimit
	}

	searchOpts := SearchOptions{Scope: opts.Scope}
	var lists []RankedList
	var mu sync.Mutex
	eg, ctx := errgroup.WithContext(ctx)

	if containsSource(sources, SourceFTS) && r.Searcher != nil {
		eg.Go(func() error {
			var (
				results []Result
				err     error
			)
			if opts.Scope != "" || searchOpts.Scope != "" {
				if os, ok := r.Searcher.(OptionsSearcher); ok {
					results, err = os.SearchWithOptions(ctx, opts.Query, fetchLimit, 0, opts.PathPrefix, searchOpts)
				} else {
					results, err = r.Searcher.Search(ctx, opts.Query, fetchLimit, 0, opts.PathPrefix)
					if err == nil {
						results = filterResultsByScope(ctx, r.Searcher, results, opts.Scope)
					}
				}
			} else {
				results, err = r.Searcher.Search(ctx, opts.Query, fetchLimit, 0, opts.PathPrefix)
			}
			if err != nil {
				return err
			}
			hits := make([]RankedHit, len(results))
			for i, res := range results {
				hits[i] = RankedHit{Path: res.Path, Snippet: res.Snippet}
			}
			mu.Lock()
			lists = append(lists, RankedList{Source: SourceFTS, Hits: hits})
			mu.Unlock()
			return nil
		})
	}

	if containsSource(sources, SourceVector) && r.Vectors != nil {
		eg.Go(func() error {
			results, err := r.Vectors.Search(ctx, opts.Query, fetchLimit)
			if err != nil {
				return err
			}
			if opts.Scope != "" {
				results = filterVectorHitsByScope(ctx, r.Searcher, results, opts.Scope)
			}
			hits := make([]RankedHit, len(results))
			for i, res := range results {
				hits[i] = RankedHit{Path: res.Path, Snippet: res.Snippet}
			}
			mu.Lock()
			lists = append(lists, RankedList{Source: SourceVector, Hits: hits})
			mu.Unlock()
			return nil
		})
	}

	if err := eg.Wait(); err != nil {
		return nil, err
	}

	if containsSource(sources, SourceGraph) && r.Linker != nil {
		seeds := seedPaths(lists, 10)
		graphHits := graphBacklinkHits(ctx, r.Linker, seeds, fetchLimit)
		if len(graphHits) > 0 {
			lists = append(lists, RankedList{Source: SourceGraph, Hits: graphHits})
		}
	}

	fused := FuseRRF(lists, k)
	if len(fused) == 0 {
		return []RecallResult{}, nil
	}

	paths := make([]string, 0, len(fused))
	for path := range fused {
		paths = append(paths, path)
	}
	sort.Strings(paths)

	meta := map[string]map[string]any{}
	if r.Meta != nil {
		if m, err := r.Meta.FrontmatterForPaths(ctx, paths); err == nil {
			meta = m
		}
	}

	out := make([]RecallResult, 0, len(fused))
	for _, path := range paths {
		entry := fused[path]
		title := entry.title
		if title == "" {
			title = titleFromFrontmatter(meta[path])
		}
		score := entry.score
		if opts.BoostVerified {
			score *= confidenceBoost(meta[path])
		}
		sourcesHit := sourceNames(entry.ranks)
		result := RecallResult{
			Path:    path,
			Title:   title,
			Snippet: entry.snippet,
			Score:   score,
			Sources: sourcesHit,
		}
		if rank, ok := entry.ranks[SourceFTS]; ok {
			result.FTSRank = rank
		}
		if rank, ok := entry.ranks[SourceVector]; ok {
			result.VectorRank = rank
		}
		if rank, ok := entry.ranks[SourceGraph]; ok {
			result.GraphRank = rank
		}
		out = append(out, result)
	}

	sort.Slice(out, func(i, j int) bool {
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		return out[i].Path < out[j].Path
	})
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

type recallEntry struct {
	score   float64
	ranks   map[string]int
	snippet string
	title   string
}

// FuseRRF merges ranked lists using Reciprocal Rank Fusion: score = Σ 1/(k + rank).
func FuseRRF(lists []RankedList, k int) map[string]*recallEntry {
	if k <= 0 {
		k = DefaultRRFK
	}
	out := map[string]*recallEntry{}
	for _, list := range lists {
		for i, hit := range list.Hits {
			if hit.Path == "" {
				continue
			}
			rank := i + 1
			entry, ok := out[hit.Path]
			if !ok {
				entry = &recallEntry{ranks: map[string]int{}}
				out[hit.Path] = entry
			}
			entry.score += 1.0 / (float64(k) + float64(rank))
			entry.ranks[list.Source] = rank
			if entry.snippet == "" && hit.Snippet != "" {
				entry.snippet = hit.Snippet
			}
			if entry.title == "" && hit.Title != "" {
				entry.title = hit.Title
			}
		}
	}
	return out
}

func normalizeRecallSources(sources []string) []string {
	if len(sources) == 0 {
		return []string{SourceFTS, SourceVector, SourceGraph}
	}
	out := make([]string, 0, len(sources))
	seen := map[string]bool{}
	for _, s := range sources {
		s = strings.ToLower(strings.TrimSpace(s))
		switch s {
		case SourceFTS, SourceVector, SourceGraph:
			if !seen[s] {
				seen[s] = true
				out = append(out, s)
			}
		}
	}
	if len(out) == 0 {
		return []string{SourceFTS, SourceVector, SourceGraph}
	}
	return out
}

func containsSource(sources []string, source string) bool {
	for _, s := range sources {
		if s == source {
			return true
		}
	}
	return false
}

func seedPaths(lists []RankedList, max int) []string {
	seen := map[string]bool{}
	out := make([]string, 0, max)
	for _, list := range lists {
		if list.Source != SourceFTS && list.Source != SourceVector {
			continue
		}
		for _, hit := range list.Hits {
			if hit.Path == "" || seen[hit.Path] {
				continue
			}
			seen[hit.Path] = true
			out = append(out, hit.Path)
			if len(out) >= max {
				return out
			}
		}
	}
	return out
}

func graphBacklinkHits(ctx context.Context, linker BacklinkFinder, seeds []string, limit int) []RankedHit {
	type scored struct {
		path  string
		score int
	}
	counts := map[string]int{}
	for _, seed := range seeds {
		links, err := linker.Backlinks(ctx, seed)
		if err != nil {
			continue
		}
		for _, link := range links {
			if link.Path == "" || link.Path == seed {
				continue
			}
			counts[link.Path]++
		}
	}
	if len(counts) == 0 {
		return nil
	}
	ranked := make([]scored, 0, len(counts))
	for path, score := range counts {
		ranked = append(ranked, scored{path: path, score: score})
	}
	sort.Slice(ranked, func(i, j int) bool {
		if ranked[i].score != ranked[j].score {
			return ranked[i].score > ranked[j].score
		}
		return ranked[i].path < ranked[j].path
	})
	if limit > 0 && len(ranked) > limit {
		ranked = ranked[:limit]
	}
	out := make([]RankedHit, len(ranked))
	for i, item := range ranked {
		out[i] = RankedHit{Path: item.path}
	}
	return out
}

func filterResultsByScope(ctx context.Context, searcher Searcher, results []Result, scope string) []Result {
	if scope == "" || len(results) == 0 {
		return results
	}
	sf, ok := searcher.(ScopeFilterer)
	if !ok {
		return results
	}
	paths := make([]string, len(results))
	for i, res := range results {
		paths[i] = res.Path
	}
	kept, err := sf.FilterByScope(ctx, paths, scope)
	if err != nil {
		return results
	}
	keep := map[string]bool{}
	for _, path := range kept {
		keep[path] = true
	}
	filtered := results[:0]
	for _, res := range results {
		if keep[res.Path] {
			filtered = append(filtered, res)
		}
	}
	return filtered
}

func filterVectorHitsByScope(ctx context.Context, searcher Searcher, hits []VectorHit, scope string) []VectorHit {
	if scope == "" || len(hits) == 0 {
		return hits
	}
	sf, ok := searcher.(ScopeFilterer)
	if !ok {
		return hits
	}
	paths := make([]string, len(hits))
	for i, hit := range hits {
		paths[i] = hit.Path
	}
	kept, err := sf.FilterByScope(ctx, paths, scope)
	if err != nil {
		return hits
	}
	keep := map[string]bool{}
	for _, path := range kept {
		keep[path] = true
	}
	filtered := hits[:0]
	for _, hit := range hits {
		if keep[hit.Path] {
			filtered = append(filtered, hit)
		}
	}
	return filtered
}

func sourceNames(ranks map[string]int) []string {
	out := make([]string, 0, len(ranks))
	for source := range ranks {
		out = append(out, source)
	}
	sort.Strings(out)
	return out
}

func titleFromFrontmatter(fm map[string]any) string {
	if fm == nil {
		return ""
	}
	if title, ok := fm["title"].(string); ok {
		return title
	}
	return ""
}

func confidenceBoost(fm map[string]any) float64 {
	if fm == nil {
		return 1.0
	}
	conf, ok := fm["confidence"]
	if !ok {
		return 1.0
	}
	var cv float64
	switch v := conf.(type) {
	case float64:
		cv = v
	case int:
		cv = float64(v)
	case json.Number:
		f, _ := v.Float64()
		cv = f
	}
	if cv > 0 && cv <= 1 {
		return cv
	}
	return 1.0
}
