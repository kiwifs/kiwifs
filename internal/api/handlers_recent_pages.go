package api

import (
	"net/http"

	"github.com/kiwifs/kiwifs/internal/recentpages"
	"github.com/labstack/echo/v4"
)

type recentPagesResponse struct {
	Pages []recentpages.Page `json:"pages"`
}

// RecentPages godoc
//
//	@Summary		List recently edited pages
//	@Description	Returns recently edited markdown pages from git history, falling back to filesystem mtimes.
//	@Tags			ui
//	@Security		BearerAuth
//	@Param			limit	query		int	false	"Maximum pages to return (default 10, max 50)"
//	@Success		200		{object}	recentPagesResponse
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/recent-pages [get]
func (h *Handlers) RecentPages(c echo.Context) error {
	limit := parseIntParam(c, "limit", 10)
	if limit <= 0 {
		limit = 10
	}
	if limit > 50 {
		limit = 50
	}
	pages, err := recentpages.List(c.Request().Context(), h.root, h.store, limit)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	if pages == nil {
		pages = []recentpages.Page{}
	}
	return c.JSON(http.StatusOK, recentPagesResponse{Pages: pages})
}
