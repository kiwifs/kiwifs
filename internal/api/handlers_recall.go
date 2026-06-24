package api

import (
	"context"
	"net/http"

	"github.com/kiwifs/kiwifs/internal/links"
	"github.com/kiwifs/kiwifs/internal/search"
	"github.com/kiwifs/kiwifs/internal/tracing"
	"github.com/kiwifs/kiwifs/internal/vectorstore"
	"github.com/labstack/echo/v4"
)

type recallRequest struct {
	Query         string   `json:"query"`
	Limit         int      `json:"limit"`
	Sources       []string `json:"sources"`
	Scope         string   `json:"scope"`
	BoostVerified bool     `json:"boost_verified"`
	K             int      `json:"k"`
	PathPrefix    string   `json:"path_prefix"`
}

type recallResponse struct {
	Query   string                `json:"query"`
	Limit   int                   `json:"limit"`
	Results []search.RecallResult `json:"results"`
}

// Recall godoc
//
//	@Summary		Fused memory recall
//	@Description	Fuses FTS, vector, and graph (backlink) retrieval with Reciprocal Rank Fusion (RRF).
//	@Tags			search
//	@Security		BearerAuth
//	@Accept			json
//	@Produce		json
//	@Param			body	body		recallRequest	true	"Recall query parameters"
//	@Success		200		{object}	recallResponse
//	@Failure		400		{object}	map[string]string
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/recall [post]
func (h *Handlers) Recall(c echo.Context) error {
	req := recallRequest{}
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}
	if req.Query == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "query is required")
	}
	limit := search.NormalizeLimit(req.Limit)
	if limit <= 0 {
		limit = 10
	}

	recaller := buildRecaller(h.searcher, h.vectors, h.linker)
	results, err := recaller.Recall(c.Request().Context(), search.RecallOptions{
		Query:         req.Query,
		Limit:         limit,
		Sources:       req.Sources,
		Scope:         req.Scope,
		BoostVerified: req.BoostVerified,
		K:             req.K,
		PathPrefix:    req.PathPrefix,
	})
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	if results == nil {
		results = []search.RecallResult{}
	}
	if recorder, ok := h.searcher.(search.SearchRecorder); ok {
		_ = recorder.RecordSearch(c.Request().Context(), req.Query, "recall", len(results) > 0)
	}
	tracing.Record(c.Request().Context(), tracing.Event{Kind: tracing.KindSearch, Query: req.Query, HitCount: len(results), Detail: "recall"})
	return c.JSON(http.StatusOK, recallResponse{
		Query:   req.Query,
		Limit:   limit,
		Results: results,
	})
}

func buildRecaller(searcher search.Searcher, vectors *vectorstore.Service, linker links.Linker) *search.Recaller {
	r := &search.Recaller{Searcher: searcher}
	if vectors != nil {
		r.Vectors = vectorServiceAdapter{svc: vectors}
	}
	if linker != nil {
		r.Linker = linkerAdapter{linker: linker}
	}
	if meta, ok := searcher.(search.MetaReader); ok {
		r.Meta = meta
	}
	return r
}

type vectorServiceAdapter struct {
	svc *vectorstore.Service
}

func (a vectorServiceAdapter) Search(ctx context.Context, query string, topK int) ([]search.VectorHit, error) {
	results, err := a.svc.Search(ctx, query, topK)
	if err != nil {
		return nil, err
	}
	out := make([]search.VectorHit, len(results))
	for i, res := range results {
		out[i] = search.VectorHit{
			Path:    res.Path,
			Snippet: res.Snippet,
			Score:   res.Score,
		}
	}
	return out, nil
}

type linkerAdapter struct {
	linker links.Linker
}

func (a linkerAdapter) Backlinks(ctx context.Context, path string) ([]search.BacklinkHit, error) {
	entries, err := a.linker.Backlinks(ctx, path)
	if err != nil {
		return nil, err
	}
	out := make([]search.BacklinkHit, len(entries))
	for i, entry := range entries {
		out[i] = search.BacklinkHit{Path: entry.Path}
	}
	return out, nil
}
