package api

import (
	"log"
	"net/http"

	"github.com/labstack/echo/v4"
)

type evalRequest struct {
	Queries []evalQuery `json:"queries"`
}

type evalQuery struct {
	Question      string   `json:"question" example:"how to install kiwifs?"`
	ExpectedPaths []string `json:"expected_paths" example:"/docs/install.md"`
}

type evalMetrics struct {
	HitRate      float64 `json:"hit_rate" example:"0.8"`
	MRR          float64 `json:"mrr" example:"0.75"`
	PrecisionAtK float64 `json:"precision_at_5" example:"0.6"`
}

type evalQueryResult struct {
	Question     string   `json:"question" example:"how to install kiwifs?"`
	FTSRank      int      `json:"fts_rank" example:"1"`
	SemanticRank int      `json:"semantic_rank" example:"2"`
	FTSHits      []string `json:"fts_hits" example:"/docs/install.md"`
	SemanticHits []string `json:"semantic_hits" example:"/docs/install.md"`
}

type evalResponse struct {
	FTS      evalMetrics       `json:"fts"`
	Semantic evalMetrics       `json:"semantic"`
	PerQuery []evalQueryResult `json:"per_query"`
	Errors   int               `json:"errors" example:"0"`
}

// Eval godoc
//
//	@Summary		Evaluate search performance
//	@Description	Runs search queries using both FTS5 and semantic search engines, and measures metrics (Hit Rate, MRR, Precision@5) against expected page paths.
//	@Tags			eval
//	@Security		BearerAuth
//	@Accept			json
//	@Produce		json
//	@Param			body	body		evalRequest	true	"Evaluation request containing questions and expected paths"
//	@Success		200		{object}	evalResponse
//	@Failure		400		{object}	map[string]string
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/eval [post]
func (h *Handlers) Eval(c echo.Context) error {
	var req evalRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}
	if len(req.Queries) == 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "queries is required")
	}

	ctx := c.Request().Context()
	topK := 5

	var ftsHitCount, semHitCount int
	var ftsMRRSum, semMRRSum float64
	var ftsPrecSum, semPrecSum float64
	var errorCount int
	perQuery := make([]evalQueryResult, len(req.Queries))

	for i, q := range req.Queries {
		expected := make(map[string]bool, len(q.ExpectedPaths))
		for _, p := range q.ExpectedPaths {
			expected[p] = true
		}

		pq := evalQueryResult{
			Question:     q.Question,
			FTSHits:      []string{},
			SemanticHits: []string{},
		}

		// FTS
		ftsResults, ftsErr := h.searcher.Search(ctx, q.Question, topK, 0, "")
		if ftsErr != nil {
			log.Printf("eval: FTS search error for %q: %v", q.Question, ftsErr)
			errorCount++
		}
		ftsRank := 0
		ftsPrec := 0
		for j, r := range ftsResults {
			if expected[r.Path] {
				pq.FTSHits = append(pq.FTSHits, r.Path)
				if ftsRank == 0 {
					ftsRank = j + 1
				}
				ftsPrec++
			}
		}
		pq.FTSRank = ftsRank
		if ftsRank > 0 {
			ftsHitCount++
			ftsMRRSum += 1.0 / float64(ftsRank)
		}
		if len(ftsResults) > 0 {
			ftsPrecSum += float64(ftsPrec) / float64(len(ftsResults))
		}

		// Semantic
		if h.vectors != nil {
			semResults, semErr := h.vectors.Search(ctx, q.Question, topK)
			if semErr != nil {
				log.Printf("eval: semantic search error for %q: %v", q.Question, semErr)
				errorCount++
			}
			semRank := 0
			semPrec := 0
			seen := make(map[string]bool)
			for j, r := range semResults {
				if seen[r.Path] {
					continue
				}
				seen[r.Path] = true
				if expected[r.Path] {
					pq.SemanticHits = append(pq.SemanticHits, r.Path)
					if semRank == 0 {
						semRank = j + 1
					}
					semPrec++
				}
			}
			pq.SemanticRank = semRank
			if semRank > 0 {
				semHitCount++
				semMRRSum += 1.0 / float64(semRank)
			}
			if len(semResults) > 0 {
				semPrecSum += float64(semPrec) / float64(len(semResults))
			}
		}

		perQuery[i] = pq
	}

	total := float64(len(req.Queries))
	if total == 0 {
		total = 1
	}

	if errorCount == len(req.Queries)*2 {
		return echo.NewHTTPError(http.StatusInternalServerError, "all search queries failed")
	}

	return c.JSON(http.StatusOK, evalResponse{
		FTS: evalMetrics{
			HitRate:      float64(ftsHitCount) / total,
			MRR:          ftsMRRSum / total,
			PrecisionAtK: ftsPrecSum / total,
		},
		Semantic: evalMetrics{
			HitRate:      float64(semHitCount) / total,
			MRR:          semMRRSum / total,
			PrecisionAtK: semPrecSum / total,
		},
		PerQuery: perQuery,
		Errors:   errorCount,
	})
}
