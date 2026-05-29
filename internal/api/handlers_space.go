package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"

	"github.com/BurntSushi/toml"
	"github.com/labstack/echo/v4"
)

type spaceInfoResponse struct {
	Visibility string `json:"visibility"`
	Root       string `json:"root"`
}

type updateVisibilityRequest struct {
	Visibility string `json:"visibility"`
}

type updateVisibilityResponse struct {
	Visibility string `json:"visibility"`
}

// SpaceInfo godoc
//
//	@Summary		Get space metadata
//	@Description	Returns metadata about the current workspace space, such as its visibility (private, unlisted, public) and its root directory path.
//	@Tags			space
//	@Security		BearerAuth
//	@Success		200		{object}	spaceInfoResponse
//	@Router			/api/kiwi/space/info [get]
func (h *Handlers) SpaceInfo(c echo.Context) error {
	vis := "private"
	if h.cfg != nil {
		vis = h.cfg.Space.Visibility
	}
	if vis == "" {
		vis = "private"
	}
	return c.JSON(http.StatusOK, spaceInfoResponse{
		Visibility: vis,
		Root:       h.root,
	})
}

// UpdateVisibility godoc
//
//	@Summary		Update space visibility
//	@Description	Changes the space's visibility setting. This is an admin-only endpoint.
//	@Tags			space
//	@Security		BearerAuth
//	@Param			body	body		updateVisibilityRequest	true	"Visibility setting"
//	@Success		200		{object}	updateVisibilityResponse
//	@Failure		400		{object}	map[string]string
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/space/visibility [put]
func (h *Handlers) UpdateVisibility(c echo.Context) error {
	var body updateVisibilityRequest
	if err := json.NewDecoder(c.Request().Body).Decode(&body); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid JSON body")
	}
	switch body.Visibility {
	case "private", "unlisted", "public":
		// ok
	default:
		return echo.NewHTTPError(http.StatusBadRequest, "visibility must be private, unlisted, or public")
	}

	// Persist to .kiwi/config.toml by reading, patching, and re-writing.
	configPath := filepath.Join(h.root, ".kiwi", "config.toml")
	var raw map[string]any
	if data, err := os.ReadFile(configPath); err == nil {
		if _, derr := toml.Decode(string(data), &raw); derr != nil {
			raw = map[string]any{}
		}
	} else {
		raw = map[string]any{}
	}

	space, ok := raw["space"].(map[string]any)
	if !ok {
		space = map[string]any{}
	}
	space["visibility"] = body.Visibility
	raw["space"] = space

	f, err := os.Create(configPath)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to write config")
	}
	defer f.Close()
	if err := toml.NewEncoder(f).Encode(raw); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to encode config")
	}

	// Update the live config so the auth middleware sees it immediately.
	if h.cfg != nil {
		h.cfg.Space.Visibility = body.Visibility
	}

	return c.JSON(http.StatusOK, updateVisibilityResponse{
		Visibility: body.Visibility,
	})
}
