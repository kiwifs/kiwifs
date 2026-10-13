package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/kiwifs/kiwifs/internal/pipeline"
	"github.com/kiwifs/kiwifs/internal/refactor"
	"github.com/labstack/echo/v4"
)

const maxManifestBytes = 1 << 20

// RefactorApplyRequest is the body of POST /api/kiwi/refactor/apply.
type RefactorApplyRequest struct {
	Manifest refactor.Manifest `json:"manifest"`
	// Digest, when set, must equal the digest of the plan the caller
	// reviewed. If the workspace changed since, the request fails with 409
	// and returns the new plan instead of applying something unreviewed.
	Digest string `json:"digest,omitempty"`
}

func (h *Handlers) buildRefactorPlan(c echo.Context, m *refactor.Manifest) (*refactor.Plan, error) {
	plan, err := refactor.BuildPlan(c.Request().Context(), refactor.Workspace{Root: h.root, Store: h.store}, m)
	if err != nil {
		return nil, echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return plan, nil
}

// RefactorPlan godoc
//
//	@Summary		Preview a restructuring
//	@Description	Takes a manifest of moves and merges (YAML or JSON) and returns the plan: every page that moves, every link rewritten, comment and personal-state files migrated, and folders removed. Nothing is written. A plan with errors cannot be applied.
//	@Tags			refactor
//	@Security		BearerAuth
//	@Accept			json
//	@Param			body	body		refactor.Manifest	true	"Manifest"
//	@Success		200		{object}	refactor.Plan
//	@Failure		400		{object}	map[string]string
//	@Router			/api/kiwi/refactor/plan [post]
func (h *Handlers) RefactorPlan(c echo.Context) error {
	body, err := io.ReadAll(io.LimitReader(c.Request().Body, maxManifestBytes))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "failed to read body")
	}
	m, err := refactor.ParseManifest(body)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	plan, err := h.buildRefactorPlan(c, m)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, plan)
}

// RefactorApply godoc
//
//	@Summary		Apply a restructuring
//	@Description	Rebuilds the plan for the manifest and applies it as one commit. Fails with 422 if the plan has errors, and with 409 if the digest of the reviewed plan no longer matches or a file changed while applying.
//	@Tags			refactor
//	@Security		BearerAuth
//	@Accept			json
//	@Param			body	body		RefactorApplyRequest	true	"Manifest and the digest of the reviewed plan"
//	@Param			X-Actor	header		string					false	"Actor identity performing the restructuring"
//	@Success		200		{object}	map[string]any
//	@Failure		409		{object}	map[string]any
//	@Failure		422		{object}	map[string]any
//	@Router			/api/kiwi/refactor/apply [post]
func (h *Handlers) RefactorApply(c echo.Context) error {
	body, err := io.ReadAll(io.LimitReader(c.Request().Body, maxManifestBytes))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "failed to read body")
	}
	var req RefactorApplyRequest
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid body: "+err.Error())
	}
	if len(req.Manifest.Moves) == 0 && len(req.Manifest.Merges) == 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "manifest has no moves or merges")
	}
	plan, err := h.buildRefactorPlan(c, &req.Manifest)
	if err != nil {
		return err
	}
	if len(plan.Errors) > 0 {
		return c.JSON(http.StatusUnprocessableEntity, map[string]any{"error": "plan has errors", "plan": plan})
	}
	if req.Digest != "" && req.Digest != plan.Digest {
		return c.JSON(http.StatusConflict, map[string]any{"error": "the workspace changed since the plan was reviewed", "plan": plan})
	}
	res, err := h.pipe.ApplyRefactor(c.Request().Context(), plan, sanitizeActor(c.Request().Header.Get("X-Actor")))
	if err != nil {
		if errors.Is(err, pipeline.ErrPlanStale) {
			return c.JSON(http.StatusConflict, map[string]any{"error": err.Error()})
		}
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.JSON(http.StatusOK, map[string]any{"applied": res, "plan": plan})
}
