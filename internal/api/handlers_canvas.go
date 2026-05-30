package api

import (
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/kiwifs/kiwifs/internal/jsoncanvas"
	"github.com/kiwifs/kiwifs/internal/storage"
	"github.com/labstack/echo/v4"
)

type canvasListEntry struct {
	Path string `json:"path"`
	Name string `json:"name"`
}

type canvasListResponse struct {
	Canvases []canvasListEntry `json:"canvases"`
}

type writeCanvasResponse struct {
	ETag string `json:"etag"`
	Path string `json:"path"`
}

// ListCanvas godoc
//
//	@Summary		List all canvases
//	@Description	Returns a list of all canvas files (.canvas.json) in the knowledge base.
//	@Tags			canvas
//	@Security		BearerAuth
//	@Success		200	{object}	canvasListResponse
//	@Failure		500	{object}	map[string]string	"Internal server error walking storage"
//	@Router			/api/kiwi/canvases [get]
func (h *Handlers) ListCanvas(c echo.Context) error {
	var entries []canvasListEntry

	err := storage.WalkAll(c.Request().Context(), h.store, "/", func(e storage.Entry) error {
		if storage.IsCanvasFile(e.Path) {
			entries = append(entries, canvasListEntry{
				Path: e.Path,
				Name: canvasDisplayName(e.Path),
			})
		}
		return nil
	})
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	if entries == nil {
		entries = []canvasListEntry{}
	}

	return c.JSON(http.StatusOK, map[string]any{"canvases": entries})
}

// ReadCanvas godoc
//
//	@Summary		Read canvas content
//	@Description	Reads a canvas file and returns its JSON content if structurally valid.
//	@Tags			canvas
//	@Security		BearerAuth
//	@Param			path	query		string	true	"Path to canvas file (must end with .canvas.json)"
//	@Success		200		{object}	jsoncanvas.Document
//	@Failure		400		{object}	map[string]string	"Invalid query parameters or file type"
//	@Failure		404		{object}	map[string]string	"Canvas file not found"
//	@Failure		500		{object}	map[string]string	"Internal server error reading file or invalid canvas JSON structure"
//	@Router			/api/kiwi/canvas [get]
func (h *Handlers) ReadCanvas(c echo.Context) error {
	path, err := requireCanvasPath(c)
	if err != nil {
		return err
	}

	content, err := h.store.Read(c.Request().Context(), path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return echo.NewHTTPError(http.StatusNotFound, "canvas not found")
		}
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	if err := jsoncanvas.Validate(content); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "invalid canvas JSON")
	}

	c.Response().Header().Set("Content-Type", "application/json")
	return c.JSONBlob(http.StatusOK, content)
}

// WriteCanvas godoc
//
//	@Summary		Write canvas content
//	@Description	Creates or updates a canvas file after validating its structure against the JSON Canvas specification.
//	@Tags			canvas
//	@Security		BearerAuth
//	@Param			path	query		string				true	"Path to canvas file (must end with .canvas.json)"
//	@Param			X-Actor	header		string				false	"Actor identity performing the write"
//	@Param			canvas	body		jsoncanvas.Document	true	"JSON Canvas document contents"
//	@Success		200		{object}	writeCanvasResponse
//	@Failure		400		{object}	map[string]string	"Invalid parameters or invalid canvas JSON structure"
//	@Failure		500		{object}	map[string]string	"Internal server error writing file"
//	@Router			/api/kiwi/canvas [put]
func (h *Handlers) WriteCanvas(c echo.Context) error {
	path, err := requireCanvasPath(c)
	if err != nil {
		return err
	}

	content, err := io.ReadAll(c.Request().Body)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	if err := jsoncanvas.Validate(content); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid canvas JSON: must include nodes and edges arrays")
	}

	actor := c.Request().Header.Get("X-Actor")
	if actor == "" {
		actor = "system"
	}

	result, err := h.pipe.Write(c.Request().Context(), path, content, actor)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	return c.JSON(http.StatusOK, map[string]any{
		"etag": result.ETag,
		"path": path,
	})
}

func requireCanvasPath(c echo.Context) (string, error) {
	path := c.QueryParam("path")
	if path == "" {
		return "", echo.NewHTTPError(http.StatusBadRequest, "path required")
	}
	if !strings.HasSuffix(strings.ToLower(path), ".canvas.json") {
		return "", echo.NewHTTPError(http.StatusBadRequest, "path must end with .canvas.json")
	}
	return path, nil
}

func canvasDisplayName(path string) string {
	base := filepath.Base(path)
	name := strings.TrimSuffix(base, ".canvas.json")
	if name == "" {
		return base
	}
	return name
}
