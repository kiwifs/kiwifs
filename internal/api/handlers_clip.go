package api

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/kiwifs/kiwifs/internal/clipper"
	"github.com/labstack/echo/v4"
)

type clipRequest struct {
	URL    string   `json:"url" example:"https://example.com/article"`
	Title  string   `json:"title" example:"Optional Title Override"`
	Tags   []string `json:"tags" example:"web,research"`
	Folder string   `json:"folder" example:"clips/"`
}

type clipResponse struct {
	Path    string `json:"path" example:"clips/article-title.md"`
	Title   string `json:"title" example:"Article Title"`
	Excerpt string `json:"excerpt" example:"This is a snippet excerpt of the article..."`
}

// Clip godoc
//
//	@Summary		Clip a web page
//	@Description	Downloads the content of a web page, parses it into markdown, writes it to a folder, and registers it in the system index.
//	@Tags			clip
//	@Security		BearerAuth
//	@Accept			json
//	@Produce		json
//	@Param			request	body		clipRequest	true	"Web page clipping request parameters"
//	@Param			X-Actor	header		string		false	"Actor identity performing the write"
//	@Success		200		{object}	clipResponse
//	@Failure		400		{object}	map[string]string	"Invalid JSON payload or missing URL"
//	@Failure		500		{object}	map[string]string	"Clipping or write pipeline execution failed"
//	@Router			/api/kiwi/clip [post]
func (h *Handlers) Clip(c echo.Context) error {
	var req clipRequest

	body, err := io.ReadAll(io.LimitReader(c.Request().Body, 10<<20)) // 10MB limit
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "failed to read body")
	}
	if err := json.Unmarshal(body, &req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid JSON body")
	}

	if req.URL == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "url is required")
	}

	// Clip the web page
	clipReq := clipper.ClipRequest{
		URL:    req.URL,
		Title:  req.Title,
		Tags:   req.Tags,
		Folder: req.Folder,
	}

	result, content, err := clipper.Clip(c.Request().Context(), clipReq, nil)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "clip failed: "+err.Error())
	}

	// Write through pipeline
	actor := c.Request().Header.Get("X-Actor")
	if actor == "" {
		actor = "clipper"
	}

	_, writeErr := h.pipe.Write(c.Request().Context(), result.Path, []byte(content), actor)
	if writeErr != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "write failed: "+writeErr.Error())
	}

	return c.JSON(http.StatusOK, clipResponse{
		Path:    result.Path,
		Title:   result.Title,
		Excerpt: result.Excerpt,
	})
}
