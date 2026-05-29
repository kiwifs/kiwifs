package api

import (
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/kiwifs/kiwifs/internal/claims"
	"github.com/labstack/echo/v4"
)

const (
	minLeaseDuration = 1 * time.Minute
	maxLeaseDuration = 24 * time.Hour
)

type claimTaskRequest struct {
	Path          string `json:"path"`
	LeaseDuration string `json:"lease_duration"`
}

type claimConflictResponse struct {
	Error       string        `json:"error"`
	ActiveClaim *claims.Claim `json:"active_claim"`
}

type releaseTaskRequest struct {
	Path string `json:"path"`
}

type releaseTaskResponse struct {
	Status string `json:"status"`
}

type listClaimsResponse struct {
	Claims []claims.Claim `json:"claims"`
}

// ClaimTask godoc
//
//	@Summary		Claim a task lease on a file path
//	@Description	Acquires or extends an exclusive write lock lease for an actor on a file path. Returns 409 Conflict if already claimed by someone else.
//	@Tags			claims
//	@Security		BearerAuth
//	@Param			X-Actor	header		string				true	"Actor identity performing the claim"
//	@Param			body	body		claimTaskRequest	true	"Claim details. lease_duration is optional (default is 30 minutes, min is 1 minute, max is 24 hours)"
//	@Success		200		{object}	claims.Claim
//	@Failure		400		{object}	map[string]string
//	@Failure		404		{object}	map[string]string
//	@Failure		409		{object}	claimConflictResponse
//	@Failure		500		{object}	map[string]string
//	@Failure		503		{object}	map[string]string
//	@Router			/api/kiwi/claim [post]
func (h *Handlers) ClaimTask(c echo.Context) error {
	actor := c.Request().Header.Get("X-Actor")
	if actor == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "X-Actor header required")
	}
	if h.claimStore == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "claims not enabled")
	}

	var body claimTaskRequest
	if err := c.Bind(&body); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid body")
	}
	if body.Path == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "path is required")
	}

	ctx := c.Request().Context()

	if _, err := h.store.Stat(ctx, body.Path); err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "file not found")
	}

	lease := 30 * time.Minute
	if body.LeaseDuration != "" {
		d, err := time.ParseDuration(body.LeaseDuration)
		if err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "invalid lease_duration")
		}
		lease = d
	}
	if lease < minLeaseDuration {
		lease = minLeaseDuration
	}
	if lease > maxLeaseDuration {
		return echo.NewHTTPError(http.StatusBadRequest,
			fmt.Sprintf("lease_duration must be <= %s", maxLeaseDuration))
	}

	claim, err := h.claimStore.Claim(ctx, body.Path, actor, lease)
	if err != nil {
		if errors.Is(err, claims.ErrAlreadyClaimed) {
			existing, _ := h.claimStore.ActiveClaim(ctx, body.Path)
			return c.JSON(http.StatusConflict, claimConflictResponse{
				Error:       "already claimed",
				ActiveClaim: existing,
			})
		}
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	return c.JSON(http.StatusOK, claim)
}

// ReleaseTask godoc
//
//	@Summary		Release a task lease on a file path
//	@Description	Releases an exclusive write lock lease held by the actor on a file path.
//	@Tags			claims
//	@Security		BearerAuth
//	@Param			X-Actor	header		string				true	"Actor identity performing the release"
//	@Param			body	body		releaseTaskRequest	true	"Release details"
//	@Success		200		{object}	releaseTaskResponse
//	@Failure		400		{object}	map[string]string
//	@Failure		403		{object}	map[string]string
//	@Failure		500		{object}	map[string]string
//	@Failure		503		{object}	map[string]string
//	@Router			/api/kiwi/claim [delete]
func (h *Handlers) ReleaseTask(c echo.Context) error {
	actor := c.Request().Header.Get("X-Actor")
	if actor == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "X-Actor header required")
	}
	if h.claimStore == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "claims not enabled")
	}

	var body releaseTaskRequest
	if err := c.Bind(&body); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid body")
	}
	if body.Path == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "path is required")
	}

	ctx := c.Request().Context()
	if err := h.claimStore.Release(ctx, body.Path, actor); err != nil {
		if errors.Is(err, claims.ErrNotHolder) {
			return echo.NewHTTPError(http.StatusForbidden, "not the current claim holder")
		}
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	return c.JSON(http.StatusOK, releaseTaskResponse{Status: "released"})
}

// ListClaims godoc
//
//	@Summary		List active claims
//	@Description	Returns a list of all active leases currently held in the system.
//	@Tags			claims
//	@Security		BearerAuth
//	@Success		200		{object}	listClaimsResponse
//	@Failure		500		{object}	map[string]string
//	@Failure		503		{object}	map[string]string
//	@Router			/api/kiwi/claims [get]
func (h *Handlers) ListClaims(c echo.Context) error {
	if h.claimStore == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "claims not enabled")
	}
	ctx := c.Request().Context()
	active, err := h.claimStore.ListActive(ctx)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.JSON(http.StatusOK, listClaimsResponse{Claims: active})
}
