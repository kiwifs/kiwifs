package api

import (
	"net/http"
	"strconv"

	"github.com/kiwifs/kiwifs/internal/graphutil"
	"github.com/labstack/echo/v4"
)

// GraphAnalytics godoc
//
//	@Summary		Get graph analytics summary
//	@Description	Computes and returns high-level graph metrics including total nodes, total edges, components count, top PageRank pages, and orphan pages.
//	@Tags			graph
//	@Security		BearerAuth
//	@Produce		json
//	@Param			limit	query		int	false	"Maximum number of top pages to return (default 20)"
//	@Success		200		{object}	graphutil.Result
//	@Failure		500		{object}	map[string]string	"Internal server error"
//	@Failure		503		{object}	map[string]string	"Link indexing is not enabled"
//	@Router			/api/kiwi/graph/analytics [get]
func (h *Handlers) GraphAnalytics(c echo.Context) error {
	if h.linker == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "link indexing is not enabled")
	}

	ctx := c.Request().Context()
	edges, err := h.linker.AllEdges(ctx)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	limit := 20
	if l := c.QueryParam("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 {
			limit = v
		}
	}

	result := graphutil.Analyze(edges, limit)
	return c.JSON(http.StatusOK, result)
}

type graphCentralityResponse struct {
	Pages []graphutil.CentralityEntry `json:"pages"`
}

// GraphCentrality godoc
//
//	@Summary		Get centrality metrics
//	@Description	Returns PageRank, In-Degree, Out-Degree, and betweenness centrality scores for all nodes/pages in the link graph.
//	@Tags			graph
//	@Security		BearerAuth
//	@Produce		json
//	@Param			limit	query		int	false	"Maximum number of pages to return (defaults to all)"
//	@Success		200		{object}	graphCentralityResponse
//	@Failure		500		{object}	map[string]string	"Internal server error"
//	@Failure		503		{object}	map[string]string	"Link indexing is not enabled"
//	@Router			/api/kiwi/graph/centrality [get]
func (h *Handlers) GraphCentrality(c echo.Context) error {
	if h.linker == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "link indexing is not enabled")
	}

	ctx := c.Request().Context()
	edges, err := h.linker.AllEdges(ctx)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	entries := graphutil.Centrality(edges)

	limit := len(entries)
	if l := c.QueryParam("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 && v < limit {
			limit = v
		}
	}
	if limit < len(entries) {
		entries = entries[:limit]
	}

	return c.JSON(http.StatusOK, graphCentralityResponse{
		Pages: entries,
	})
}

type graphCommunitiesResponse struct {
	Communities []graphutil.Community `json:"communities"`
}

// GraphCommunities godoc
//
//	@Summary		Get community clusters
//	@Description	Computes and returns community clusters of pages in the link graph detected using the Louvain algorithm.
//	@Tags			graph
//	@Security		BearerAuth
//	@Produce		json
//	@Success		200		{object}	graphCommunitiesResponse
//	@Failure		500		{object}	map[string]string	"Internal server error"
//	@Failure		503		{object}	map[string]string	"Link indexing is not enabled"
//	@Router			/api/kiwi/graph/communities [get]
func (h *Handlers) GraphCommunities(c echo.Context) error {
	if h.linker == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "link indexing is not enabled")
	}

	ctx := c.Request().Context()
	edges, err := h.linker.AllEdges(ctx)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	communities := graphutil.CommunitiesFromEdges(edges)

	return c.JSON(http.StatusOK, graphCommunitiesResponse{
		Communities: communities,
	})
}

type graphPathResponse struct {
	Path []string `json:"path" example:"/docs/getting-started.md,/docs/advanced.md"`
}

// GraphPath godoc
//
//	@Summary		Find shortest path between pages
//	@Description	Computes and returns the shortest path of links between two specified pages in the link graph.
//	@Tags			graph
//	@Security		BearerAuth
//	@Produce		json
//	@Param			from	query		string	true	"Source page path"
//	@Param			to		query		string	true	"Target page path"
//	@Success		200		{object}	graphPathResponse
//	@Failure		400		{object}	map[string]string	"Missing from or to parameter"
//	@Failure		404		{object}	map[string]string	"No path found or node not found"
//	@Failure		500		{object}	map[string]string	"Internal server error"
//	@Failure		503		{object}	map[string]string	"Link indexing is not enabled"
//	@Router			/api/kiwi/graph/path [get]
func (h *Handlers) GraphPath(c echo.Context) error {
	if h.linker == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "link indexing is not enabled")
	}

	from := c.QueryParam("from")
	to := c.QueryParam("to")
	if from == "" || to == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "from and to query parameters are required")
	}

	ctx := c.Request().Context()
	edges, err := h.linker.AllEdges(ctx)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	path, err := graphutil.ShortestPathFromEdges(edges, from, to)
	if err != nil {
		if err == graphutil.ErrNodeNotFound {
			return echo.NewHTTPError(http.StatusNotFound, err.Error())
		}
		if err == graphutil.ErrNoPath {
			return echo.NewHTTPError(http.StatusNotFound, err.Error())
		}
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	return c.JSON(http.StatusOK, graphPathResponse{
		Path: path,
	})
}
