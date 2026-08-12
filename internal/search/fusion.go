package search

import "sort"

// DefaultRRFK is the rank constant from Cormack, Clarke & Buettcher (SIGIR
// 2009), "Reciprocal Rank Fusion outperforms Condorcet and individual Rank
// Learning Methods". They report k = 60 as effective across their runs without
// per-collection tuning, which is the property that matters here: a knowledge
// base has no held-out set to tune against until someone builds one.
//
// k damps the influence of the very top ranks. Small k lets a single list's
// first result dominate; large k flattens the curve until fusion approaches a
// plain vote count.
const DefaultRRFK = 60

// ScoredPath is one fused result.
type ScoredPath struct {
	Path string `json:"path"`
	// Score is the sum of 1/(k + rank) across the lists containing this path.
	// It is only meaningful relative to the other scores in the same fusion —
	// it is not a probability and not comparable across queries.
	Score float64 `json:"score"`
	// Ranks holds the 1-based rank of this path in each input list, parallel
	// to the lists passed to RRF. Zero means the list did not contain it.
	// Callers map positions back to engine names; opacity about which engine
	// found a result is useless to anyone debugging retrieval.
	Ranks []int `json:"ranks"`
}

// RRF fuses ranked lists of paths by Reciprocal Rank Fusion:
//
//	score(d) = Σ_lists 1 / (k + rank_list(d))
//
// Lists need not be the same length, need not overlap, and may be empty.
// Comparable scores are not required — that is the point of RRF: it consumes
// only the ordering, so a BM25 score and a cosine similarity can be combined
// without calibrating either.
//
// Input lists must already be deduped. Vector search returns per-chunk hits
// while FTS returns per-document ones, so the caller collapses chunks to their
// best-scoring path before fusing; a path appearing twice in one list would
// otherwise be scored twice for the same evidence. If it happens anyway, only
// the best (first) rank counts.
//
// k <= 0 falls back to DefaultRRFK. Results are sorted by score descending,
// ties broken by best rank then by path, so output is deterministic.
func RRF(lists [][]string, k float64) []ScoredPath {
	if k <= 0 {
		k = DefaultRRFK
	}
	type acc struct {
		score float64
		ranks []int
		order int
	}
	byPath := make(map[string]*acc)
	var order int
	for listIdx, list := range lists {
		for i, path := range list {
			if path == "" {
				continue
			}
			a := byPath[path]
			if a == nil {
				a = &acc{ranks: make([]int, len(lists)), order: order}
				order++
				byPath[path] = a
			}
			if a.ranks[listIdx] != 0 {
				// Already seen in this list; the better rank stands.
				continue
			}
			rank := i + 1
			a.ranks[listIdx] = rank
			a.score += 1 / (k + float64(rank))
		}
	}

	out := make([]ScoredPath, 0, len(byPath))
	for path, a := range byPath {
		out = append(out, ScoredPath{Path: path, Score: a.score, Ranks: a.ranks})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		bi, bj := bestRank(out[i].Ranks), bestRank(out[j].Ranks)
		if bi != bj {
			return bi < bj
		}
		return out[i].Path < out[j].Path
	})
	return out
}

// bestRank is the smallest non-zero rank, or a large sentinel when the path
// appears in no list (which RRF never produces, but keeps the comparator total).
func bestRank(ranks []int) int {
	best := 1 << 30
	for _, r := range ranks {
		if r != 0 && r < best {
			best = r
		}
	}
	return best
}
