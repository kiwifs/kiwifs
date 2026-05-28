package api

import (
	"context"
	"net/http"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
)

// timelineEvent represents a single event in the activity timeline.
type timelineEvent struct {
	Type      string `json:"type" example:"write"`
	Path      string `json:"path" example:"/docs/getting-started.md"`
	Actor     string `json:"actor" example:"Jane Doe"`
	Timestamp string `json:"timestamp" example:"2026-05-28T20:27:17Z"`
	Message   string `json:"message" example:"Update installation steps"`
}

type timelineResponse struct {
	Events []timelineEvent `json:"events"`
	Total  int             `json:"total" example:"15"`
}

// Timeline godoc
//
//	@Summary		Get recent timeline events
//	@Description	Returns a list of recent repository activity events (added, modified, deleted files) formatted as an activity timeline.
//	@Tags			timeline
//	@Security		BearerAuth
//	@Produce		json
//	@Param			limit		query		int		false	"Maximum number of events to return (default 50, max 500)"
//	@Param			offset		query		int		false	"Offset for pagination (default 0)"
//	@Param			actor		query		string	false	"Filter by actor name"
//	@Param			type		query		string	false	"Filter by event type ('write' or 'delete')"
//	@Param			path_prefix	query		string	false	"Filter by file path prefix"
//	@Success		200			{object}	timelineResponse
//	@Failure		400			{object}	map[string]string
//	@Failure		500			{object}	map[string]string
//	@Router			/api/kiwi/timeline [get]
func (h *Handlers) Timeline(c echo.Context) error {
	limit := parseIntParam(c, "limit", 50)
	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}

	offset := parseIntParam(c, "offset", 0)
	if offset < 0 {
		offset = 0
	}

	actorFilter := c.QueryParam("actor")
	typeFilter := c.QueryParam("type")
	pathPrefix := c.QueryParam("path_prefix")

	// Validate type filter
	if typeFilter != "" && typeFilter != "write" && typeFilter != "delete" {
		return echo.NewHTTPError(http.StatusBadRequest, "type must be 'write' or 'delete'")
	}

	events, err := h.fetchTimelineEvents(c.Request().Context(), limit+offset, actorFilter, typeFilter, pathPrefix)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	// Apply offset
	if offset >= len(events) {
		events = []timelineEvent{}
	} else {
		events = events[offset:]
	}

	// Apply limit
	if len(events) > limit {
		events = events[:limit]
	}

	total := offset + len(events)
	if len(events) == limit {
		total++ // signal there may be more pages
	}
	return c.JSON(http.StatusOK, timelineResponse{Events: events, Total: total})
}

// fetchTimelineEvents retrieves timeline events from git log.
// It uses git log with --name-status to get commit info and file changes in one pass.
func (h *Handlers) fetchTimelineEvents(ctx context.Context, limit int, actorFilter, typeFilter, pathPrefix string) ([]timelineEvent, error) {
	// Use a larger limit for git log to account for filtering
	fetchLimit := limit * 3
	if fetchLimit > 1000 {
		fetchLimit = 1000
	}

	// Run git log with --name-status to get files changed in each commit
	// Format: COMMIT:<hash>|<timestamp>|<author>|<subject>
	// Followed by lines: <status>\t<path>
	args := []string{
		"log",
		"--pretty=format:COMMIT:%H|%aI|%an|%s",
		"--name-status",
		"-n", strconv.Itoa(fetchLimit),
		"--",
	}

	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = h.root

	out, err := cmd.Output()
	if err != nil {
		// Handle empty repo gracefully
		if exitErr, ok := err.(*exec.ExitError); ok {
			stderr := string(exitErr.Stderr)
			if strings.Contains(stderr, "does not have any commits") ||
				strings.Contains(stderr, "bad default revision") ||
				strings.Contains(stderr, "unknown revision") {
				return []timelineEvent{}, nil
			}
		}
		return nil, err
	}

	events, err := parseGitLog(string(out), actorFilter, typeFilter, pathPrefix)
	if err != nil {
		return nil, err
	}

	// Limit the final result
	if len(events) > limit {
		events = events[:limit]
	}

	return events, nil
}

// parseGitLog parses the output from git log --pretty=format:COMMIT:... --name-status
func parseGitLog(output, actorFilter, typeFilter, pathPrefix string) ([]timelineEvent, error) {
	lines := strings.Split(strings.TrimSpace(output), "\n")
	var events []timelineEvent

	var currentCommit struct {
		hash      string
		timestamp string
		author    string
		subject   string
	}

	for _, line := range lines {
		if line == "" {
			continue
		}

		// Check if this is a commit line
		if strings.HasPrefix(line, "COMMIT:") {
			// Parse commit header: COMMIT:<hash>|<timestamp>|<author>|<subject>
			parts := strings.SplitN(line[7:], "|", 4)
			if len(parts) < 4 {
				continue
			}
			currentCommit.hash = parts[0]
			currentCommit.timestamp = parts[1]
			currentCommit.author = parts[2]
			currentCommit.subject = parts[3]
			continue
		}

		// This is a file change line: <status>\t<path>
		fields := strings.Split(line, "\t")
		if len(fields) < 2 {
			continue
		}

		status := fields[0]
		if status == "" {
			continue
		}
		path := fields[1]

		// Skip files in .kiwi directory
		if strings.HasPrefix(path, ".kiwi/") {
			continue
		}

		// Determine event type from git status
		var eventType string
		switch status[0] {
		case 'A', 'M': // Added or Modified
			eventType = "write"
		case 'D': // Deleted
			eventType = "delete"
		case 'R': // Renamed - treat as write to new location
			eventType = "write"
			// For renames, git shows R100\told\tnew, use the new name
			if len(fields) > 2 {
				path = fields[2]
			}
		case 'C': // Copied - treat as write
			eventType = "write"
			if len(fields) > 2 {
				path = fields[2]
			}
		default:
			continue
		}

		// Apply filters
		if actorFilter != "" && currentCommit.author != actorFilter {
			continue
		}
		if typeFilter != "" && eventType != typeFilter {
			continue
		}
		if pathPrefix != "" && !strings.HasPrefix(path, pathPrefix) {
			continue
		}

		// Parse timestamp to ensure it's valid, then format it
		timestamp := currentCommit.timestamp
		if t, err := time.Parse(time.RFC3339, timestamp); err == nil {
			timestamp = t.Format(time.RFC3339)
		}

		events = append(events, timelineEvent{
			Type:      eventType,
			Path:      path,
			Actor:     currentCommit.author,
			Timestamp: timestamp,
			Message:   currentCommit.subject,
		})
	}

	return events, nil
}
