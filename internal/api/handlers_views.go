package api

import (
	"net/http"

	"github.com/kiwifs/kiwifs/internal/dataview"
	"github.com/kiwifs/kiwifs/internal/views"
	"github.com/labstack/echo/v4"
)

var _ = (*dataview.QueryResult)(nil) // type-check import for swagger docs

type listViewsResponse struct {
	Views []views.View `json:"views"`
}

type saveViewResponse struct {
	Status string     `json:"status"`
	View   views.View `json:"view"`
}

type deleteViewResponse struct {
	Status string `json:"status"`
}

// ListViews godoc
//
//	@Summary		List all views
//	@Description	Retrieves all view definitions, which include layouts and DQL query details.
//	@Tags			views
//	@Security		BearerAuth
//	@Success		200	{object}	listViewsResponse
//	@Failure		500	{object}	map[string]string	"Internal server error retrieving views"
//	@Router			/api/kiwi/views [get]
func (h *Handlers) ListViews(c echo.Context) error {
	viewsList, err := views.List(h.root)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.JSON(http.StatusOK, map[string]any{"views": viewsList})
}

// GetView godoc
//
//	@Summary		Get a view
//	@Description	Retrieves the configuration of a single view by its name.
//	@Tags			views
//	@Security		BearerAuth
//	@Param			name	path		string	true	"View name"
//	@Success		200		{object}	views.View
//	@Failure		400		{object}	map[string]string	"View name required"
//	@Failure		404		{object}	map[string]string	"View not found"
//	@Router			/api/kiwi/views/{name} [get]
func (h *Handlers) GetView(c echo.Context) error {
	name := c.Param("name")
	if name == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "view name required")
	}

	view, err := views.Get(h.root, name)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, err.Error())
	}
	return c.JSON(http.StatusOK, view)
}

// SaveView godoc
//
//	@Summary		Save a view
//	@Description	Creates a new view or updates an existing view by name.
//	@Tags			views
//	@Security		BearerAuth
//	@Param			name	path		string		true	"View name"
//	@Param			view	body		views.View	true	"View configuration data"
//	@Success		200		{object}	saveViewResponse
//	@Failure		400		{object}	map[string]string	"View name required or invalid request body"
//	@Failure		500		{object}	map[string]string	"Internal server error saving view"
//	@Router			/api/kiwi/views/{name} [put]
func (h *Handlers) SaveView(c echo.Context) error {
	name := c.Param("name")
	if name == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "view name required")
	}

	var view views.View
	if err := c.Bind(&view); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	view.Name = name

	if err := views.Save(h.root, view); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	return c.JSON(http.StatusOK, map[string]any{"status": "saved", "view": view})
}

// DeleteView godoc
//
//	@Summary		Delete a view
//	@Description	Deletes a view definition by name.
//	@Tags			views
//	@Security		BearerAuth
//	@Param			name	path		string	true	"View name"
//	@Success		200		{object}	deleteViewResponse
//	@Failure		400		{object}	map[string]string	"View name required"
//	@Failure		500		{object}	map[string]string	"Internal server error deleting view"
//	@Router			/api/kiwi/views/{name} [delete]
func (h *Handlers) DeleteView(c echo.Context) error {
	name := c.Param("name")
	if name == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "view name required")
	}

	if err := views.Delete(h.root, name); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	return c.JSON(http.StatusOK, map[string]any{"status": "deleted"})
}

// ExecuteView godoc
//
//	@Summary		Execute a view
//	@Description	Executes the query associated with the view using the dataview query engine, applying formulas to computed columns.
//	@Tags			views
//	@Security		BearerAuth
//	@Param			name	path		string	true	"View name"
//	@Param			limit	query		int		false	"Limit results (default 50)"
//	@Param			offset	query		int		false	"Offset results (default 0)"
//	@Success		200		{object}	dataview.QueryResult
//	@Failure		400		{object}	map[string]string	"View name required or query evaluation error"
//	@Failure		404		{object}	map[string]string	"View not found"
//	@Failure		503		{object}	map[string]string	"Dataview executor not available"
//	@Router			/api/kiwi/views/{name}/execute [get]
func (h *Handlers) ExecuteView(c echo.Context) error {
	name := c.Param("name")
	if name == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "view name required")
	}

	view, err := views.Get(h.root, name)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, err.Error())
	}

	if h.dv == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "dataview executor not available")
	}

	limit := parseIntParam(c, "limit", 50)
	offset := parseIntParam(c, "offset", 0)

	result, err := h.dv.Query(c.Request().Context(), view.Query, limit, offset)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	// Apply formulas to computed columns
	if len(view.Columns) > 0 {
		for i := range result.Rows {
			for _, col := range view.Columns {
				if col.Formula != "" {
					val, err := views.EvalFormula(col.Formula, result.Rows[i])
					if err == nil {
						result.Rows[i][col.Property] = val
					}
				}
			}
		}
	}

	return c.JSON(http.StatusOK, result)
}
