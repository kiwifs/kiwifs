package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/kiwifs/kiwifs/internal/similar"
	"github.com/labstack/echo/v4"
)

// Similar godoc
//
//	@Summary		Find structurally similar pages
//	@Description	Ranks pages by Gower distance over the frontmatter fields named by a similarity profile. Query by an indexed page path, or by an inline field vector for a case that is not in the corpus yet. Every result carries its per-field distance contributions and the share of fields that were actually comparable.
//	@Tags			search
//	@Security		BearerAuth
//	@Produce		json
//	@Param			path	query		string	false	"Page to find neighbours of"
//	@Param			profile	query		string	false	"Similarity profile name (optional when exactly one is configured)"
//	@Param			k		query		int		false	"Number of neighbours to return (default 5)"
//	@Param			vector	query		string	false	"Inline field vector as a JSON object; overlays the page's own values when combined with path"
//	@Success		200		{object}	similar.Result
//	@Failure		400		{object}	map[string]string	"Neither path nor vector given, unknown profile, or malformed vector"
//	@Failure		503		{object}	map[string]string	"No similarity profiles configured"
//	@Router			/api/kiwi/similar [get]
func (h *Handlers) Similar(c echo.Context) error {
	if h.similar == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable,
			"no similarity profiles configured — add a [[similarity.profiles]] block to .kiwi/config.toml")
	}

	q := similar.Query{
		Path:    strings.TrimSpace(c.QueryParam("path")),
		Profile: strings.TrimSpace(c.QueryParam("profile")),
	}
	if k := c.QueryParam("k"); k != "" {
		n, err := parseInt(k)
		if err != nil || n <= 0 {
			return echo.NewHTTPError(http.StatusBadRequest, "k must be a positive integer")
		}
		q.K = n
	}
	if raw := strings.TrimSpace(c.QueryParam("vector")); raw != "" {
		var v map[string]any
		if err := json.Unmarshal([]byte(raw), &v); err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "vector must be a JSON object")
		}
		q.Vector = v
	}

	res, err := h.similar.Similar(c.Request().Context(), q)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	return c.JSON(http.StatusOK, res)
}
