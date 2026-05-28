package api

import (
	"errors"
	"net/http"

	"github.com/kiwifs/kiwifs/internal/tracing"
	"github.com/kiwifs/kiwifs/internal/versioning"
	"github.com/labstack/echo/v4"
)

type versionsResponse struct {
	Path     string               `json:"path"`
	Versions []versioning.Version `json:"versions"`
}

// Versions godoc
//
//	@Summary		Get version log for a file
//	@Description	Returns a list of historical versions/commits for the specified file path.
//	@Tags			versions
//	@Security		BearerAuth
//	@Param			path	query		string	true	"Path of the file (must start with '/')"
//	@Success		200		{object}	versionsResponse
//	@Failure		400		{object}	map[string]string
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/versions [get]
func (h *Handlers) Versions(c echo.Context) error {
	path, err := requirePath(c)
	if err != nil {
		return err
	}
	versions, err := h.versioner.Log(c.Request().Context(), path)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	if versions == nil {
		versions = []versioning.Version{}
	}
	tracing.Record(c.Request().Context(), tracing.Event{Kind: tracing.KindVersions, Path: path, HitCount: len(versions)})
	return c.JSON(http.StatusOK, versionsResponse{Path: path, Versions: versions})
}

// Version godoc
//
//	@Summary		View a specific file version
//	@Description	Returns the file content at a specific version (commit hash).
//	@Tags			versions
//	@Security		BearerAuth
//	@Param			path	query		string	true	"Path of the file (must start with '/')"
//	@Param			version	query		string	true	"Version sequence/commit hash"
//	@Success		200		{string}	string	"File content at the specified version"
//	@Failure		400		{object}	map[string]string
//	@Failure		404		{object}	map[string]string
//	@Router			/api/kiwi/version [get]
func (h *Handlers) Version(c echo.Context) error {
	path := c.QueryParam("path")
	hash := c.QueryParam("version")
	if path == "" || hash == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "path and version are required")
	}
	content, err := h.versioner.Show(c.Request().Context(), path, hash)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "version not found")
	}
	return c.Blob(http.StatusOK, "text/markdown; charset=utf-8", content)
}

// Diff godoc
//
//	@Summary		Get diff between two versions
//	@Description	Returns a standard diff for a file between two commit hashes/versions.
//	@Tags			versions
//	@Security		BearerAuth
//	@Param			path	query		string	true	"Path of the file (must start with '/')"
//	@Param			from	query		string	true	"Source version/commit hash"
//	@Param			to		query		string	true	"Target version/commit hash"
//	@Success		200		{string}	string	"Raw diff string"
//	@Failure		400		{object}	map[string]string
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/diff [get]
func (h *Handlers) Diff(c echo.Context) error {
	path := c.QueryParam("path")
	from := c.QueryParam("from")
	to := c.QueryParam("to")
	if path == "" || from == "" || to == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "path, from, and to are required")
	}
	diff, err := h.versioner.Diff(c.Request().Context(), path, from, to)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.String(http.StatusOK, diff)
}

type blameResponse struct {
	Path  string                 `json:"path"`
	Lines []versioning.BlameLine `json:"lines"`
}

// Blame godoc
//
//	@Summary		Get line-by-line blame details
//	@Description	Returns line-by-line git blame information for the specified file.
//	@Tags			versions
//	@Security		BearerAuth
//	@Param			path	query		string	true	"Path of the file (must start with '/')"
//	@Success		200		{object}	blameResponse
//	@Failure		400		{object}	map[string]string
//	@Failure		500		{object}	map[string]string
//	@Failure		501		{object}	map[string]string
//	@Router			/api/kiwi/blame [get]
func (h *Handlers) Blame(c echo.Context) error {
	path, err := requirePath(c)
	if err != nil {
		return err
	}
	lines, err := h.versioner.Blame(c.Request().Context(), path)
	if err != nil {
		if errors.Is(err, versioning.ErrBlameUnsupported) {
			return echo.NewHTTPError(http.StatusNotImplemented, err.Error())
		}
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	if lines == nil {
		lines = []versioning.BlameLine{}
	}
	return c.JSON(http.StatusOK, blameResponse{Path: path, Lines: lines})
}
