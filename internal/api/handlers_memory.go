package api

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/kiwifs/kiwifs/internal/memory"
	"github.com/labstack/echo/v4"
)

// MemoryReport godoc
//
//	@Summary		Get memory consolidation report
//	@Description	Returns a consolidation report summarizing episodic memory coverage across the knowledge base.
//	@Tags			memory
//	@Security		BearerAuth
//	@Param			episodes_prefix	query		string	false	"Override the default episodes path prefix"
//	@Param			limit			query		int		false	"Limit the number of files returned"
//	@Param			offset			query		int		false	"Skip the first N files"
//	@Success		200				{object}	memory.Report
//	@Failure		400				{object}	map[string]string
//	@Failure		500				{object}	map[string]string
//	@Router			/api/kiwi/memory/report [get]
func (h *Handlers) MemoryReport(c echo.Context) error {
	ctx := c.Request().Context()
	prefix := c.QueryParam("episodes_prefix")
	if prefix == "" {
		prefix = h.memoryEpisodesPrefix
	}
	limit, err := nonNegativeIntQuery(c, "limit")
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	offset, err := nonNegativeIntQuery(c, "offset")
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	opt := memory.Options{EpisodesPathPrefix: prefix, Limit: limit, Offset: offset}
	rep, err := memory.Scan(ctx, h.store, opt)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.JSON(http.StatusOK, rep)
}

func nonNegativeIntQuery(c echo.Context, name string) (int, error) {
	raw := c.QueryParam(name)
	if raw == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 {
		return 0, fmt.Errorf("%s must be a non-negative integer", name)
	}
	return n, nil
}
