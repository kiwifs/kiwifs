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

// Publish sets `published: true` and `published_at` in the page frontmatter.
// POST /api/kiwi/publish
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

// Unpublish sets `published: false` in the page frontmatter, preserving published_at.
// POST /api/kiwi/unpublish
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

// PublishBulk sets `published: true` on many markdown pages with one pipeline BulkWrite.
// POST /api/kiwi/publish/bulk
func (h *Handlers) PublishBulk(c echo.Context) error {
	return h.publishBulk(c, true)
}

// UnpublishBulk sets `published: false` on many markdown pages with one pipeline BulkWrite.
// POST /api/kiwi/unpublish/bulk
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

// PublishStatus returns the publish metadata for a page.
// GET /api/kiwi/publish/status?path=...
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

// PublishedPages returns every Markdown page whose frontmatter has published: true.
// GET /api/kiwi/publish/list
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
