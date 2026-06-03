package api

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/kiwifs/kiwifs/internal/pipeline"
	"github.com/labstack/echo/v4"
)

// Rules godoc
//
//	@Summary		Get rules configurations
//	@Description	Reads and returns the contents of the rules.md file. Supports formatting the rules for specific environments (e.g., cursor, claude, agents, openclaw) via the 'format' query parameter.
//	@Tags			rules
//	@Security		BearerAuth
//	@Produce		plain
//	@Param			format	query		string	false	"Format option (cursor, claude, agents, openclaw, skill)"
//	@Success		200		{string}	string
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/rules [get]
func (h *Handlers) Rules(c echo.Context) error {
	rulesPath := filepath.Join(h.root, ".kiwi", "rules.md")
	data, err := os.ReadFile(rulesPath)
	if err != nil {
		if os.IsNotExist(err) {
			format := c.QueryParam("format")
			if format != "" {
				return c.String(http.StatusOK, formatRules("", format))
			}
			return c.String(http.StatusOK, "")
		}
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	raw := string(data)
	format := c.QueryParam("format")
	if format == "" {
		return c.String(http.StatusOK, raw)
	}
	return c.String(http.StatusOK, formatRules(raw, format))
}

type putRulesResponse struct {
	Status string `json:"status" example:"ok"`
	Path   string `json:"path" example:".kiwi/rules.md"`
}

// PutRules godoc
//
//	@Summary		Update rules configuration
//	@Description	Writes the request body content to the rules.md file and commits it to the repository.
//	@Tags			rules
//	@Security		BearerAuth
//	@Accept			plain
//	@Produce		json
//	@Param			body	body		string	true	"Rules markdown content (max 256 KB)"
//	@Param			X-Actor	header		string	false	"Actor identity performing the write"
//	@Success		200		{object}	putRulesResponse
//	@Failure		400		{object}	map[string]string
//	@Failure		413		{object}	map[string]string
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/rules [put]
func (h *Handlers) PutRules(c echo.Context) error {
	const maxBody = 256 << 10
	body, err := io.ReadAll(io.LimitReader(c.Request().Body, maxBody+1))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "failed to read body")
	}
	if len(body) > maxBody {
		return echo.NewHTTPError(http.StatusRequestEntityTooLarge, "rules exceed 256 KB")
	}

	dir := filepath.Join(h.root, ".kiwi")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	p := filepath.Join(dir, "rules.md")
	if err := os.WriteFile(p, body, 0o644); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	actor := sanitizeActor(c.Request().Header.Get("X-Actor"))
	if actor == "anonymous" {
		actor = pipeline.DefaultActor
	}
	if cerr := h.versioner.Commit(c.Request().Context(), ".kiwi/rules.md", actor, "rules: update"); cerr != nil {
		log.Printf("handlers: commit rules: %v", cerr)
	}

	return c.JSON(http.StatusOK, putRulesResponse{Status: "ok", Path: ".kiwi/rules.md"})
}

func formatRules(raw, format string) string {
	userRules := strings.TrimSpace(raw)

	switch format {
	case "cursor":
		return formatCursor(userRules)
	case "claude":
		return formatClaude(userRules)
	case "agents":
		return formatAgents(userRules)
	case "openclaw":
		return formatOpenClaw(userRules)
	case "skill":
		return formatSkill(userRules)
	default:
		return raw
	}
}

func formatSkill(userRules string) string {
	var sb strings.Builder
	sb.WriteString("# Team Wiki Skill\n\n")
	sb.WriteString("Use when the user asks about team processes, architecture, onboarding, or anything documented in the team wiki.\n\n")
	sb.WriteString("## How to use\n\n")
	sb.WriteString("1. Search the wiki: use `kiwi_search` with relevant keywords\n")
	sb.WriteString("2. Read results: use `kiwi_read` to get full page content\n")
	sb.WriteString("3. Synthesize an answer from the wiki content — prefer wiki facts over guessing\n\n")
	sb.WriteString("## Wiki structure\n\n")
	sb.WriteString("- Use `kiwi_tree` to browse folders and discover where topics live\n")
	sb.WriteString("- Call `kiwi_context` for schema, playbook, index, and `.kiwi/rules.md`\n")
	sb.WriteString("- Pages are markdown files in the KiwiFS workspace; links use wiki-style paths\n\n")
	sb.WriteString("## Example queries\n\n")
	sb.WriteString("- \"How does our deployment process work?\" → `kiwi_search(\"deployment\")`\n")
	sb.WriteString("- \"What are our coding standards?\" → `kiwi_search(\"coding standards\")`\n")
	sb.WriteString("- \"Where is onboarding documented?\" → `kiwi_search(\"onboarding\")` then `kiwi_read` the best match\n\n")
	if userRules != "" {
		sb.WriteString("## User rules\n\n")
		sb.WriteString(userRules)
		if !strings.HasSuffix(userRules, "\n") {
			sb.WriteString("\n")
		}
	}
	return sb.String()
}

func formatCursor(userRules string) string {
	var sb strings.Builder
	sb.WriteString("---\n")
	sb.WriteString("description: KiwiFS knowledge base rules\n")
	sb.WriteString("globs: \"**/*\"\n")
	sb.WriteString("alwaysApply: true\n")
	sb.WriteString("---\n\n")
	sb.WriteString("# KiwiFS Knowledge Base\n\n")
	sb.WriteString("You have a KiwiFS knowledge base connected via MCP (server name: \"kiwi\").\n\n")
	sb.WriteString("## Available tools\n\n")
	sb.WriteString("- kiwi_write — create/update markdown pages (every write is versioned)\n")
	sb.WriteString("- kiwi_read — read a page\n")
	sb.WriteString("- kiwi_search — full-text search across all pages\n")
	sb.WriteString("- kiwi_tree — browse folder structure\n")
	sb.WriteString("- kiwi_context — get schema, playbook, index, and rules\n\n")
	if userRules != "" {
		sb.WriteString("## User rules\n\n")
		sb.WriteString(userRules)
		sb.WriteString("\n")
	}
	return sb.String()
}

func formatClaude(userRules string) string {
	var sb strings.Builder
	sb.WriteString("## KiwiFS Knowledge Base\n\n")
	sb.WriteString("This project has a KiwiFS knowledge base connected via MCP.\n")
	sb.WriteString("Use kiwi_write, kiwi_read, kiwi_search to manage persistent knowledge.\n\n")
	if userRules != "" {
		sb.WriteString("### Rules\n\n")
		sb.WriteString(userRules)
		sb.WriteString("\n")
	}
	return sb.String()
}

func formatAgents(userRules string) string {
	var sb strings.Builder
	sb.WriteString("## KiwiFS Knowledge Base\n\n")
	sb.WriteString("A KiwiFS knowledge base is available via MCP.\n")
	sb.WriteString("Tools: kiwi_write, kiwi_read, kiwi_search, kiwi_tree, kiwi_context.\n\n")
	if userRules != "" {
		sb.WriteString("### Agent Rules\n\n")
		sb.WriteString(userRules)
		sb.WriteString("\n")
	}
	return sb.String()
}

func formatOpenClaw(userRules string) string {
	rules := userRules
	if rules == "" {
		rules = "(no rules defined)"
	}
	return fmt.Sprintf(`{
		"kiwifs": {
			"type": "mcp",
			"tools": ["kiwi_write", "kiwi_read", "kiwi_search", "kiwi_tree", "kiwi_context"],
			"rules": %q
		}
	}`, rules)
}
