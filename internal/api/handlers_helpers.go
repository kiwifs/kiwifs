package api

import (
	"context"
	"errors"
	"net/http"
	"os"

	"github.com/kiwifs/kiwifs/internal/config"
	"github.com/kiwifs/kiwifs/internal/markdown"
	"github.com/kiwifs/kiwifs/internal/pipeline"
	"github.com/kiwifs/kiwifs/internal/search"
	"github.com/kiwifs/kiwifs/internal/storage"
	"github.com/labstack/echo/v4"
)

func bindJSON(c echo.Context, v any) error {
	if err := c.Bind(v); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid JSON body")
	}
	return nil
}

func requirePath(c echo.Context) (string, error) {
	path := c.QueryParam("path")
	if path == "" {
		return "", echo.NewHTTPError(http.StatusBadRequest, "path is required")
	}
	return path, nil
}

// sanitizeActor normalizes an actor for use in git env vars and frontmatter,
// falling back to "anonymous" when the caller supplied nothing usable.
func sanitizeActor(raw string) string {
	if s := pipeline.NormalizeActor(raw); s != "" {
		return s
	}
	return "anonymous"
}

func readFileOr404(ctx context.Context, store storage.Storage, path string) ([]byte, error) {
	content, err := store.Read(ctx, path)
	if err != nil {
		if errors.Is(err, storage.ErrPathDenied) {
			return nil, echo.NewHTTPError(http.StatusBadRequest, err.Error())
		}
		if os.IsNotExist(err) {
			return nil, echo.NewHTTPError(http.StatusNotFound, "file not found")
		}
		return nil, echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return content, nil
}

// storageErrToHTTP maps storage-layer errors to the correct HTTP status.
// Use this in any handler that calls storage directly (Write, Delete, List, etc.).
func storageErrToHTTP(err error) *echo.HTTPError {
	if errors.Is(err, storage.ErrPathDenied) {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	if os.IsNotExist(err) {
		return echo.NewHTTPError(http.StatusNotFound, "not found")
	}
	return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
}

func extractFrontmatter(content []byte) map[string]any {
	fm, err := markdown.Frontmatter(content)
	if err != nil || fm == nil {
		return map[string]any{}
	}
	return sanitizeMapForJSON(fm)
}

// sanitizeMapForJSON recursively converts map[interface{}]interface{} (produced
// by yaml.v2 / goldmark-meta) into map[string]any so encoding/json can handle it.
func sanitizeMapForJSON(m map[string]any) map[string]any {
	for k, v := range m {
		m[k] = sanitizeValueForJSON(v)
	}
	return m
}

func sanitizeValueForJSON(v any) any {
	switch val := v.(type) {
	case map[interface{}]interface{}:
		clean := make(map[string]any, len(val))
		for mk, mv := range val {
			key, _ := mk.(string)
			clean[key] = sanitizeValueForJSON(mv)
		}
		return clean
	case map[string]interface{}:
		return sanitizeMapForJSON(val)
	case []interface{}:
		for i, item := range val {
			val[i] = sanitizeValueForJSON(item)
		}
		return val
	default:
		return v
	}
}

func buildSearchEntries(results []search.Result, publicURL string) []searchResultEntry {
	entries := make([]searchResultEntry, len(results))
	for i, r := range results {
		entries[i] = searchResultEntry{
			Path:      r.Path,
			Matches:   r.Matches,
			Score:     r.Score,
			Snippet:   r.Snippet,
			Permalink: config.Permalink(publicURL, r.Path),
		}
	}
	return entries
}
