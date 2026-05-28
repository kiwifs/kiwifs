package api

import (
	"fmt"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
)

// Events godoc
//
//	@Summary		Get real-time events stream
//	@Description	Returns a Server-Sent Events (SSE) stream for real-time notifications about file changes and other events.
//	@Tags			integration
//	@Security		BearerAuth
//	@Produce		event-stream
//	@Success		200		{string}	string	"SSE stream of events"
//	@Failure		503		{object}	map[string]string
//	@Router			/api/kiwi/events [get]
func (h *Handlers) Events(c echo.Context) error {
	ch, err := h.hub.Subscribe()
	if err != nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, err.Error())
	}
	defer h.hub.Unsubscribe(ch)

	c.Response().Header().Set("Content-Type", "text/event-stream")
	c.Response().Header().Set("Cache-Control", "no-cache")
	c.Response().Header().Set("Connection", "keep-alive")
	c.Response().WriteHeader(http.StatusOK)
	c.Response().Flush()

	ticker := time.NewTicker(sseHeartbeat)
	defer ticker.Stop()

	ctx := c.Request().Context()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			if _, err := fmt.Fprint(c.Response(), ":keep-alive\n\n"); err != nil {
				return nil
			}
			c.Response().Flush()
		case msg, ok := <-ch:
			if !ok {
				return nil
			}
			op := msg.Op
			if op == "" {
				op = "message"
			}
			if _, err := fmt.Fprintf(c.Response(), "event: %s\ndata: %s\n\n", op, msg.Data); err != nil {
				return nil
			}
			c.Response().Flush()
		}
	}
}
