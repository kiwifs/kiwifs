package api

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/kiwifs/kiwifs/internal/markdown"
	"github.com/labstack/echo/v4"
)

type lintRequest struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type lintResponse struct {
	Issues []markdown.LintIssue `json:"issues"`
}

// Lint godoc
//
//	@Summary		Lint markdown content
//	@Description	Validates markdown content for structural issues and returns a list of lint issues. Accepts either a file path to read from storage or inline markdown content directly.
//	@Tags			lint
//	@Security		BearerAuth
//	@Accept			json
//	@Produce		json
//	@Param			request	body		lintRequest	true	"Markdown file path or content to lint"
//	@Success		200		{object}	lintResponse
//	@Failure		400		{object}	map[string]string	"Invalid request body or parameters"
//	@Failure		404		{object}	map[string]string	"File not found (when path is provided)"
//	@Router			/api/kiwi/lint [post]
func (h *Handlers) Lint(c echo.Context) error {
	var req lintRequest

	body, err := io.ReadAll(io.LimitReader(c.Request().Body, 32<<20+1))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "failed to read body")
	}
	if err := json.Unmarshal(body, &req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid JSON body")
	}

	var data []byte
	if req.Content != "" {
		data = []byte(req.Content)
	} else if req.Path != "" {
		content, readErr := h.store.Read(c.Request().Context(), req.Path)
		if readErr != nil {
			return echo.NewHTTPError(http.StatusNotFound, "file not found: "+req.Path)
		}
		data = content
	} else {
		return echo.NewHTTPError(http.StatusBadRequest, "provide either path or content")
	}

	issues := markdown.LintMarkdown(data)
	if issues == nil {
		issues = []markdown.LintIssue{}
	}

	return c.JSON(http.StatusOK, lintResponse{
		Issues: issues,
	})
}
