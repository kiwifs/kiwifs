package api

import (
	"errors"
	"net/http"

	"github.com/kiwifs/kiwifs/internal/pipeline"
	"github.com/kiwifs/kiwifs/internal/storage"
	"github.com/kiwifs/kiwifs/internal/trash"
	"github.com/labstack/echo/v4"
)

type listTrashResponse struct {
	Items []trash.Item `json:"items"`
}

type restoreTrashRequest struct {
	RestoreID string `json:"restore_id"`
}

type restoreTrashResponse struct {
	Restored string     `json:"restored"`
	ETag     string     `json:"etag,omitempty"`
	Item     trash.Item `json:"item"`
}

type purgeTrashResponse struct {
	Purged trash.Item `json:"purged"`
}

// ListTrash godoc
//
//	@Summary		List trashed files
//	@Description	Lists files moved to the trash by DELETE /api/kiwi/file, most recently deleted first, with their original path, deletion time and actor.
//	@Tags			trash
//	@Security		BearerAuth
//	@Success		200	{object}	listTrashResponse
//	@Failure		404	{object}	map[string]string	"Trash is disabled"
//	@Failure		500	{object}	map[string]string
//	@Router			/api/kiwi/trash [get]
func (h *Handlers) ListTrash(c echo.Context) error {
	items, err := h.pipe.ListTrash()
	if err != nil {
		return trashError(err)
	}
	return c.JSON(http.StatusOK, listTrashResponse{Items: items})
}

// RestoreTrash godoc
//
//	@Summary		Restore a trashed file
//	@Description	Moves a trashed file back to its original path and commits it as "restore: <path>". Fails with 409 when a file already exists at that path.
//	@Tags			trash
//	@Security		BearerAuth
//	@Param			body	body		restoreTrashRequest	true	"Item to restore"
//	@Param			X-Actor	header		string				false	"Actor identity performing the restore"
//	@Success		200		{object}	restoreTrashResponse
//	@Failure		400		{object}	map[string]string
//	@Failure		404		{object}	map[string]string	"Unknown restore_id, or trash is disabled"
//	@Failure		409		{object}	map[string]string	"A file already exists at the original path"
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/trash/restore [post]
func (h *Handlers) RestoreTrash(c echo.Context) error {
	var req restoreTrashRequest
	if err := bindJSON(c, &req); err != nil {
		return err
	}
	if req.RestoreID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "restore_id is required")
	}
	actor := sanitizeActor(c.Request().Header.Get("X-Actor"))
	item, res, err := h.pipe.RestoreFromTrash(c.Request().Context(), req.RestoreID, actor)
	if err != nil {
		return trashError(err)
	}
	if res.ETag != "" {
		c.Response().Header().Set("ETag", `"`+res.ETag+`"`)
	}
	return c.JSON(http.StatusOK, restoreTrashResponse{Restored: res.Path, ETag: res.ETag, Item: item})
}

// PurgeTrashItem godoc
//
//	@Summary		Permanently delete a trashed file
//	@Description	Removes one item from the trash for good. Its history stays in git.
//	@Tags			trash
//	@Security		BearerAuth
//	@Param			id	path		string	true	"Restore id of the trashed file"
//	@Success		200	{object}	purgeTrashResponse
//	@Failure		404	{object}	map[string]string	"Unknown id, or trash is disabled"
//	@Failure		500	{object}	map[string]string
//	@Router			/api/kiwi/trash/{id} [delete]
func (h *Handlers) PurgeTrashItem(c echo.Context) error {
	item, err := h.pipe.DeleteFromTrash(c.Param("id"))
	if err != nil {
		return trashError(err)
	}
	return c.JSON(http.StatusOK, purgeTrashResponse{Purged: item})
}

func trashError(err error) error {
	switch {
	case errors.Is(err, pipeline.ErrTrashDisabled), errors.Is(err, trash.ErrNotFound):
		return echo.NewHTTPError(http.StatusNotFound, err.Error())
	case errors.Is(err, trash.ErrExists):
		return echo.NewHTTPError(http.StatusConflict, err.Error())
	case errors.Is(err, storage.ErrPathDenied):
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
}
