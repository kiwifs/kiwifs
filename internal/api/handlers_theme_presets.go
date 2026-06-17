package api

import (
	"net/http"

	"github.com/kiwifs/kiwifs/internal/themepresets"
	"github.com/labstack/echo/v4"
)

// GetThemePresets godoc
//
//	@Summary		List theme presets
//	@Description	Returns workspace theme presets from the configured presets directory plus built-in preset slugs. When allowed_presets is set in config, only those presets are returned. Invalid preset JSON files are reported in errors.
//	@Tags			theme
//	@Security		BearerAuth
//	@Success		200		{object}	themepresets.Resolved
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/theme/presets [get]
func (h *Handlers) GetThemePresets(c echo.Context) error {
	res, err := themepresets.Resolve(themepresets.Options{
		Root:           h.root,
		PresetsDir:     h.ui.Theme.PresetsDir,
		AllowedPresets: h.ui.Theme.AllowedPresets,
	})
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.JSON(http.StatusOK, res)
}
