package api

import (
	"context"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/kiwifs/kiwifs/internal/markdown"
	"github.com/kiwifs/kiwifs/internal/rbac"
	"github.com/kiwifs/kiwifs/internal/storage"
	"github.com/labstack/echo/v4"
)

type publishRequest struct {
	Path string `json:"path"`
}

type publishBulkRequest struct {
	Paths []string `json:"paths"`
}

type publishResponse struct {
	Path        string `json:"path"`
	Published   bool   `json:"published"`
	PublishedAt string `json:"published_at,omitempty"`
	PublicURL   string `json:"public_url,omitempty"`
}

type publishBulkError struct {
	Path  string `json:"path"`
	Error string `json:"error"`
}

type publishBulkFile = struct {
	Path    string
	Content []byte
}

type publishBulkResponse struct {
	Published bool               `json:"published"`
	Requested int                `json:"requested"`
	Changed   int                `json:"changed"`
	Skipped   int                `json:"skipped"`
	Paths     []publishResponse  `json:"paths"`
	Errors    []publishBulkError `json:"errors,omitempty"`
}

type publishStatusResponse struct {
	Path        string `json:"path"`
	Published   bool   `json:"published"`
	PublishedAt string `json:"published_at,omitempty"`
	PublicURL   string `json:"public_url,omitempty"`
	ViewCount   int    `json:"view_count"`
}

type publishedPage struct {
	Path        string `json:"path"`
	PublishedAt string `json:"published_at,omitempty"`
	PublicURL   string `json:"public_url"`
}

type publishedPagesResponse struct {
	Count int             `json:"count"`
	Pages []publishedPage `json:"pages"`
}

// Publish godoc
//
//	@Summary		Publish a page
//	@Description	Sets published: true and sets/updates published_at in the page's markdown frontmatter. Writes changes to git repository.
//	@Tags			publish
//	@Security		BearerAuth
//	@Param			X-Actor	header		string			false	"Actor identity performing the operation"
//	@Param			body	body		publishRequest	true	"Page path to publish"
//	@Success		200		{object}	publishResponse
//	@Failure		400		{object}	map[string]string
//	@Failure		404		{object}	map[string]string
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/publish [post]
func (h *Handlers) Publish(c echo.Context) error {
	var req publishRequest
	if err := bindJSON(c, &req); err != nil {
		return err
	}
	if req.Path == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "path is required")
	}

	ctx := c.Request().Context()
	content, err := readFileOr404(ctx, h.store, req.Path)
	if err != nil {
		return err
	}

	// Set published: true
	content, err = markdown.SetFrontmatterField(content, "published", true)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to update frontmatter: "+err.Error())
	}

	// Set published_at only if not already present (preserve original publish date).
	existingAt := rbac.PagePublishedAt(content)
	now := time.Now().UTC()
	if existingAt == nil {
		content, err = markdown.SetFrontmatterField(content, "published_at", now)
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to set published_at: "+err.Error())
		}
	} else {
		now = *existingAt
	}

	// Write back through the pipeline (triggers search index, webhooks, events).
	actor := sanitizeActor(c.Request().Header.Get("X-Actor"))
	if _, err := h.pipe.Write(ctx, req.Path, content, actor); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "write failed: "+err.Error())
	}

	return c.JSON(http.StatusOK, publishResponse{
		Path:        req.Path,
		Published:   true,
		PublishedAt: now.Format(time.RFC3339),
		PublicURL:   "/p/" + req.Path,
	})
}

// Unpublish godoc
//
//	@Summary		Unpublish a page
//	@Description	Sets published: false in the page's markdown frontmatter. Preserves existing published_at if present. Writes changes to git repository.
//	@Tags			publish
//	@Security		BearerAuth
//	@Param			X-Actor	header		string			false	"Actor identity performing the operation"
//	@Param			body	body		publishRequest	true	"Page path to unpublish"
//	@Success		200		{object}	publishResponse
//	@Failure		400		{object}	map[string]string
//	@Failure		404		{object}	map[string]string
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/unpublish [post]
func (h *Handlers) Unpublish(c echo.Context) error {
	var req publishRequest
	if err := bindJSON(c, &req); err != nil {
		return err
	}
	if req.Path == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "path is required")
	}

	ctx := c.Request().Context()
	content, err := readFileOr404(ctx, h.store, req.Path)
	if err != nil {
		return err
	}

	// Set published: false
	content, err = markdown.SetFrontmatterField(content, "published", false)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to update frontmatter: "+err.Error())
	}

	// Write back through the pipeline.
	actor := sanitizeActor(c.Request().Header.Get("X-Actor"))
	if _, err := h.pipe.Write(ctx, req.Path, content, actor); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "write failed: "+err.Error())
	}

	return c.JSON(http.StatusOK, publishResponse{
		Path:      req.Path,
		Published: false,
	})
}

// PublishBulk godoc
//
//	@Summary		Bulk publish pages
//	@Description	Bulk-publishes multiple markdown pages in a single transaction/commit.
//	@Tags			publish
//	@Security		BearerAuth
//	@Param			X-Actor	header		string				false	"Actor identity performing the operation"
//	@Param			body	body		publishBulkRequest	true	"List of page paths to publish"
//	@Success		200		{object}	publishBulkResponse
//	@Failure		400		{object}	map[string]string
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/publish/bulk [post]
func (h *Handlers) PublishBulk(c echo.Context) error {
	return h.publishBulk(c, true)
}

// UnpublishBulk godoc
//
//	@Summary		Bulk unpublish pages
//	@Description	Bulk-unpublishes multiple markdown pages in a single transaction/commit.
//	@Tags			publish
//	@Security		BearerAuth
//	@Param			X-Actor	header		string				false	"Actor identity performing the operation"
//	@Param			body	body		publishBulkRequest	true	"List of page paths to unpublish"
//	@Success		200		{object}	publishBulkResponse
//	@Failure		400		{object}	map[string]string
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/unpublish/bulk [post]
func (h *Handlers) UnpublishBulk(c echo.Context) error {
	return h.publishBulk(c, false)
}

func (h *Handlers) publishBulk(c echo.Context, publish bool) error {
	var req publishBulkRequest
	if err := bindJSON(c, &req); err != nil {
		return err
	}
	if len(req.Paths) == 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "paths is required")
	}

	ctx := c.Request().Context()
	actor := sanitizeActor(c.Request().Header.Get("X-Actor"))
	now := time.Now().UTC()
	seen := make(map[string]struct{}, len(req.Paths))
	files := make([]publishBulkFile, 0, len(req.Paths))
	responses := make([]publishResponse, 0, len(req.Paths))
	errors := make([]publishBulkError, 0)

	for _, path := range req.Paths {
		path = strings.TrimSpace(path)
		if path == "" {
			return echo.NewHTTPError(http.StatusBadRequest, "paths contains an empty path")
		}
		if _, ok := seen[path]; ok {
			continue
		}
		seen[path] = struct{}{}

		content, err := readFileOr404(ctx, h.store, path)
		if err != nil {
			errors = append(errors, publishBulkError{Path: path, Error: err.Error()})
			continue
		}
		currentlyPublished := rbac.PagePublished(content)
		if publish {
			publishedAt := rbac.PagePublishedAt(content)
			if currentlyPublished && publishedAt != nil {
				responses = append(responses, publishResponse{Path: path, Published: true, PublishedAt: publishedAt.Format(time.RFC3339), PublicURL: "/p/" + path})
				continue
			}
			content, err = markdown.SetFrontmatterField(content, "published", true)
			if err != nil {
				errors = append(errors, publishBulkError{Path: path, Error: "failed to update frontmatter: " + err.Error()})
				continue
			}
			effectiveAt := now
			if publishedAt != nil {
				effectiveAt = *publishedAt
			} else {
				content, err = markdown.SetFrontmatterField(content, "published_at", now)
				if err != nil {
					errors = append(errors, publishBulkError{Path: path, Error: "failed to set published_at: " + err.Error()})
					continue
				}
			}
			files = append(files, publishBulkFile{Path: path, Content: content})
			responses = append(responses, publishResponse{Path: path, Published: true, PublishedAt: effectiveAt.Format(time.RFC3339), PublicURL: "/p/" + path})
			continue
		}

		if !currentlyPublished {
			responses = append(responses, publishResponse{Path: path, Published: false})
			continue
		}
		content, err = markdown.SetFrontmatterField(content, "published", false)
		if err != nil {
			errors = append(errors, publishBulkError{Path: path, Error: "failed to update frontmatter: " + err.Error()})
			continue
		}
		files = append(files, publishBulkFile{Path: path, Content: content})
		responses = append(responses, publishResponse{Path: path, Published: false})
	}

	if len(files) > 0 {
		message := "publish bulk update"
		if !publish {
			message = "unpublish bulk update"
		}
		failed := h.bulkWriteTolerant(ctx, files, actor, message)
		if len(failed) > 0 {
			kept := files[:0]
			for _, f := range files {
				if err, ok := failed[f.Path]; ok {
					errors = append(errors, publishBulkError{Path: f.Path, Error: err})
					continue
				}
				kept = append(kept, f)
			}
			files = kept

			// Remove failed paths from responses so clients don't see
			// a path reported as both successful and errored.
			cleaned := responses[:0]
			for _, r := range responses {
				if _, ok := failed[r.Path]; !ok {
					cleaned = append(cleaned, r)
				}
			}
			responses = cleaned
		}
	}

	return c.JSON(http.StatusOK, publishBulkResponse{
		Published: publish,
		Requested: len(req.Paths),
		Changed:   len(files),
		Skipped:   len(seen) - len(files),
		Paths:     responses,
		Errors:    errors,
	})
}

func (h *Handlers) bulkWriteTolerant(ctx context.Context, files []publishBulkFile, actor, message string) map[string]string {
	failed := make(map[string]string)
	var writeBatch func([]publishBulkFile)
	writeBatch = func(batch []publishBulkFile) {
		if len(batch) == 0 {
			return
		}
		if _, err := h.pipe.BulkWrite(ctx, batch, actor, message); err == nil {
			return
		} else if len(batch) == 1 {
			failed[batch[0].Path] = err.Error()
			return
		}
		mid := len(batch) / 2
		writeBatch(batch[:mid])
		writeBatch(batch[mid:])
	}
	writeBatch(files)
	if len(failed) == 0 {
		return nil
	}
	return failed
}

// PublishStatus godoc
//
//	@Summary		Get publish status of a page
//	@Description	Returns the publishing metadata (is published, published time, public URL, views count) for a specific page.
//	@Tags			publish
//	@Security		BearerAuth
//	@Param			path	query		string	true	"Path of the page to check"
//	@Success		200		{object}	publishStatusResponse
//	@Failure		400		{object}	map[string]string
//	@Failure		404		{object}	map[string]string
//	@Router			/api/kiwi/publish/status [get]
func (h *Handlers) PublishStatus(c echo.Context) error {
	path, err := requirePath(c)
	if err != nil {
		return err
	}

	ctx := c.Request().Context()
	content, err := readFileOr404(ctx, h.store, path)
	if err != nil {
		return err
	}

	published := rbac.PagePublished(content)
	publishedAt := rbac.PagePublishedAt(content)

	resp := publishStatusResponse{
		Path:      path,
		Published: published,
	}

	if publishedAt != nil {
		resp.PublishedAt = publishedAt.Format(time.RFC3339)
	}

	if published {
		resp.PublicURL = "/p/" + path
	}

	// Include view count from metrics store if available.
	if h.publishMetrics != nil {
		if m := h.publishMetrics.Get(path); m != nil {
			resp.ViewCount = m.Views
		}
	}

	return c.JSON(http.StatusOK, resp)
}

// PublishedPages godoc
//
//	@Summary		List all published pages
//	@Description	Lists every page in the workspace that is currently published.
//	@Tags			publish
//	@Security		BearerAuth
//	@Success		200		{object}	publishedPagesResponse
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/publish/list [get]
func (h *Handlers) PublishedPages(c echo.Context) error {
	ctx := c.Request().Context()
	tree, err := storage.BuildTree(ctx, h.store, "/", maxTreeDepth)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	pages := make([]publishedPage, 0)
	var walk func(entries []*storage.TreeEntry) error
	walk = func(entries []*storage.TreeEntry) error {
		for _, entry := range entries {
			if entry == nil {
				continue
			}
			if entry.IsDir {
				if err := walk(entry.Children); err != nil {
					return err
				}
				continue
			}
			lower := strings.ToLower(entry.Path)
			if !strings.HasSuffix(lower, ".md") && !strings.HasSuffix(lower, ".markdown") {
				continue
			}
			content, err := readFileOr404(ctx, h.store, entry.Path)
			if err != nil {
				return err
			}
			if !rbac.PagePublished(content) {
				continue
			}
			page := publishedPage{
				Path:      entry.Path,
				PublicURL: "/p/" + entry.Path,
			}
			if publishedAt := rbac.PagePublishedAt(content); publishedAt != nil {
				page.PublishedAt = publishedAt.Format(time.RFC3339)
			}
			pages = append(pages, page)
		}
		return nil
	}

	if err := walk(tree.Children); err != nil {
		return err
	}

	sort.SliceStable(pages, func(i, j int) bool {
		if pages[i].PublishedAt == pages[j].PublishedAt {
			return pages[i].Path < pages[j].Path
		}
		return pages[i].PublishedAt > pages[j].PublishedAt
	})

	return c.JSON(http.StatusOK, publishedPagesResponse{
		Count: len(pages),
		Pages: pages,
	})
}
