package api

import (
	"context"
	"errors"
	"net/http"
	"os"
	pathpkg "path"
	"path/filepath"
	"strings"
	"time"

	"github.com/kiwifs/kiwifs/internal/pipeline"
	"github.com/kiwifs/kiwifs/internal/rbac"
	"github.com/labstack/echo/v4"
)

type createShareRequest struct {
	Path      string `json:"path"`
	ExpiresIn string `json:"expiresIn,omitempty"`
	Password  string `json:"password,omitempty"`
}

type revokeShareResponse struct {
	Revoked string `json:"revoked"`
}

// CreateShareLink godoc
//
//	@Summary		Create a share link
//	@Description	Creates a password-protected or open public share link for a given file path.
//	@Tags			share
//	@Security		BearerAuth
//	@Param			X-Actor	header		string				false	"Actor identity performing the operation"
//	@Param			body	body		createShareRequest	true	"Share creation details"
//	@Success		200		{object}	rbac.ShareLink
//	@Failure		400		{object}	map[string]string
//	@Failure		404		{object}	map[string]string
//	@Failure		500		{object}	map[string]string
//	@Failure		501		{object}	map[string]string
//	@Router			/api/kiwi/share [post]
func (h *Handlers) CreateShareLink(c echo.Context) error {
	if h.shares == nil {
		return echo.NewHTTPError(http.StatusNotImplemented, "share links not enabled")
	}
	var req createShareRequest
	if err := bindJSON(c, &req); err != nil {
		return err
	}
	if req.Path == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "path is required")
	}
	if !h.store.Exists(c.Request().Context(), req.Path) {
		return echo.NewHTTPError(http.StatusNotFound, "file not found")
	}

	var dur time.Duration
	if req.ExpiresIn != "" {
		d, err := time.ParseDuration(req.ExpiresIn)
		if err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "invalid expiresIn duration")
		}
		dur = d
	}
	actor := sanitizeActor(c.Request().Header.Get("X-Actor"))
	if actor == "anonymous" {
		actor = pipeline.DefaultActor
	}

	link, err := h.shares.Create(req.Path, actor, dur, req.Password)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.JSON(http.StatusOK, link)
}

// ListShareLinks godoc
//
//	@Summary		List share links for a path
//	@Description	Returns all active share links associated with the specified file path.
//	@Tags			share
//	@Security		BearerAuth
//	@Param			path	query		string	true	"File path to list share links for"
//	@Success		200		{array}		rbac.ShareLink
//	@Failure		400		{object}	map[string]string
//	@Failure		500		{object}	map[string]string
//	@Failure		501		{object}	map[string]string
//	@Router			/api/kiwi/share [get]
func (h *Handlers) ListShareLinks(c echo.Context) error {
	if h.shares == nil {
		return echo.NewHTTPError(http.StatusNotImplemented, "share links not enabled")
	}
	path, err := requirePath(c)
	if err != nil {
		return err
	}
	links, err := h.shares.ListForPath(path)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	if links == nil {
		links = []*rbac.ShareLink{}
	}
	return c.JSON(http.StatusOK, links)
}

// RevokeShareLink godoc
//
//	@Summary		Revoke a share link
//	@Description	Deletes/revokes an active share link by its ID.
//	@Tags			share
//	@Security		BearerAuth
//	@Param			id	path		string	true	"Share link ID"
//	@Success		200	{object}	revokeShareResponse
//	@Failure		400	{object}	map[string]string
//	@Failure		404	{object}	map[string]string
//	@Failure		501	{object}	map[string]string
//	@Router			/api/kiwi/share/{id} [delete]
func (h *Handlers) RevokeShareLink(c echo.Context) error {
	if h.shares == nil {
		return echo.NewHTTPError(http.StatusNotImplemented, "share links not enabled")
	}
	id := c.Param("id")
	if id == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "id is required")
	}
	if err := h.shares.Revoke(id); err != nil {
		return echo.NewHTTPError(http.StatusNotFound, err.Error())
	}
	return c.JSON(http.StatusOK, revokeShareResponse{Revoked: id})
}

// PublicPage godoc
//
//	@Summary		Access a public shared page
//	@Description	Retrieves the content of a file via a public share token. Requires X-Share-Password or password query parameter if password protected.
//	@Tags			share
//	@Param			token				path		string	true	"Share token"
//	@Param			password			query		string	false	"Optional password for password-protected shares"
//	@Param			X-Share-Password	header		string	false	"Optional password for password-protected shares via header"
//	@Success		200					{file}		string			"Raw file contents"
//	@Failure		400					{object}	map[string]string
//	@Failure		401					{object}	map[string]string
//	@Failure		404					{object}	map[string]string
//	@Failure		500					{object}	map[string]string
//	@Router			/api/kiwi/public/{token} [get]
func (h *Handlers) PublicPage(c echo.Context) error {
	if h.shares == nil {
		return echo.NewHTTPError(http.StatusNotFound, "not found")
	}
	token := c.Param("token")
	if token == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "token is required")
	}
	password := c.QueryParam("password")
	if password == "" {
		password = c.Request().Header.Get("X-Share-Password")
	}
	link, err := h.shares.Resolve(token, password)
	if errors.Is(err, rbac.ErrInvalidPassword) {
		c.Response().Header().Set(echo.HeaderWWWAuthenticate, `Basic realm="kiwifs-share"`)
		return echo.NewHTTPError(http.StatusUnauthorized, "password required")
	}
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	if link == nil {
		return echo.NewHTTPError(http.StatusNotFound, "link not found or expired")
	}

	content, err := readFileOr404(c.Request().Context(), h.store, link.Path)
	if err != nil {
		return err
	}
	return c.Blob(http.StatusOK, detectContentType(link.Path, content), content)
}

// PublicFile godoc
//
//	@Summary		Access a public file/asset
//	@Description	Serves a file publicly if it is explicitly set to public, published, or if it inherits public access from a parent/sibling page.
//	@Tags			share
//	@Param			path	query		string	true	"Path to the public file/asset"
//	@Success		200		{file}		string			"Raw file contents"
//	@Failure		400		{object}	map[string]string
//	@Failure		404		{object}	map[string]string
//	@Router			/api/kiwi/public/file [get]
func (h *Handlers) PublicFile(c echo.Context) error {
	raw := c.QueryParam("path")
	if raw == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "path is required")
	}
	cleaned := pathpkg.Clean("/" + raw)
	if cleaned == "/" || strings.HasPrefix(cleaned, "/..") {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid path")
	}
	cleaned = strings.TrimPrefix(cleaned, "/")

	ctx := c.Request().Context()
	content, err := h.store.Read(ctx, cleaned)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "not found")
	}

	ext := strings.ToLower(filepath.Ext(cleaned))
	isMarkdown := ext == ".md" || ext == ".markdown"

	if isMarkdown {
		if rbac.PageVisibility(content) != rbac.VisibilityPublic && !rbac.PagePublished(content) {
			return echo.NewHTTPError(http.StatusNotFound, "not found")
		}
		if h.publishMetrics != nil && rbac.PagePublished(content) {
			h.publishMetrics.Increment(cleaned)
		}
	} else {
		// Non-markdown asset (image, PDF, etc.): serve if a sibling or
		// ancestor-directory markdown page is published or visibility:public.
		// This follows the Hugo page-bundle / Obsidian Publish pattern where
		// co-located assets inherit the access level of their parent page.
		if !h.hasPublicSibling(ctx, cleaned) {
			return echo.NewHTTPError(http.StatusNotFound, "not found")
		}
	}

	return c.Blob(http.StatusOK, detectContentType(cleaned, content), content)
}

// hasPublicSibling walks the directory hierarchy from the asset's parent dir
// up to the root, checking if any sibling .md file is published or
// visibility:public. This enables co-located assets (images alongside
// markdown) to be served publicly without requiring frontmatter on each asset.
func (h *Handlers) hasPublicSibling(ctx context.Context, assetPath string) bool {
	dir := pathpkg.Dir(assetPath)
	for {
		entries, err := h.store.List(ctx, dir)
		if err != nil {
			break
		}
		for _, e := range entries {
			if e.IsDir {
				continue
			}
			ext := strings.ToLower(filepath.Ext(e.Path))
			if ext != ".md" && ext != ".markdown" {
				continue
			}
			mdContent, err := h.store.Read(ctx, e.Path)
			if err != nil {
				continue
			}
			if rbac.PageVisibility(mdContent) == rbac.VisibilityPublic || rbac.PagePublished(mdContent) {
				return true
			}
		}
		if dir == "." || dir == "" || dir == "/" {
			break
		}
		dir = pathpkg.Dir(dir)
	}
	return false
}

// PublicTree godoc
//
//	@Summary		Get public file tree
//	@Description	Returns the tree hierarchy of all public/published documents.
//	@Tags			share
//	@Param			path	query		string	false	"Base path to build tree from (default /)"
//	@Param			filter	query		string	false	"Filter ('published' to show only published pages)"
//	@Success		200		{object}	treeEntry
//	@Failure		404		{object}	map[string]string
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/public/tree [get]
func (h *Handlers) PublicTree(c echo.Context) error {
	path := c.QueryParam("path")
	if path == "" {
		path = "/"
	}
	filter := c.QueryParam("filter") // "published" to only show published pages
	tree, err := h.buildPublicTree(c.Request().Context(), path, maxTreeDepth, filter)
	if err != nil {
		if os.IsNotExist(err) {
			return echo.NewHTTPError(http.StatusNotFound, "path not found")
		}
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.JSON(http.StatusOK, tree)
}

func (h *Handlers) buildPublicTree(ctx context.Context, path string, depth int, filter string) (*treeEntry, error) {
	entries, err := h.store.List(ctx, path)
	if err != nil {
		return nil, err
	}

	cleanPath := strings.Trim(path, "/")
	displayName := filepath.Base(cleanPath)
	if cleanPath == "" {
		displayName = "/"
	}
	root := &treeEntry{
		Path:  cleanPath,
		Name:  displayName,
		IsDir: true,
	}

	for _, e := range entries {
		if e.IsDir {
			if depth > 0 {
				sub, err := h.buildPublicTree(ctx, e.Path, depth-1, filter)
				if err == nil && len(sub.Children) > 0 {
					child := &treeEntry{
						Path:     e.Path,
						Name:     e.Name,
						IsDir:    true,
						Children: sub.Children,
					}
					root.Children = append(root.Children, child)
				}
			}
			continue
		}
		content, rerr := h.store.Read(ctx, e.Path)
		if rerr != nil {
			continue
		}

		isPublic := rbac.PageVisibility(content) == rbac.VisibilityPublic
		isPublished := rbac.PagePublished(content)

		// Apply filter: if filter=published, only show published pages.
		if filter == "published" {
			if !isPublished {
				continue
			}
		} else {
			// Default: show pages that are public OR published.
			if !isPublic && !isPublished {
				continue
			}
		}

		root.Children = append(root.Children, &treeEntry{
			Path: e.Path,
			Name: e.Name,
			Size: e.Size,
		})
	}
	return root, nil
}
