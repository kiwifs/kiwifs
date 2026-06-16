package api

import (
	"encoding/json"
	"io"
	"log"
	"net/http"

	"github.com/kiwifs/kiwifs/internal/pipeline"
	"github.com/kiwifs/kiwifs/internal/preferences"
	"github.com/labstack/echo/v4"
)

// GetPreferences godoc
//
//	@Summary		Get current user preferences
//	@Description	Returns persisted UI preferences for the authenticated user from .kiwi/users/{user-id}/preferences.json.
//	@Tags			ui
//	@Security		BearerAuth
//	@Success		200		{object}	preferences.Preferences
//	@Failure		401		{object}	map[string]string
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/preferences [get]
func (h *Handlers) GetPreferences(c echo.Context) error {
	actor := sanitizeActor(c.Request().Header.Get("X-Actor"))
	if !preferences.IsPersistableUser(actor) {
		return echo.NewHTTPError(http.StatusUnauthorized, "authentication required for preferences")
	}
	userID := preferences.UserID(actor)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "authentication required for preferences")
	}
	prefs, err := preferences.Load(h.root, userID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.JSON(http.StatusOK, prefs)
}

// PutPreferences godoc
//
//	@Summary		Update current user preferences
//	@Description	Merges UI preference updates into .kiwi/users/{user-id}/preferences.json and commits to git.
//	@Tags			ui
//	@Security		BearerAuth
//	@Param			X-Actor	header		string					false	"Actor identity performing the operation"
//	@Param			body	body		preferences.Preferences	true	"Preference fields to update"
//	@Success		200		{object}	preferences.Preferences
//	@Failure		400		{object}	map[string]string
//	@Failure		401		{object}	map[string]string
//	@Failure		413		{object}	map[string]string
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/preferences [put]
func (h *Handlers) PutPreferences(c echo.Context) error {
	actor := sanitizeActor(c.Request().Header.Get("X-Actor"))
	if !preferences.IsPersistableUser(actor) {
		return echo.NewHTTPError(http.StatusUnauthorized, "authentication required for preferences")
	}
	userID := preferences.UserID(actor)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "authentication required for preferences")
	}

	const maxBody = 8 << 10
	body, err := io.ReadAll(io.LimitReader(c.Request().Body, maxBody+1))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "failed to read body")
	}
	if len(body) > maxBody {
		return echo.NewHTTPError(http.StatusRequestEntityTooLarge, "preferences JSON exceeds 8 KB")
	}

	var patch preferences.Preferences
	if err := json.Unmarshal(body, &patch); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid JSON")
	}
	if err := preferences.Validate(patch); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	existing, err := preferences.Load(h.root, userID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	merged := preferences.Merge(existing, patch)

	rel, err := preferences.Save(h.root, userID, merged)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	commitActor := actor
	if commitActor == "anonymous" {
		commitActor = pipeline.DefaultActor
	}
	if cerr := h.versioner.Commit(c.Request().Context(), rel, commitActor, "preferences: update"); cerr != nil {
		log.Printf("handlers: commit preferences: %v", cerr)
	}
	return c.JSON(http.StatusOK, merged)
}
