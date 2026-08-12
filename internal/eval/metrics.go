package eval

import (
	"math"
	"sort"
)

// Metrics are the standard rank-based retrieval measures, macro-averaged over
// the queries in a run (each query contributes equally regardless of how many
// relevant documents it has).
type Metrics struct {
	HitRate float64 `json:"hit_rate" example:"0.8"`
	MRR     float64 `json:"mrr" example:"0.75"`
	// PrecisionAtK divides by K, not by the number of results returned. A run
	// that returns 2 results, both relevant, scores 0.4 at K=5 — retrieving
	// too little is a real failure and the metric has to say so.
	PrecisionAtK float64 `json:"precision_at_k" example:"0.6"`
	// PrecisionAt5 is a deprecated alias kept so existing callers of the eval
	// endpoint keep parsing. It carries the same value as PrecisionAtK.
	PrecisionAt5 float64 `json:"precision_at_5" example:"0.6"`
	NDCG         float64 `json:"ndcg" example:"0.71"`
	// Queries is how many queries were scored. Queries whose entire relevant
	// set was excluded are dropped before scoring, so this can be lower than
	// the size of the golden set.
	Queries int `json:"queries" example:"3"`
}

// QueryScore is the per-query breakdown behind Metrics. Averages hide which
// query regressed, and a retrieval change is only actionable if you can see
// that.
type QueryScore struct {
	// Rank is the 1-based position of the first relevant result, or 0 for a miss.
	Rank         int      `json:"rank" example:"1"`
	Hits         []string `json:"hits"`
	Retrieved    []string `json:"retrieved"`
	PrecisionAtK float64  `json:"precision_at_k" example:"0.4"`
	NDCG         float64  `json:"ndcg" example:"0.63"`
	// Error is set when this engine failed on this query. The query is then
	// scored as a miss rather than dropped, because silently shrinking the
	// denominator would make a broken engine look good.
	Error string `json:"error,omitempty"`
}

// Score evaluates one ranked list of paths against a query's judgements.
// The list must already be deduped by path and truncated to at most topK.
func Score(ranked []string, relevant map[string]int, topK int) QueryScore {
	if topK <= 0 {
		topK = DefaultTopK
	}
	qs := QueryScore{Hits: []string{}, Retrieved: []string{}}
	if len(ranked) > topK {
		ranked = ranked[:topK]
	}
	qs.Retrieved = append(qs.Retrieved, ranked...)

	relCount := 0
	dcg := 0.0
	for i, path := range ranked {
		grade := relevant[path]
		if grade <= 0 {
			continue
		}
		qs.Hits = append(qs.Hits, path)
		relCount++
		if qs.Rank == 0 {
			qs.Rank = i + 1
		}
		dcg += gain(grade) / math.Log2(float64(i+2))
	}
	qs.PrecisionAtK = float64(relCount) / float64(topK)
	qs.NDCG = dcg / idealDCG(relevant, topK)
	return qs
}

// gain is the exponential gain 2^rel - 1 used by the standard nDCG formulation
// (Järvelin & Kekäläinen, and what trec_eval's ndcg reports).
func gain(grade int) float64 {
	return math.Pow(2, float64(grade)) - 1
}

// idealDCG is the DCG of the best possible ranking of the judged-relevant set,
// truncated at topK. Returns 1 when there is nothing relevant so callers get
// nDCG 0 instead of NaN — though Runner drops such queries before scoring.
func idealDCG(relevant map[string]int, topK int) float64 {
	grades := make([]int, 0, len(relevant))
	for _, g := range relevant {
		if g > 0 {
			grades = append(grades, g)
		}
	}
	if len(grades) == 0 {
		return 1
	}
	sort.Sort(sort.Reverse(sort.IntSlice(grades)))
	if len(grades) > topK {
		grades = grades[:topK]
	}
	idcg := 0.0
	for i, g := range grades {
		idcg += gain(g) / math.Log2(float64(i+2))
	}
	return idcg
}

// aggregate macro-averages per-query scores.
func aggregate(scores []QueryScore) Metrics {
	m := Metrics{Queries: len(scores)}
	if len(scores) == 0 {
		return m
	}
	var hits, rr, prec, ndcg float64
	for _, s := range scores {
		if s.Rank > 0 {
			hits++
			rr += 1 / float64(s.Rank)
		}
		prec += s.PrecisionAtK
		ndcg += s.NDCG
	}
	n := float64(len(scores))
	m.HitRate = hits / n
	m.MRR = rr / n
	m.PrecisionAtK = prec / n
	m.PrecisionAt5 = m.PrecisionAtK
	m.NDCG = ndcg / n
	return m
}
