package api

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/kiwifs/kiwifs/internal/comments"
	"github.com/kiwifs/kiwifs/internal/events"
	"github.com/kiwifs/kiwifs/internal/janitor"
	"github.com/kiwifs/kiwifs/internal/pipeline"
	"github.com/labstack/echo/v4"
)

type templateEntry struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

type templatesResponse struct {
	Templates []templateEntry `json:"templates"`
}

// ListTemplates godoc
//
//	@Summary		List templates
//	@Description	Lists markdown templates found in the .kiwi/templates directory.
//	@Tags			templates
//	@Security		BearerAuth
//	@Success		200		{object}	templatesResponse
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/templates [get]
func (h *Handlers) ListTemplates(c echo.Context) error {
	dir := filepath.Join(h.root, ".kiwi", "templates")
	out := []templateEntry{}
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		return c.JSON(http.StatusOK, templatesResponse{Templates: out})
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".md") {
			continue
		}
		name := strings.TrimSuffix(e.Name(), ".md")
		out = append(out, templateEntry{Name: name, Path: filepath.Join(".kiwi/templates", e.Name())})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return c.JSON(http.StatusOK, templatesResponse{Templates: out})
}

type templateBody struct {
	Name    string `json:"name"`
	Content string `json:"content"`
}

// ReadTemplate godoc
//
//	@Summary		Read template content
//	@Description	Reads the contents of a specific markdown template by name.
//	@Tags			templates
//	@Security		BearerAuth
//	@Param			name	query		string	true	"Template name (without .md extension)"
//	@Success		200		{object}	templateBody
//	@Failure		400		{object}	map[string]string
//	@Failure		404		{object}	map[string]string
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/template [get]
func (h *Handlers) ReadTemplate(c echo.Context) error {
	name := c.QueryParam("name")
	if name == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "name is required")
	}
	if strings.ContainsAny(name, "/\\") || strings.Contains(name, "..") {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid template name")
	}
	p := filepath.Join(h.root, ".kiwi", "templates", name+".md")
	content, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return echo.NewHTTPError(http.StatusNotFound, "template not found")
		}
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.JSON(http.StatusOK, templateBody{Name: name, Content: string(content)})
}

type commentsResponse struct {
	Path     string             `json:"path"`
	Comments []comments.Comment `json:"comments"`
}

type commentBody struct {
	Anchor comments.Anchor `json:"anchor"`
	Body   string          `json:"body"`
	Author string          `json:"author,omitempty"`
}

// ListComments godoc
//
//	@Summary		List comments for a file
//	@Description	Returns all inline comments (both active and resolved) attached to a specific file path.
//	@Tags			comments
//	@Security		BearerAuth
//	@Param			path	query		string	true	"File path to list comments for"
//	@Success		200		{object}	commentsResponse
//	@Failure		400		{object}	map[string]string
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/comments [get]
func (h *Handlers) ListComments(c echo.Context) error {
	path, err := requirePath(c)
	if err != nil {
		return err
	}
	list, err := h.comments.List(path)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.JSON(http.StatusOK, commentsResponse{Path: path, Comments: list})
}

// AddComment godoc
//
//	@Summary		Add a comment to a file
//	@Description	Adds a new inline comment at a specific anchor position within a file path. Automatically commits the changes.
//	@Tags			comments
//	@Security		BearerAuth
//	@Param			path	query		string		true	"File path to add the comment to"
//	@Param			X-Actor	header		string		false	"Actor identity performing the operation"
//	@Param			body	body		commentBody	true	"Comment details"
//	@Success		200		{object}	comments.Comment
//	@Failure		400		{object}	map[string]string
//	@Router			/api/kiwi/comments [post]
func (h *Handlers) AddComment(c echo.Context) error {
	path, err := requirePath(c)
	if err != nil {
		return err
	}
	var body commentBody
	if err := bindJSON(c, &body); err != nil {
		return err
	}
	actor := sanitizeActor(body.Author)
	if actor == "anonymous" {
		actor = sanitizeActor(c.Request().Header.Get("X-Actor"))
	}
	if actor == "anonymous" {
		actor = pipeline.DefaultActor
	}
	record, err := h.comments.Add(path, comments.Comment{
		Anchor: body.Anchor,
		Body:   body.Body,
		Author: actor,
	})
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	jsonPath := h.comments.FilePath(path)
	if cerr := h.versioner.Commit(c.Request().Context(), jsonPath, actor, fmt.Sprintf("comment: %s — %s", path, shortID(record.ID))); cerr != nil {
		log.Printf("handlers: commit comment %s: %v", path, cerr)
	}
	if h.hub != nil {
		h.hub.Broadcast(events.Event{Op: "comment.add", Path: path, Actor: actor})
	}
	return c.JSON(http.StatusOK, record)
}

// DeleteComment godoc
//
//	@Summary		Delete a comment
//	@Description	Deletes a specific inline comment by ID from a file path. Automatically commits the changes.
//	@Tags			comments
//	@Security		BearerAuth
//	@Param			id		path		string	true	"Comment ID"
//	@Param			path	query		string	true	"File path the comment is attached to"
//	@Param			X-Actor	header		string	false	"Actor identity performing the operation"
//	@Success		200		{object}	map[string]string
//	@Failure		400		{object}	map[string]string
//	@Failure		404		{object}	map[string]string
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/comments/{id} [delete]
func (h *Handlers) DeleteComment(c echo.Context) error {
	id := c.Param("id")
	path := c.QueryParam("path")
	if path == "" || id == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "path and id are required")
	}
	actor := sanitizeActor(c.Request().Header.Get("X-Actor"))
	if actor == "anonymous" {
		actor = pipeline.DefaultActor
	}
	if err := h.comments.Delete(path, id); err != nil {
		if os.IsNotExist(err) {
			return echo.NewHTTPError(http.StatusNotFound, "comment not found")
		}
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	jsonPath := h.comments.FilePath(path)
	if cerr := h.versioner.Commit(c.Request().Context(), jsonPath, actor, fmt.Sprintf("comment-delete: %s — %s", path, shortID(id))); cerr != nil {
		log.Printf("handlers: commit comment-delete %s: %v", path, cerr)
	}
	if h.hub != nil {
		h.hub.Broadcast(events.Event{Op: "comment.delete", Path: path, Actor: actor})
	}
	return c.JSON(http.StatusOK, map[string]string{"deleted": id, "path": path})
}

type resolveCommentBody struct {
	Resolved bool `json:"resolved"`
}

// ResolveComment godoc
//
//	@Summary		Resolve or unresolve a comment
//	@Description	Sets the resolution status (resolved or unresolved) of a specific inline comment by ID. Automatically commits the changes.
//	@Tags			comments
//	@Security		BearerAuth
//	@Param			id		path		string				true	"Comment ID"
//	@Param			path	query		string				true	"File path the comment is attached to"
//	@Param			X-Actor	header		string				false	"Actor identity performing the operation"
//	@Param			body	body		resolveCommentBody	true	"Resolution state"
//	@Success		200		{object}	comments.Comment
//	@Failure		400		{object}	map[string]string
//	@Failure		404		{object}	map[string]string
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/comments/{id} [patch]
func (h *Handlers) ResolveComment(c echo.Context) error {
	id := c.Param("id")
	path := c.QueryParam("path")
	if path == "" || id == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "path and id are required")
	}
	actor := sanitizeActor(c.Request().Header.Get("X-Actor"))
	if actor == "anonymous" {
		actor = pipeline.DefaultActor
	}

	var body resolveCommentBody
	if err := bindJSON(c, &body); err != nil {
		return err
	}

	updated, err := h.comments.Resolve(path, id, body.Resolved)
	if err != nil {
		if os.IsNotExist(err) {
			return echo.NewHTTPError(http.StatusNotFound, "comment not found")
		}
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	jsonPath := h.comments.FilePath(path)
	verb := "resolve"
	if !body.Resolved {
		verb = "unresolve"
	}
	if cerr := h.versioner.Commit(c.Request().Context(), jsonPath, actor, fmt.Sprintf("comment-%s: %s — %s", verb, path, shortID(id))); cerr != nil {
		log.Printf("handlers: commit comment-%s %s: %v", verb, path, cerr)
	}
	if h.hub != nil {
		h.hub.Broadcast(events.Event{Op: "comment.resolve", Path: path, Actor: actor})
	}
	return c.JSON(http.StatusOK, updated)
}

func shortID(id string) string {
	if len(id) > 8 {
		return id[:8]
	}
	return id
}

var customCSSScriptTag = regexp.MustCompile(`(?is)<script\b[^>]*>.*?</script>`)

func sanitizeCustomCSS(css string) string {
	return customCSSScriptTag.ReplaceAllString(css, "")
}

func (h *Handlers) customCSSRelPath() string {
	rel := strings.TrimSpace(h.ui.CustomCSS)
	if rel == "" {
		return ".kiwi/custom.css"
	}
	rel = filepath.ToSlash(filepath.Clean(rel))
	if filepath.IsAbs(rel) || strings.Contains(rel, "..") {
		return ".kiwi/custom.css"
	}
	return rel
}

// GetCustomCSS godoc
//
//	@Summary		Get custom CSS overrides
//	@Description	Reads and returns the workspace custom CSS file configured via [ui] custom_css (default .kiwi/custom.css). Returns empty body if the file does not exist. Script tags are stripped.
//	@Tags			theme
//	@Security		BearerAuth
//	@Produce		text/css
//	@Success		200		{string}	string
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/custom.css [get]
func (h *Handlers) GetCustomCSS(c echo.Context) error {
	p := filepath.Join(h.root, h.customCSSRelPath())
	data, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return c.String(http.StatusOK, "")
		}
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	c.Response().Header().Set("Content-Type", "text/css; charset=utf-8")
	return c.String(http.StatusOK, sanitizeCustomCSS(string(data)))
}

// GetTheme godoc
//
//	@Summary		Get theme configuration
//	@Description	Reads and returns the theme configuration from .kiwi/theme.json. Returns empty object if file does not exist.
//	@Tags			theme
//	@Security		BearerAuth
//	@Success		200		{object}	map[string]any
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/theme [get]
func (h *Handlers) GetTheme(c echo.Context) error {
	p := filepath.Join(h.root, ".kiwi", "theme.json")
	data, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return c.JSON(http.StatusOK, map[string]any{})
		}
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	var theme map[string]any
	if err := json.Unmarshal(data, &theme); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "invalid theme.json")
	}
	return c.JSON(http.StatusOK, theme)
}

type sidebarSectionResponse struct {
	Label string   `json:"label"`
	Paths []string `json:"paths"`
}

type sidebarConfigResponse struct {
	Pinned   []string                 `json:"pinned"`
	Hidden   []string                 `json:"hidden"`
	Sections []sidebarSectionResponse `json:"sections"`
}

type uiConfigResponse struct {
	ThemeLocked bool                  `json:"themeLocked"`
	StartPage   string                `json:"startPage"`
	Sidebar     sidebarConfigResponse `json:"sidebar"`
}

// UIConfig godoc
//
//	@Summary		Get UI configuration
//	@Description	Returns current UI configurations, including whether theme editing is locked.
//	@Tags			theme
//	@Security		BearerAuth
//	@Success		200		{object}	uiConfigResponse
//	@Router			/api/kiwi/ui-config [get]
func (h *Handlers) UIConfig(c echo.Context) error {
	sections := make([]sidebarSectionResponse, 0, len(h.ui.Sidebar.ResolvedSections()))
	for _, sec := range h.ui.Sidebar.ResolvedSections() {
		sections = append(sections, sidebarSectionResponse{
			Label: sec.Label,
			Paths: sec.Paths,
		})
	}
	pinned := h.ui.Sidebar.Pinned
	if pinned == nil {
		pinned = []string{}
	}
	hidden := h.ui.Sidebar.Hidden
	if hidden == nil {
		hidden = []string{}
	}
	return c.JSON(http.StatusOK, uiConfigResponse{
		ThemeLocked: h.ui.ThemeLocked,
		StartPage:   h.ui.ResolvedStartPage(),
		Sidebar: sidebarConfigResponse{
			Pinned:   pinned,
			Hidden:   hidden,
			Sections: sections,
		},
	})
}

// Janitor godoc
//
//	@Summary		Run janitor scan
//	@Description	Runs or returns the cached result of a janitor scan over the workspace files to identify issues like stale files, orphans, broken links, etc.
//	@Tags			janitor
//	@Security		BearerAuth
//	@Param			staleDays	query		int		false	"Number of days after which a file is considered stale (defaults to system setting or 90)"
//	@Param			fresh		query		bool	false	"If true, bypasses the cached result and triggers a fresh scan"
//	@Success		200			{object}	janitor.ScanResult
//	@Failure		500			{object}	map[string]string
//	@Router			/api/kiwi/janitor [get]
func (h *Handlers) Janitor(c echo.Context) error {
	defaultStale := h.janitorStaleDays
	if defaultStale <= 0 {
		defaultStale = janitor.DefaultStaleDays
	}
	staleDays := parseIntParam(c, "staleDays", defaultStale)
	fresh := c.QueryParam("fresh") == "1" || c.QueryParam("fresh") == "true"

	if !fresh && h.janitorSched != nil && staleDays == defaultStale {
		if cached := h.janitorSched.LastResult(); cached != nil {
			if ls := h.janitorSched.LastScan(); !ls.IsZero() {
				c.Response().Header().Set("X-Kiwi-Janitor-LastScan", ls.UTC().Format(time.RFC3339))
			}
			return c.JSON(http.StatusOK, cached)
		}
	}

	scanner := janitor.New(h.root, h.store, h.searcher, staleDays)
	result, err := scanner.Scan(c.Request().Context())
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.JSON(http.StatusOK, result)
}

// PutTheme godoc
//
//	@Summary		Update theme configuration
//	@Description	Updates the theme configuration in .kiwi/theme.json. Maximum payload size is 64KB. Automatically commits the changes.
//	@Tags			theme
//	@Security		BearerAuth
//	@Param			X-Actor	header		string			false	"Actor identity performing the operation"
//	@Param			body	body		map[string]any	true	"Theme configuration JSON"
//	@Success		200		{object}	map[string]any
//	@Failure		400		{object}	map[string]string
//	@Failure		403		{object}	map[string]string
//	@Failure		413		{object}	map[string]string
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/theme [put]
func (h *Handlers) PutTheme(c echo.Context) error {
	if h.ui.ThemeLocked {
		return echo.NewHTTPError(http.StatusForbidden, "theme editing is locked by admin")
	}
	const maxBody = 64 << 10
	body, err := io.ReadAll(io.LimitReader(c.Request().Body, maxBody+1))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "failed to read body")
	}
	if len(body) > maxBody {
		return echo.NewHTTPError(http.StatusRequestEntityTooLarge, "theme JSON exceeds 64 KB")
	}
	var theme map[string]any
	if err := json.Unmarshal(body, &theme); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid JSON")
	}
	formatted, err := json.MarshalIndent(theme, "", "  ")
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	dir := filepath.Join(h.root, ".kiwi")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	p := filepath.Join(dir, "theme.json")
	if err := os.WriteFile(p, formatted, 0o644); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	actor := sanitizeActor(c.Request().Header.Get("X-Actor"))
	if actor == "anonymous" {
		actor = pipeline.DefaultActor
	}
	if cerr := h.versioner.Commit(c.Request().Context(), ".kiwi/theme.json", actor, "theme: update"); cerr != nil {
		log.Printf("handlers: commit theme: %v", cerr)
	}
	return c.JSON(http.StatusOK, theme)
}
