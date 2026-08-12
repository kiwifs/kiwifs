package api

import (
	"net/http"

	"github.com/kiwifs/kiwifs/internal/brief"
	"github.com/labstack/echo/v4"
)

type briefRequest struct {
	Query string `json:"query" example:"how do I handle missing values?"`
	// BudgetTokens is a hard ceiling. Zero uses the default; a negative value
	// yields an empty pack whose manifest still lists every candidate, which
	// is how a caller asks "what would this cost?".
	BudgetTokens int    `json:"budget_tokens" example:"4000"`
	MaxPages     int    `json:"max_pages" example:"20"`
	PathPrefix   string `json:"path_prefix" example:"projects/"`
	// Encoding names the BPE vocabulary used to count. Empty uses cl100k_base.
	Encoding string `json:"encoding" example:"cl100k_base"`
}

// Brief godoc
//
//	@Summary		Assemble a token-budgeted answer pack
//	@Description	Composes hybrid retrieval, section extraction and real token counting into a single context pack that fits a stated budget, replacing the dozen round trips an agent otherwise makes. Content is never summarised or rewritten — anything that did not fit is named in the dropped manifest with its token cost, so the caller can request it explicitly or raise the budget.
//	@Tags			search
//	@Security		BearerAuth
//	@Accept			json
//	@Produce		json
//	@Param			body	body		briefRequest	true	"Brief request"
//	@Success		200		{object}	brief.Pack
//	@Failure		400		{object}	map[string]string
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/brief [post]
func (h *Handlers) Brief(c echo.Context) error {
	var req briefRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}
	if req.Query == "" {
		req.Query = c.QueryParam("q")
	}
	if req.Query == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "query is required")
	}

	pack, err := brief.Assemble(c.Request().Context(), h.searcher, h.vectors, h.store, brief.Request{
		Query:        req.Query,
		BudgetTokens: req.BudgetTokens,
		MaxPages:     req.MaxPages,
		PathPrefix:   req.PathPrefix,
		Encoding:     req.Encoding,
	})
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.JSON(http.StatusOK, pack)
}
