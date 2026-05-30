package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"

	"github.com/kiwifs/kiwifs/internal/jsoncanvas"
	"github.com/labstack/echo/v4"
)

type deleteCanvasResponse struct {
	Deleted string `json:"deleted"`
}

type patchCanvasResponse struct {
	Path    string                 `json:"path"`
	ETag    string                 `json:"etag"`
	Applied jsoncanvas.PatchResult `json:"applied"`
}

type autoLayoutCanvasRequest struct {
	Layout string `json:"layout"` // dot | neato | fdp | circo
}

type autoLayoutCanvasResponse struct {
	Path      string `json:"path"`
	ETag      string `json:"etag"`
	NodeCount int    `json:"node_count"`
	EdgeCount int    `json:"edge_count"`
}

// DeleteCanvas godoc
//
//	@Summary		Delete a canvas
//	@Description	Removes a canvas file by path.
//	@Tags			canvas
//	@Security		BearerAuth
//	@Param			path	query		string	true	"Path to canvas file (must end with .canvas.json)"
//	@Param			X-Actor	header		string	false	"Actor identity performing the deletion"
//	@Success		200		{object}	deleteCanvasResponse
//	@Failure		400		{object}	map[string]string	"Invalid parameters"
//	@Failure		404		{object}	map[string]string	"Canvas not found"
//	@Failure		500		{object}	map[string]string	"Internal server error deleting canvas"
//	@Router			/api/kiwi/canvas [delete]
func (h *Handlers) DeleteCanvas(c echo.Context) error {
	path, err := requireCanvasPath(c)
	if err != nil {
		return err
	}

	actor := c.Request().Header.Get("X-Actor")
	if actor == "" {
		actor = "system"
	}

	if err := h.pipe.Delete(c.Request().Context(), path, actor); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return echo.NewHTTPError(http.StatusNotFound, "canvas not found")
		}
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	return c.JSON(http.StatusOK, map[string]any{"deleted": path})
}

// PatchCanvas godoc
//
//	@Summary		Patch canvas content
//	@Description	Applies a batch of atomic node/edge operations (add, update, remove) to a canvas document.
//	@Tags			canvas
//	@Security		BearerAuth
//	@Param			path	query		string					true	"Path to canvas file (must end with .canvas.json)"
//	@Param			X-Actor	header		string					false	"Actor identity performing the patch"
//	@Param			body	body		jsoncanvas.PatchRequest	true	"Patch operations to apply"
//	@Success		200		{object}	patchCanvasResponse
//	@Failure		400		{object}	map[string]string	"Invalid parameters or request body"
//	@Failure		422		{object}	map[string]string	"Unprocessable entity: invalid patch operation"
//	@Failure		500		{object}	map[string]string	"Internal server error writing canvas"
//	@Router			/api/kiwi/canvas [patch]
func (h *Handlers) PatchCanvas(c echo.Context) error {
	path, err := requireCanvasPath(c)
	if err != nil {
		return err
	}

	body, err := io.ReadAll(c.Request().Body)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	var req jsoncanvas.PatchRequest
	if err := json.Unmarshal(body, &req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid patch request")
	}
	if len(req.Operations) == 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "operations array is empty")
	}

	ctx := c.Request().Context()

	doc, err := h.store.Read(ctx, path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			doc = jsoncanvas.EmptyDocument()
		} else {
			return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
		}
	}

	patched, result, err := jsoncanvas.ApplyPatch(doc, req.Operations)
	if err != nil {
		return echo.NewHTTPError(http.StatusUnprocessableEntity, err.Error())
	}

	actor := c.Request().Header.Get("X-Actor")
	if actor == "" {
		actor = "system"
	}

	writeResult, err := h.pipe.Write(ctx, path, patched, actor)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	return c.JSON(http.StatusOK, map[string]any{
		"path":    path,
		"etag":    writeResult.ETag,
		"applied": result,
	})
}

// QueryCanvas godoc
//
//	@Summary		Query canvas elements
//	@Description	Searches and filters nodes and edges within a canvas file.
//	@Tags			canvas
//	@Security		BearerAuth
//	@Param			path		query		string	true	"Path to canvas file (must end with .canvas.json)"
//	@Param			type		query		string	false	"Filter nodes by type (text, file, link, group)"
//	@Param			q			query		string	false	"Substring search match against fields (text, file, url, label)"
//	@Param			connected	query		string	false	"Filter by node ID connected to other nodes/edges"
//	@Param			nodes_only	query		bool	false	"If true, omit edges from the result"
//	@Param			edges_only	query		bool	false	"If true, omit nodes from the result"
//	@Success		200			{object}	jsoncanvas.QueryResult
//	@Failure		400			{object}	map[string]string	"Invalid query parameters or file type"
//	@Failure		404			{object}	map[string]string	"Canvas not found"
//	@Failure		500			{object}	map[string]string	"Internal server error querying canvas"
//	@Router			/api/kiwi/canvas/query [get]
func (h *Handlers) QueryCanvas(c echo.Context) error {
	path, err := requireCanvasPath(c)
	if err != nil {
		return err
	}

	doc, err := h.store.Read(c.Request().Context(), path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return echo.NewHTTPError(http.StatusNotFound, "canvas not found")
		}
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	q := jsoncanvas.QueryParams{
		NodeType:  c.QueryParam("type"),
		Search:    c.QueryParam("q"),
		Connected: c.QueryParam("connected"),
		NodesOnly: c.QueryParam("nodes_only") == "true",
		EdgesOnly: c.QueryParam("edges_only") == "true",
	}

	result, err := jsoncanvas.Query(doc, q)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	return c.JSON(http.StatusOK, result)
}

// AutoLayoutCanvas godoc
//
//	@Summary		Auto layout canvas nodes
//	@Description	Repositions existing canvas nodes spatially using Graphviz layout engines.
//	@Tags			canvas
//	@Security		BearerAuth
//	@Param			path	query		string					true	"Path to canvas file (must end with .canvas.json)"
//	@Param			X-Actor	header		string					false	"Actor identity performing the layout operation"
//	@Param			body	body		autoLayoutCanvasRequest	false	"Optional layout engine configuration"
//	@Success		200		{object}	autoLayoutCanvasResponse
//	@Failure		400		{object}	map[string]string	"Invalid parameters"
//	@Failure		404		{object}	map[string]string	"Canvas not found"
//	@Failure		500		{object}	map[string]string	"Internal server error repositioning nodes"
//	@Router			/api/kiwi/canvas/auto-layout [post]
func (h *Handlers) AutoLayoutCanvas(c echo.Context) error {
	path, err := requireCanvasPath(c)
	if err != nil {
		return err
	}

	var req struct {
		Layout string `json:"layout"`
	}
	_ = c.Bind(&req)

	ctx := c.Request().Context()

	doc, err := h.store.Read(ctx, path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return echo.NewHTTPError(http.StatusNotFound, "canvas not found")
		}
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	laid, nodeCount, edgeCount, err := jsoncanvas.AutoLayout(doc, req.Layout)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	actor := c.Request().Header.Get("X-Actor")
	if actor == "" {
		actor = "system"
	}

	writeResult, err := h.pipe.Write(ctx, path, laid, actor)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	return c.JSON(http.StatusOK, map[string]any{
		"path":       path,
		"etag":       writeResult.ETag,
		"node_count": nodeCount,
		"edge_count": edgeCount,
	})
}
