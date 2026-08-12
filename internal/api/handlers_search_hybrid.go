package api

import (
	"net/http"
	"strconv"

	"github.com/kiwifs/kiwifs/internal/config"
	"github.com/kiwifs/kiwifs/internal/hybrid"
	"github.com/kiwifs/kiwifs/internal/search"
	"github.com/kiwifs/kiwifs/internal/tracing"
	"github.com/labstack/echo/v4"
)

type hybridResultEntry struct {
	Path    string         `json:"path"`
	Matches []search.Match `json:"matches,omitempty"`
	// Score is the RRF score. It is comparable within this response only —
	// not across queries, and not to the BM25 scores from mode=fts.
	Score        float64 `json:"score"`
	Snippet      string  `json:"snippet,omitempty"`
	Permalink    string  `json:"permalink,omitempty"`
	FTSRank      int     `json:"fts_rank"`
	SemanticRank int     `json:"semantic_rank"`
}

type hybridSearchResponse struct {
	Query  string `json:"query"`
	Mode   string `json:"mode" example:"hybrid"`
	Limit  int    `json:"limit"`
	Offset int    `json:"offset"`
	// Engines lists which retrieval engines actually contributed. A hybrid
	// request served without the vector index is still a 200, and this is how
	// the caller finds out.
	Engines []string            `json:"engines"`
	RRFK    float64             `json:"rrf_k"`
	Results []hybridResultEntry `json:"results"`
}

// hybridSearch serves GET /api/kiwi/search?mode=hybrid.
//
// It degrades to lexical-only when no vector index is configured rather than
// returning 503: the caller asked for the best available ranking, and the
// engines field says what they got.
func (h *Handlers) hybridSearch(c echo.Context, q string, limit, offset int, pathPrefix string) error {
	rrfK, perr := parseRRFK(c)
	if perr != nil {
		return perr
	}

	ctx := c.Request().Context()
	results, err := hybrid.Search(ctx, h.searcher, h.vectors, q, hybrid.Options{
		TopK:       limit + offset,
		K:          rrfK,
		PathPrefix: pathPrefix,
		Boost:      c.QueryParam("boost") != "none" && c.QueryParam("boost") != "off",
	})
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	if offset >= len(results) {
		results = nil
	} else {
		results = results[offset:]
	}
	if len(results) > limit {
		results = results[:limit]
	}

	engines := []string{"fts"}
	if h.vectors != nil {
		engines = append(engines, "semantic")
	}

	entries := make([]hybridResultEntry, len(results))
	for i, r := range results {
		entries[i] = hybridResultEntry{
			Path:         r.Path,
			Matches:      r.Matches,
			Score:        r.Score,
			Snippet:      r.Snippet,
			Permalink:    config.Permalink(h.publicURL, r.Path),
			FTSRank:      r.FTSRank,
			SemanticRank: r.SemanticRank,
		}
	}

	if recorder, ok := h.searcher.(search.SearchRecorder); ok {
		_ = recorder.RecordSearch(ctx, q, "hybrid", len(entries) > 0)
	}
	tracing.Record(ctx, tracing.Event{Kind: tracing.KindSearch, Query: q, HitCount: len(entries)})

	if rrfK <= 0 {
		rrfK = search.DefaultRRFK
	}
	return c.JSON(http.StatusOK, hybridSearchResponse{
		Query:   q,
		Mode:    "hybrid",
		Limit:   limit,
		Offset:  offset,
		Engines: engines,
		RRFK:    rrfK,
		Results: entries,
	})
}

func parseRRFK(c echo.Context) (float64, error) {
	raw := c.QueryParam("rrf_k")
	if raw == "" {
		return 0, nil
	}
	k, err := strconv.ParseFloat(raw, 64)
	if err != nil || k <= 0 {
		return 0, echo.NewHTTPError(http.StatusBadRequest, "invalid rrf_k: expected a number greater than 0")
	}
	return k, nil
}
