package api

import (
	"encoding/json"
	"net/http"

	"github.com/kiwifs/kiwifs/internal/eval"
	"github.com/labstack/echo/v4"
)

// stringList accepts either a JSON string or an array of strings, so
// `"exclude_prefix": "competitions/x/"` and
// `"exclude_prefix": ["competitions/x/", "sources/writeups/"]` both work.
// The single-prefix form is the one people reach for first; rejecting it would
// only produce a 400 that teaches nothing.
type stringList []string

func (s *stringList) UnmarshalJSON(data []byte) error {
	var one string
	if err := json.Unmarshal(data, &one); err == nil {
		if one == "" {
			*s = nil
		} else {
			*s = stringList{one}
		}
		return nil
	}
	var many []string
	if err := json.Unmarshal(data, &many); err != nil {
		return err
	}
	*s = many
	return nil
}

type evalRequest struct {
	// Set names a golden set under .kiwi/eval/. Mutually exclusive with Queries.
	Set     string      `json:"set" example:"leave-one-out"`
	Queries []evalQuery `json:"queries"`
	// ExcludePrefix hides path subtrees from retrieval before ranking. A
	// string or an array of strings.
	ExcludePrefix stringList `json:"exclude_prefix" swaggertype:"array,string" example:"competitions/playground-series-s5e4/"`
	TopK          int        `json:"top_k" example:"5"`
}

type evalQuery struct {
	Question      string   `json:"question" example:"how to install kiwifs?"`
	ExpectedPaths []string `json:"expected_paths" example:"/docs/install.md"`
	// Grades optionally assigns graded relevance per path (TREC style, higher
	// is better). Paths listed in ExpectedPaths but absent here get grade 1.
	// Only nDCG distinguishes the grades.
	Grades map[string]int `json:"grades,omitempty"`
}

type evalMetrics struct {
	HitRate      float64 `json:"hit_rate" example:"0.8"`
	MRR          float64 `json:"mrr" example:"0.75"`
	PrecisionAtK float64 `json:"precision_at_k" example:"0.6"`
	// Deprecated: use precision_at_k. Retained so existing clients keep
	// parsing now that top_k is configurable.
	PrecisionAt5 float64 `json:"precision_at_5" example:"0.6"`
	NDCG         float64 `json:"ndcg" example:"0.71"`
	Queries      int     `json:"queries" example:"3"`
}

type evalQueryResult struct {
	Question     string   `json:"question" example:"how to install kiwifs?"`
	FTSRank      int      `json:"fts_rank" example:"1"`
	SemanticRank int      `json:"semantic_rank" example:"2"`
	FTSHits      []string `json:"fts_hits" example:"/docs/install.md"`
	SemanticHits []string `json:"semantic_hits" example:"/docs/install.md"`
	FTSNDCG      float64  `json:"fts_ndcg" example:"1"`
	SemanticNDCG float64  `json:"semantic_ndcg" example:"0.63"`
	Relevant     []string `json:"relevant"`
}

type evalSkipped struct {
	Question string `json:"question"`
	Reason   string `json:"reason"`
}

type evalResponse struct {
	TopK          int               `json:"top_k" example:"5"`
	ExcludePrefix []string          `json:"exclude_prefix,omitempty"`
	FTS           evalMetrics       `json:"fts"`
	Semantic      evalMetrics       `json:"semantic"`
	PerQuery      []evalQueryResult `json:"per_query"`
	Skipped       []evalSkipped     `json:"skipped,omitempty"`
	Errors        int               `json:"errors" example:"0"`
}

// Eval godoc
//
//	@Summary		Evaluate search performance
//	@Description	Runs search queries using both FTS5 and semantic search engines and measures Hit Rate, MRR, Precision@K and nDCG@K against expected page paths. Queries come either inline or from a golden set under .kiwi/eval/. exclude_prefix hides subtrees before ranking, which is what makes leave-one-out evaluation honest.
//	@Tags			eval
//	@Security		BearerAuth
//	@Accept			json
//	@Produce		json
//	@Param			body	body		evalRequest	true	"Evaluation request: a golden set name or inline questions with expected paths"
//	@Success		200		{object}	evalResponse
//	@Failure		400		{object}	map[string]string
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/eval [post]
func (h *Handlers) Eval(c echo.Context) error {
	var req evalRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}

	queries, err := eval.Resolve(h.root, eval.Request{Set: req.Set, Queries: inlineQueries(req.Queries)})
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	engines := eval.DefaultEngines(h.searcher, h.vectors)
	report, err := eval.Run(c.Request().Context(), queries, engines, eval.Options{
		TopK:            req.TopK,
		ExcludePrefixes: req.ExcludePrefix,
	})
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	if report.Errors > 0 && report.Errors == len(report.Queries)*len(engines) {
		return echo.NewHTTPError(http.StatusInternalServerError, "all search queries failed")
	}
	return c.JSON(http.StatusOK, buildEvalResponse(report))
}

func inlineQueries(in []evalQuery) []eval.Query {
	if len(in) == 0 {
		return nil
	}
	out := make([]eval.Query, 0, len(in))
	for _, q := range in {
		relevant := make(map[string]int, len(q.ExpectedPaths)+len(q.Grades))
		for _, p := range q.ExpectedPaths {
			relevant[p] = 1
		}
		for p, g := range q.Grades {
			relevant[p] = g
		}
		out = append(out, eval.Query{Question: q.Question, Relevant: relevant})
	}
	return out
}

func buildEvalResponse(report *eval.Report) evalResponse {
	resp := evalResponse{
		TopK:          report.TopK,
		ExcludePrefix: report.ExcludePrefixes,
		FTS:           toEvalMetrics(report.Metrics(eval.EngineFTS)),
		Semantic:      toEvalMetrics(report.Metrics(eval.EngineSemantic)),
		PerQuery:      make([]evalQueryResult, 0, len(report.Queries)),
		Errors:        report.Errors,
	}
	for _, q := range report.Queries {
		fts := q.Scores[eval.EngineFTS]
		sem := q.Scores[eval.EngineSemantic]
		resp.PerQuery = append(resp.PerQuery, evalQueryResult{
			Question:     q.Question,
			Relevant:     q.Relevant,
			FTSRank:      fts.Rank,
			SemanticRank: sem.Rank,
			FTSHits:      orEmpty(fts.Hits),
			SemanticHits: orEmpty(sem.Hits),
			FTSNDCG:      fts.NDCG,
			SemanticNDCG: sem.NDCG,
		})
	}
	for _, s := range report.Skipped {
		resp.Skipped = append(resp.Skipped, evalSkipped{Question: s.Question, Reason: s.Reason})
	}
	return resp
}

func toEvalMetrics(m eval.Metrics) evalMetrics {
	return evalMetrics{
		HitRate:      m.HitRate,
		MRR:          m.MRR,
		PrecisionAtK: m.PrecisionAtK,
		PrecisionAt5: m.PrecisionAtK,
		NDCG:         m.NDCG,
		Queries:      m.Queries,
	}
}

func orEmpty(in []string) []string {
	if in == nil {
		return []string{}
	}
	return in
}
