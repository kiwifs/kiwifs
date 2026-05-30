package api

import (
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/kiwifs/kiwifs/internal/draft"
	"github.com/kiwifs/kiwifs/internal/pipeline"
	"github.com/kiwifs/kiwifs/internal/storage"
	"github.com/labstack/echo/v4"
)

type draftResponse struct {
	ID        string    `json:"id"`
	Branch    string    `json:"branch"`
	Actor     string    `json:"actor"`
	CreatedAt time.Time `json:"created_at"`
}

func toDraftResponse(d *draft.Draft) draftResponse {
	return draftResponse{
		ID:        d.ID,
		Branch:    d.Branch,
		Actor:     d.Actor,
		CreatedAt: d.CreatedAt,
	}
}

type createDraftRequest struct {
	Actor string `json:"actor"`
}

// CreateDraft godoc
//
//	@Summary		Create a new draft
//	@Description	Creates a new copy-on-write draft branch for editing.
//	@Tags			drafts
//	@Security		BearerAuth
//	@Param			body	body		createDraftRequest	true	"Draft creation details"
//	@Param			X-Actor	header		string				false	"Actor identity performing the create"
//	@Success		201		{object}	draftResponse
//	@Failure		409		{object}	map[string]string	"Conflict if maximum active drafts limit is reached or repository is empty"
//	@Failure		501		{object}	map[string]string	"Drafts not enabled"
//	@Failure		500		{object}	map[string]string	"Internal server error"
//	@Router			/api/kiwi/drafts [post]
func (h *Handlers) CreateDraft(c echo.Context) error {
	if h.draftMgr == nil {
		return echo.NewHTTPError(http.StatusNotImplemented, "drafts not enabled")
	}
	var body createDraftRequest
	_ = c.Bind(&body)
	if body.Actor == "" {
		body.Actor = c.Request().Header.Get("X-Actor")
	}
	if body.Actor == "" {
		body.Actor = "api"
	}
	d, err := h.draftMgr.Create(c.Request().Context(), body.Actor)
	if err != nil {
		if errors.Is(err, draft.ErrMaxActive) {
			return echo.NewHTTPError(http.StatusConflict, err.Error())
		}
		if errors.Is(err, draft.ErrEmptyRepo) {
			return echo.NewHTTPError(http.StatusConflict, err.Error())
		}
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.JSON(http.StatusCreated, toDraftResponse(d))
}

// ListDrafts godoc
//
//	@Summary		List drafts
//	@Description	Returns a list of all active draft branches.
//	@Tags			drafts
//	@Security		BearerAuth
//	@Success		200	{array}		draftResponse
//	@Failure		501	{object}	map[string]string	"Drafts not enabled"
//	@Router			/api/kiwi/drafts [get]
func (h *Handlers) ListDrafts(c echo.Context) error {
	if h.draftMgr == nil {
		return echo.NewHTTPError(http.StatusNotImplemented, "drafts not enabled")
	}
	drafts := h.draftMgr.List()
	out := make([]draftResponse, len(drafts))
	for i, d := range drafts {
		out[i] = toDraftResponse(d)
	}
	return c.JSON(http.StatusOK, out)
}

// GetDraft godoc
//
//	@Summary		Get draft details
//	@Description	Returns metadata for a specific draft by its ID.
//	@Tags			drafts
//	@Security		BearerAuth
//	@Param			id	path		string	true	"Draft ID"
//	@Success		200	{object}	draftResponse
//	@Failure		404	{object}	map[string]string	"Draft not found"
//	@Failure		501	{object}	map[string]string	"Drafts not enabled"
//	@Failure		500	{object}	map[string]string	"Internal server error"
//	@Router			/api/kiwi/drafts/{id} [get]
func (h *Handlers) GetDraft(c echo.Context) error {
	if h.draftMgr == nil {
		return echo.NewHTTPError(http.StatusNotImplemented, "drafts not enabled")
	}
	d, err := h.draftMgr.Get(c.Param("id"))
	if err != nil {
		if errors.Is(err, draft.ErrNotFound) {
			return echo.NewHTTPError(http.StatusNotFound, "draft not found")
		}
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.JSON(http.StatusOK, toDraftResponse(d))
}

// DraftDiff godoc
//
//	@Summary		Get draft diff
//	@Description	Returns the diff content between the draft branch and the main branch.
//	@Tags			drafts
//	@Security		BearerAuth
//	@Param			id	path		string	true	"Draft ID"
//	@Success		200	{object}	map[string]string	"Diff content mapping"
//	@Failure		404	{object}	map[string]string	"Draft not found"
//	@Failure		501	{object}	map[string]string	"Drafts not enabled"
//	@Failure		500	{object}	map[string]string	"Internal server error"
//	@Router			/api/kiwi/drafts/{id}/diff [get]
func (h *Handlers) DraftDiff(c echo.Context) error {
	if h.draftMgr == nil {
		return echo.NewHTTPError(http.StatusNotImplemented, "drafts not enabled")
	}
	diff, err := h.draftMgr.Diff(c.Request().Context(), c.Param("id"))
	if err != nil {
		if errors.Is(err, draft.ErrNotFound) {
			return echo.NewHTTPError(http.StatusNotFound, "draft not found")
		}
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.JSON(http.StatusOK, map[string]string{"diff": diff})
}

// MergeDraft godoc
//
//	@Summary		Merge a draft
//	@Description	Merges the changes from the draft branch back into the main branch.
//	@Tags			drafts
//	@Security		BearerAuth
//	@Param			id	path		string	true	"Draft ID"
//	@Success		200	{object}	map[string]string	"Status merged"
//	@Failure		404	{object}	map[string]string	"Draft not found"
//	@Failure		409	{object}	map[string]string	"Merge conflict"
//	@Failure		501	{object}	map[string]string	"Drafts not enabled"
//	@Failure		500	{object}	map[string]string	"Internal server error"
//	@Router			/api/kiwi/drafts/{id}/merge [post]
func (h *Handlers) MergeDraft(c echo.Context) error {
	if h.draftMgr == nil {
		return echo.NewHTTPError(http.StatusNotImplemented, "drafts not enabled")
	}
	err := h.draftMgr.Merge(c.Request().Context(), c.Param("id"))
	if err != nil {
		if errors.Is(err, draft.ErrNotFound) {
			return echo.NewHTTPError(http.StatusNotFound, "draft not found")
		}
		if errors.Is(err, draft.ErrConflict) {
			return echo.NewHTTPError(http.StatusConflict, err.Error())
		}
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.JSON(http.StatusOK, map[string]string{"status": "merged"})
}

// DiscardDraft godoc
//
//	@Summary		Discard a draft
//	@Description	Deletes the draft branch and all its associated resources.
//	@Tags			drafts
//	@Security		BearerAuth
//	@Param			id	path		string	true	"Draft ID"
//	@Success		204	"No Content"
//	@Failure		404	{object}	map[string]string	"Draft not found"
//	@Failure		501	{object}	map[string]string	"Drafts not enabled"
//	@Failure		500	{object}	map[string]string	"Internal server error"
//	@Router			/api/kiwi/drafts/{id} [delete]
func (h *Handlers) DiscardDraft(c echo.Context) error {
	if h.draftMgr == nil {
		return echo.NewHTTPError(http.StatusNotImplemented, "drafts not enabled")
	}
	err := h.draftMgr.Discard(c.Request().Context(), c.Param("id"))
	if err != nil {
		if errors.Is(err, draft.ErrNotFound) {
			return echo.NewHTTPError(http.StatusNotFound, "draft not found")
		}
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.NoContent(http.StatusNoContent)
}

func (h *Handlers) draftPipeline(id string) (*pipeline.Pipeline, error) {
	if h.draftMgr == nil {
		return nil, errors.New("drafts not enabled")
	}
	return h.draftMgr.Pipeline(id)
}

// DraftReadFile godoc
//
//	@Summary		Read file content from draft
//	@Description	Reads a file's content from the draft's virtual copy-on-write storage.
//	@Tags			drafts
//	@Security		BearerAuth
//	@Param			id					path		string	true	"Draft ID"
//	@Param			path				query		string	true	"Path of the file to read (must start with '/')"
//	@Success		200					{string}	string	"File content (raw bytes)"
//	@Failure		400					{object}	map[string]string	"Path is required or access denied"
//	@Failure		404					{object}	map[string]string	"Draft not found or file not found"
//	@Failure		501					{object}	map[string]string	"Drafts not enabled"
//	@Router			/api/kiwi/drafts/{id}/file [get]
func (h *Handlers) DraftReadFile(c echo.Context) error {
	pipe, err := h.draftPipeline(c.Param("id"))
	if err != nil {
		if errors.Is(err, draft.ErrNotFound) {
			return echo.NewHTTPError(http.StatusNotFound, "draft not found")
		}
		return echo.NewHTTPError(http.StatusNotImplemented, err.Error())
	}
	path := c.QueryParam("path")
	if path == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "path is required")
	}
	content, rerr := pipe.Store.Read(c.Request().Context(), path)
	if rerr != nil {
		if errors.Is(rerr, storage.ErrPathDenied) {
			return echo.NewHTTPError(http.StatusBadRequest, rerr.Error())
		}
		return echo.NewHTTPError(http.StatusNotFound, "file not found")
	}
	etag := pipeline.ETag(content)
	c.Response().Header().Set("ETag", `"`+etag+`"`)
	return c.Blob(http.StatusOK, "text/markdown; charset=utf-8", content)
}

// DraftWriteFile godoc
//
//	@Summary		Write file content to draft
//	@Description	Creates or updates a file in the draft's virtual copy-on-write storage.
//	@Tags			drafts
//	@Security		BearerAuth
//	@Param			id		path		string	true	"Draft ID"
//	@Param			path	query		string	true	"Path of the file to write (must start with '/')"
//	@Param			X-Actor	header		string	false	"Actor identity performing the write"
//	@Param			body	body		string	true	"File content to write"
//	@Success		200		{object}	map[string]string	"Status with path and etag"
//	@Failure		400		{object}	map[string]string	"Path is required or failed to read body"
//	@Failure		404		{object}	map[string]string	"Draft not found"
//	@Failure		501		{object}	map[string]string	"Drafts not enabled"
//	@Failure		500		{object}	map[string]string	"Internal server error"
//	@Router			/api/kiwi/drafts/{id}/file [put]
func (h *Handlers) DraftWriteFile(c echo.Context) error {
	pipe, err := h.draftPipeline(c.Param("id"))
	if err != nil {
		if errors.Is(err, draft.ErrNotFound) {
			return echo.NewHTTPError(http.StatusNotFound, "draft not found")
		}
		return echo.NewHTTPError(http.StatusNotImplemented, err.Error())
	}
	path := c.QueryParam("path")
	if path == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "path is required")
	}
	body, rerr := io.ReadAll(c.Request().Body)
	if rerr != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "failed to read body")
	}
	actor := c.Request().Header.Get("X-Actor")
	if actor == "" {
		actor = "draft-api"
	}
	res, werr := pipe.Write(c.Request().Context(), path, body, actor)
	if werr != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, werr.Error())
	}
	c.Response().Header().Set("ETag", `"`+res.ETag+`"`)
	return c.JSON(http.StatusOK, map[string]string{"path": res.Path, "etag": res.ETag})
}

// DraftDeleteFile godoc
//
//	@Summary		Delete file from draft
//	@Description	Deletes a file from the draft's virtual copy-on-write storage.
//	@Tags			drafts
//	@Security		BearerAuth
//	@Param			id		path		string	true	"Draft ID"
//	@Param			path	query		string	true	"Path of the file to delete (must start with '/')"
//	@Param			X-Actor	header		string	false	"Actor identity performing the delete"
//	@Success		204		"No Content"
//	@Failure		400		{object}	map[string]string	"Path is required"
//	@Failure		404		{object}	map[string]string	"Draft not found"
//	@Failure		501		{object}	map[string]string	"Drafts not enabled"
//	@Failure		500		{object}	map[string]string	"Internal server error"
//	@Router			/api/kiwi/drafts/{id}/file [delete]
func (h *Handlers) DraftDeleteFile(c echo.Context) error {
	pipe, err := h.draftPipeline(c.Param("id"))
	if err != nil {
		if errors.Is(err, draft.ErrNotFound) {
			return echo.NewHTTPError(http.StatusNotFound, "draft not found")
		}
		return echo.NewHTTPError(http.StatusNotImplemented, err.Error())
	}
	path := c.QueryParam("path")
	if path == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "path is required")
	}
	actor := c.Request().Header.Get("X-Actor")
	if actor == "" {
		actor = "draft-api"
	}
	if derr := pipe.Delete(c.Request().Context(), path, actor); derr != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, derr.Error())
	}
	return c.NoContent(http.StatusNoContent)
}

// DraftTree godoc
//
//	@Summary		Get directory tree for draft
//	@Description	Returns the hierarchical directory tree from the draft's virtual storage starting from a specific path.
//	@Tags			drafts
//	@Security		BearerAuth
//	@Param			id		path		string	true	"Draft ID"
//	@Param			path	query		string	false	"Directory path to start tree building from (defaults to '/')"
//	@Success		200		{object}	treeEntry
//	@Failure		404		{object}	map[string]string	"Draft not found"
//	@Failure		501		{object}	map[string]string	"Drafts not enabled"
//	@Failure		500		{object}	map[string]string	"Internal server error"
//	@Router			/api/kiwi/drafts/{id}/tree [get]
func (h *Handlers) DraftTree(c echo.Context) error {
	pipe, err := h.draftPipeline(c.Param("id"))
	if err != nil {
		if errors.Is(err, draft.ErrNotFound) {
			return echo.NewHTTPError(http.StatusNotFound, "draft not found")
		}
		return echo.NewHTTPError(http.StatusNotImplemented, err.Error())
	}
	path := c.QueryParam("path")
	if path == "" {
		path = "/"
	}
	st, serr := storage.BuildTree(c.Request().Context(), pipe.Store, path, maxTreeDepth)
	if serr != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, serr.Error())
	}
	return c.JSON(http.StatusOK, toTreeEntry(st))
}
