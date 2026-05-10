package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"

	"github.com/BurntSushi/toml"
	"github.com/labstack/echo/v4"
)

// SpaceInfo returns metadata about the current space including its visibility.
// GET /api/kiwi/space/info
func (h *Handlers) SpaceInfo(c echo.Context) error {
	vis := "private"
	if h.cfg != nil {
		vis = h.cfg.Space.Visibility
	}
	if vis == "" {
		vis = "private"
	}
	return c.JSON(http.StatusOK, map[string]any{
		"visibility": vis,
		"root":       h.root,
	})
}

// UpdateVisibility changes the space's visibility setting.
// PUT /api/kiwi/space/visibility  { "visibility": "public" }
// This is an admin-only endpoint (scope enforcement done by auth middleware).
func (h *Handlers) UpdateVisibility(c echo.Context) error {
	var body struct {
		Visibility string `json:"visibility"`
	}
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

	return c.JSON(http.StatusOK, map[string]any{
		"visibility": body.Visibility,
	})
}
