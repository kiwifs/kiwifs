package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/kiwifs/kiwifs/internal/graphutil"
	"github.com/kiwifs/kiwifs/internal/links"
	"github.com/labstack/echo/v4"
)

type canvasGenerateRequest struct {
	Path       string `json:"path"`
	Layout     string `json:"layout"`
	FolderOnly string `json:"folder,omitempty"`
	Colorize   *bool  `json:"colorize,omitempty"`
}

type canvasGenerateResponse struct {
	Path      string `json:"path"`
	ETag      string `json:"etag"`
	NodeCount int    `json:"node_count"`
	EdgeCount int    `json:"edge_count"`
}

// GenerateCanvas godoc
//
//	@Summary		Generate canvas from link graph
//	@Description	Builds a spatially positioned JSON Canvas (.canvas.json) file based on wiki-links between pages in the knowledge graph.
//	@Tags			canvas
//	@Security		BearerAuth
//	@Param			X-Actor	header		string					false	"Actor identity performing the generate operation"
//	@Param			body	body		canvasGenerateRequest	true	"Configuration parameters for canvas generation"
//	@Success		200		{object}	canvasGenerateResponse
//	@Failure		400		{object}	map[string]string	"Invalid request body"
//	@Failure		500		{object}	map[string]string	"Internal server error generating or writing canvas"
//	@Failure		503		{object}	map[string]string	"Link index not available"
//	@Router			/api/kiwi/canvas/generate [post]
func (h *Handlers) GenerateCanvas(c echo.Context) error {
	var req canvasGenerateRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}

	if req.Path == "" {
		req.Path = "canvas.canvas.json"
	}
	if !strings.HasSuffix(req.Path, ".canvas.json") {
		req.Path += ".canvas.json"
	}

	colorize := true
	if req.Colorize != nil {
		colorize = *req.Colorize
	}

	algo := graphutil.LayoutAlgorithm(req.Layout)
	switch algo {
	case graphutil.LayoutHierarchical, graphutil.LayoutRadial, graphutil.LayoutForce, graphutil.LayoutCircular:
	default:
		algo = graphutil.LayoutHierarchical
	}

	if h.linker == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "link index not available")
	}

	allEdges, err := h.linker.AllEdges(c.Request().Context())
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read link graph")
	}

	pageSet := make(map[string]struct{})
	var filteredEdges []links.Edge

	for _, e := range allEdges {
		srcOk := req.FolderOnly == "" || strings.HasPrefix(e.Source, req.FolderOnly)
		tgtOk := req.FolderOnly == "" || strings.HasPrefix(e.Target, req.FolderOnly)
		if srcOk {
			pageSet[e.Source] = struct{}{}
		}
		if tgtOk {
			pageSet[e.Target] = struct{}{}
		}
		if srcOk && tgtOk {
			filteredEdges = append(filteredEdges, e)
		}
	}

	pages := make([]string, 0, len(pageSet))
	for p := range pageSet {
		pages = append(pages, p)
	}

	var communities map[string]int
	if colorize {
		communities = graphutil.DetectCommunitiesFromEdges(filteredEdges)
	}

	layout, err := graphutil.GenerateCanvasLayout(c.Request().Context(), filteredEdges, pages, algo, communities)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	content, err := json.MarshalIndent(layout, "", "  ")
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	actor := c.Request().Header.Get("X-Actor")
	if actor == "" {
		actor = "system"
	}

	result, err := h.pipe.Write(c.Request().Context(), req.Path, content, actor)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	return c.JSON(http.StatusOK, map[string]any{
		"path":       req.Path,
		"etag":       result.ETag,
		"node_count": len(layout.Nodes),
		"edge_count": len(layout.Edges),
	})
}
