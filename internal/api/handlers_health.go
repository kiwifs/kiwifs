package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
)

var (
	startedAt    = time.Now()
	buildVersion = "dev"
)

func SetBuildVersion(v string) {
	if v == "" {
		return
	}
	buildVersion = v
}

// Health godoc
//
//	@Summary		Health check
//	@Description	Returns simple health status
//	@Tags			health
//	@Success		200	{object}	map[string]string
//	@Router			/health [get]
func (h *Handlers) Health(c echo.Context) error {
	return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
}

// Healthz godoc
//
//	@Summary		Detailed health check
//	@Description	Returns health status with uptime and version
//	@Tags			health
//	@Success		200	{object}	map[string]interface{}
//	@Router			/healthz [get]
func (h *Handlers) Healthz(c echo.Context) error {
	return c.JSON(http.StatusOK, map[string]any{
		"status":  "ok",
		"uptime":  time.Since(startedAt).String(),
		"version": buildVersion,
	})
}

type protocolStatus struct {
	Enabled  bool   `json:"enabled"`
	Healthy  bool   `json:"healthy,omitempty"`
	Port     int    `json:"port,omitempty"`
	Endpoint string `json:"endpoint,omitempty"`
	Error    string `json:"error,omitempty"`
}

type readyResponse struct {
	Status    string                    `json:"status"`
	Error     string                    `json:"error,omitempty"`
	Protocols map[string]protocolStatus `json:"protocols,omitempty"`
}

// Readyz godoc
//
//	@Summary		Readiness check
//	@Description	Returns readiness status including storage and protocol health
//	@Tags			health
//	@Success		200	{object}	readyResponse
//	@Failure		503	{object}	readyResponse
//	@Router			/readyz [get]
func (h *Handlers) Readyz(c echo.Context) error {
	if h.store == nil {
		return c.JSON(http.StatusServiceUnavailable, map[string]string{"status": "no-store"})
	}
	ctx, cancel := context.WithTimeout(c.Request().Context(), 500*time.Millisecond)
	defer cancel()
	if _, err := h.store.Stat(ctx, ""); err != nil {
		return c.JSON(http.StatusServiceUnavailable, readyResponse{
			Status: "storage-unreachable",
			Error:  err.Error(),
		})
	}

	protocols := make(map[string]protocolStatus, len(h.protocolHealth))
	ready := true
	for _, probe := range h.protocolHealth {
		if probe.Name == "" {
			continue
		}
		status := protocolStatus{
			Enabled:  probe.Enabled,
			Port:     probe.Port,
			Endpoint: probe.Addr,
		}
		if probe.Enabled {
			check := probe.Check
			if check == nil {
				status.Healthy = true
			} else if err := check(ctx); err != nil {
				status.Healthy = false
				status.Error = err.Error()
				ready = false
			} else {
				status.Healthy = true
			}
		}
		protocols[probe.Name] = status
	}

	if !ready {
		return c.JSON(http.StatusServiceUnavailable, readyResponse{
			Status:    "protocol-unhealthy",
			Protocols: protocols,
		})
	}
	resp := readyResponse{Status: "ready"}
	if len(protocols) > 0 {
		resp.Protocols = protocols
	}
	return c.JSON(http.StatusOK, resp)
}

// Metrics godoc
//
//	@Summary		Prometheus metrics
//	@Description	Returns Prometheus-formatted metrics
//	@Tags			metrics
//	@Produce		plain
//	@Success		200	{string}	string
//	@Router			/metrics [get]
func (h *Handlers) Metrics(c echo.Context) error {
	var b strings.Builder
	fmt.Fprintf(&b, "# HELP kiwi_build_info Static build metadata.\n")
	fmt.Fprintf(&b, "# TYPE kiwi_build_info gauge\n")
	fmt.Fprintf(&b, "kiwi_build_info{version=%q} 1\n", buildVersion)

	fmt.Fprintf(&b, "# HELP kiwi_uptime_seconds Seconds since server start.\n")
	fmt.Fprintf(&b, "# TYPE kiwi_uptime_seconds gauge\n")
	fmt.Fprintf(&b, "kiwi_uptime_seconds %.0f\n", time.Since(startedAt).Seconds())

	if h.hub != nil {
		fmt.Fprintf(&b, "# HELP kiwi_sse_subscribers Current SSE subscriber count.\n")
		fmt.Fprintf(&b, "# TYPE kiwi_sse_subscribers gauge\n")
		fmt.Fprintf(&b, "kiwi_sse_subscribers %d\n", h.hub.Count())
	}
	if h.janitorSched != nil {
		if r := h.janitorSched.LastResult(); r != nil {
			fmt.Fprintf(&b, "# HELP kiwi_janitor_issues Total janitor issues at last scan.\n")
			fmt.Fprintf(&b, "# TYPE kiwi_janitor_issues gauge\n")
			fmt.Fprintf(&b, "kiwi_janitor_issues %d\n", len(r.Issues))
		}
	}
	return c.Blob(http.StatusOK, "text/plain; version=0.0.4; charset=utf-8", []byte(b.String()))
}
