package api

import (
	"errors"
	"net/http"

	"github.com/kiwifs/kiwifs/internal/config"
	"github.com/kiwifs/kiwifs/internal/hybrid"
	"github.com/kiwifs/kiwifs/internal/search"
	"github.com/kiwifs/kiwifs/internal/tracing"
	"github.com/labstack/echo/v4"
)

type recallRequest struct {
	Query string `json:"query" example:"how did we handle the auth migration?"`
	Limit int    `json:"limit" example:"10"`
	// Sources picks the signals to fuse: any of fts, vector and graph.
	// Empty uses all three.
	Sources       []string `json:"sources" example:"fts,vector,graph"`
	Scope         string   `json:"scope" example:"user:alice"`
	PathPrefix    string   `json:"path_prefix" example:"episodes/"`
	BoostVerified bool     `json:"boost_verified" example:"true"`
	RRFK          float64  `json:"rrf_k" example:"60"`
}

type recallResultEntry struct {
	hybrid.RecallResult
	Permalink string `json:"permalink,omitempty"`
}

type recallResponse struct {
	Query string  `json:"query"`
	Limit int     `json:"limit"`
	RRFK  float64 `json:"rrf_k"`
	// Engines lists the signals that actually contributed. A recall served
	// without the vector or link index is still a 200, and this is how the
	// caller finds out.
	Engines []string            `json:"engines"`
	Results []recallResultEntry `json:"results"`
}

// Recall godoc
//
//	@Summary		Fused keyword, semantic and link-graph retrieval
//	@Description	Runs keyword (BM25) and vector search in parallel, expands the best hits one hop along the link graph (pages that link to them), and fuses the three rankings with Reciprocal Rank Fusion. Each result names the signals that found it and its rank in each. Signals that are not configured are skipped, not errors: without a vector index recall is keyword plus graph, and engines says so. With boost_verified, each score is multiplied by (1 + confidence) for pages whose frontmatter confidence is a number in (0, 1].
//	@Tags			search
//	@Security		BearerAuth
//	@Accept			json
//	@Produce		json
//	@Param			body	body		recallRequest	true	"Recall request"
//	@Success		200		{object}	recallResponse
//	@Failure		400		{object}	map[string]string
//	@Failure		500		{object}	map[string]string
//	@Failure		501		{object}	map[string]string
//	@Failure		503		{object}	map[string]string
//	@Router			/api/kiwi/recall [post]
func (h *Handlers) Recall(c echo.Context) error {
	var req recallRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}
	if req.Query == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "query is required")
	}
	if req.RRFK < 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid rrf_k: expected a number greater than 0")
	}
	sources, err := hybrid.ParseSources(req.Sources)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	limit := req.Limit
	if limit <= 0 {
		limit = hybrid.DefaultRecallTopK
	}
	limit = search.NormalizeLimit(limit)

	ctx := c.Request().Context()
	resp, err := hybrid.Recall(ctx, h.searcher, h.vectors, h.linker, req.Query, hybrid.RecallOptions{
		TopK:          limit,
		K:             req.RRFK,
		Sources:       sources,
		Scope:         req.Scope,
		PathPrefix:    req.PathPrefix,
		BoostVerified: req.BoostVerified,
	})
	switch {
	case errors.Is(err, hybrid.ErrScopeUnsupported):
		return echo.NewHTTPError(http.StatusNotImplemented, err.Error())
	case errors.Is(err, hybrid.ErrNoVectorIndex):
		return echo.NewHTTPError(http.StatusServiceUnavailable, err.Error())
	case err != nil:
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	entries := make([]recallResultEntry, len(resp.Results))
	for i, r := range resp.Results {
		entries[i] = recallResultEntry{RecallResult: r, Permalink: config.Permalink(h.publicURL, r.Path)}
	}

	if recorder, ok := h.searcher.(search.SearchRecorder); ok {
		_ = recorder.RecordSearch(ctx, req.Query, "recall", len(entries) > 0)
	}
	tracing.Record(ctx, tracing.Event{Kind: tracing.KindSearch, Query: req.Query, HitCount: len(entries)})

	rrfK := req.RRFK
	if rrfK <= 0 {
		rrfK = search.DefaultRRFK
	}
	return c.JSON(http.StatusOK, recallResponse{
		Query:   req.Query,
		Limit:   limit,
		RRFK:    rrfK,
		Engines: resp.Engines,
		Results: entries,
	})
}
