package api

import (
	"log"
	"net/http"

	"github.com/kiwifs/kiwifs/internal/vectorstore"
	"github.com/labstack/echo/v4"
)

type suggestionItem struct {
	Target     string  `json:"target" example:"/docs/getting-started.md"`
	Similarity float64 `json:"similarity" example:"0.875"`
	Snippet    string  `json:"snippet" example:"A quick guide on starting with KiwiFS..."`
}

type suggestionsResponse struct {
	Suggestions []suggestionItem `json:"suggestions"`
}

// Suggestions godoc
//
//	@Summary		Get link suggestions for a file
//	@Description	Computes and returns potential links to other pages in the workspace using vector similarity search, excluding already linked pages.
//	@Tags			suggestions
//	@Security		BearerAuth
//	@Produce		json
//	@Param			path	query		string	true	"File path to get suggestions for"
//	@Param			limit	query		int		false	"Maximum number of suggestions to return (default 10)"
//	@Success		200		{object}	suggestionsResponse
//	@Failure		400		{object}	map[string]string	"Path query parameter missing or invalid limit parameter"
//	@Failure		404		{object}	map[string]string	"Page not found"
//	@Failure		500		{object}	map[string]string	"Internal vector search error"
//	@Failure		503		{object}	map[string]string	"Vector search service is disabled"
//	@Router			/api/kiwi/suggestions [get]
func (h *Handlers) Suggestions(c echo.Context) error {
	path := c.QueryParam("path")
	if path == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "path is required")
	}
	if h.vectors == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, vectorstore.ErrDisabled.Error())
	}

	ctx := c.Request().Context()

	content, err := h.store.Read(ctx, path)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "page not found")
	}

	limit := 10
	if l := c.QueryParam("limit"); l != "" {
		if n, err := parseInt(l); err == nil && n > 0 {
			limit = n
		}
	}

	topK := limit * 3
	if topK < 20 {
		topK = 20
	}
	results, err := h.vectors.Search(ctx, string(content), topK)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	// Get existing outbound + inbound links to filter them out
	linked := make(map[string]bool)
	linked[path] = true
	if h.linker != nil {
		edges, err := h.linker.AllEdges(ctx)
		if err != nil {
			log.Printf("suggestions: AllEdges: %v", err)
		}
		for _, e := range edges {
			if e.Source == path {
				linked[e.Target] = true
			}
			if e.Target == path {
				linked[e.Source] = true
			}
		}
		backlinks, _ := h.linker.Backlinks(ctx, path)
		for _, bl := range backlinks {
			linked[bl.Path] = true
		}
	}

	var suggestions []suggestionItem
	for _, r := range results {
		if linked[r.Path] {
			continue
		}
		suggestions = append(suggestions, suggestionItem{
			Target:     r.Path,
			Similarity: r.Score,
			Snippet:    r.Snippet,
		})
		if len(suggestions) >= limit {
			break
		}
	}

	return c.JSON(http.StatusOK, suggestionsResponse{
		Suggestions: suggestions,
	})
}

func parseInt(s string) (int, error) {
	var n int
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0, echo.NewHTTPError(http.StatusBadRequest, "invalid number")
		}
		n = n*10 + int(c-'0')
	}
	return n, nil
}
