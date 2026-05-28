package api

import (
	"net/http"

	"github.com/kiwifs/kiwifs/internal/webhooks"
	"github.com/labstack/echo/v4"
)

type createWebhookRequest struct {
	URL        string   `json:"url" example:"https://example.com/webhook"`
	PathGlob   string   `json:"path_glob" example:"/docs/**"`
	EventTypes []string `json:"event_types" example:"file.created,file.updated"`
}

// CreateWebhook godoc
//
//	@Summary		Register a new webhook
//	@Description	Registers a new webhook listener that will receive HTTP POST callbacks when matching events occur.
//	@Tags			webhooks
//	@Security		BearerAuth
//	@Accept			json
//	@Produce		json
//	@Param			body	body		createWebhookRequest	true	"Webhook registration request details"
//	@Success		201		{object}	webhooks.Webhook
//	@Failure		400		{object}	map[string]string
//	@Failure		503		{object}	map[string]string
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/webhooks [post]
func (h *Handlers) CreateWebhook(c echo.Context) error {
	if h.webhookStore == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "webhooks not enabled")
	}
	var req createWebhookRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request")
	}
	if req.URL == "" || req.PathGlob == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "url and path_glob are required")
	}

	wh, err := h.webhookStore.Register(c.Request().Context(), req.URL, req.PathGlob, req.EventTypes...)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.JSON(http.StatusCreated, wh)
}

// ListWebhooks godoc
//
//	@Summary		List registered webhooks
//	@Description	Retrieves all currently registered webhooks.
//	@Tags			webhooks
//	@Security		BearerAuth
//	@Produce		json
//	@Success		200		{array}		webhooks.Webhook
//	@Failure		503		{object}	map[string]string
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/webhooks [get]
func (h *Handlers) ListWebhooks(c echo.Context) error {
	if h.webhookStore == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "webhooks not enabled")
	}
	hooks, err := h.webhookStore.List(c.Request().Context())
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.JSON(http.StatusOK, hooks)
}

// DeleteWebhook godoc
//
//	@Summary		Delete a webhook
//	@Description	Removes a registered webhook by its ID.
//	@Tags			webhooks
//	@Security		BearerAuth
//	@Param			id	path		string	true	"Webhook ID"
//	@Success		204		"No Content"
//	@Failure		400		{object}	map[string]string
//	@Failure		404		{object}	map[string]string
//	@Failure		503		{object}	map[string]string
//	@Router			/api/kiwi/webhooks/{id} [delete]
func (h *Handlers) DeleteWebhook(c echo.Context) error {
	if h.webhookStore == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "webhooks not enabled")
	}
	id := c.Param("id")
	if id == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "id is required")
	}
	if err := h.webhookStore.Delete(c.Request().Context(), id); err != nil {
		return echo.NewHTTPError(http.StatusNotFound, err.Error())
	}
	return c.NoContent(http.StatusNoContent)
}

// Ensure Handlers has a webhookStore field — added in the struct definition.
var _ = (*webhooks.Store)(nil) // type-check import
