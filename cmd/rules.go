package cmd

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strings"

	"github.com/spf13/cobra"
)

var rulesCmd = &cobra.Command{
	Use:   "rules",
	Short: "View and manage workspace rules",
	Long: `View and manage the .kiwi/rules.md file that defines persistent agent behavior.

Rules are plain markdown stored at .kiwi/rules.md. They can be exported in
harness-specific formats (Cursor, Claude Code, AGENTS.md, OpenClaw).`,
	RunE: rulesShow,
}

var rulesEditCmd = &cobra.Command{
	Use:   "edit",
	Short: "Open rules in $EDITOR",
	RunE:  rulesEdit,
}

var rulesExportCmd = &cobra.Command{
	Use:   "export",
	Short: "Export rules in a harness-specific format",
	Example: `  kiwifs rules export --format cursor
  kiwifs rules export --format claude
  kiwifs rules export --format skill
  kiwifs rules sync --format skill`,
	RunE: rulesExport,
}

var rulesSyncCmd = &cobra.Command{
	Use:   "sync",
	Short: "Export rules and write to a local file",
	Example: `  kiwifs rules sync --format cursor --output .cursor/rules/kiwi.md
  kiwifs rules sync --format claude --output CLAUDE.md`,
	RunE: rulesSync,
}

func init() {
	rulesCmd.AddCommand(rulesEditCmd)
	rulesCmd.AddCommand(rulesExportCmd)
	rulesCmd.AddCommand(rulesSyncCmd)

	for _, c := range []*cobra.Command{rulesCmd, rulesEditCmd, rulesExportCmd, rulesSyncCmd} {
		c.Flags().String("remote", "", "KiwiFS server URL (reads from local .kiwi/rules.md if omitted)")
		c.Flags().String("api-key", "", "API key for remote server")
	}

	rulesExportCmd.Flags().String("format", "cursor", "Export format: cursor, claude, agents, openclaw, skill")
	rulesSyncCmd.Flags().String("format", "cursor", "Export format: cursor, claude, agents, openclaw, skill")
	rulesSyncCmd.Flags().StringP("output", "o", "", "Output file path (defaults to .cursor/skills/team-wiki/SKILL.md for --format skill)")
}

func rulesShow(cmd *cobra.Command, args []string) error {
	remote, _ := cmd.Flags().GetString("remote")
	apiKey, _ := cmd.Flags().GetString("api-key")

	if remote != "" {
		body, err := fetchRules(remote, apiKey, "")
		if err != nil {
			return err
		}
		fmt.Print(body)
		return nil
	}

	data, err := os.ReadFile(".kiwi/rules.md")
	if err != nil {
		if os.IsNotExist(err) {
			fmt.Println("(no .kiwi/rules.md found — create one with `kiwifs rules edit`)")
			return nil
		}
		return err
	}
	fmt.Print(string(data))
	return nil
}

func rulesEdit(cmd *cobra.Command, args []string) error {
	remote, _ := cmd.Flags().GetString("remote")
	if remote != "" {
		return fmt.Errorf("--remote editing not supported yet; use the cloud dashboard or kiwi_write MCP tool")
	}

	if err := os.MkdirAll(".kiwi", 0o755); err != nil {
		return err
	}

	path := ".kiwi/rules.md"
	if _, err := os.Stat(path); os.IsNotExist(err) {
		starter := "# Agent Rules\n\n## Always\n\n- \n\n## Structure\n\n- \n"
		if werr := os.WriteFile(path, []byte(starter), 0o644); werr != nil {
			return werr
		}
	}

	editor := os.Getenv("EDITOR")
	if editor == "" {
		editor = "vi"
	}
	c := exec.Command(editor, path)
	c.Stdin = os.Stdin
	c.Stdout = os.Stdout
	c.Stderr = os.Stderr
	return c.Run()
}

func rulesExport(cmd *cobra.Command, args []string) error {
	remote, _ := cmd.Flags().GetString("remote")
	apiKey, _ := cmd.Flags().GetString("api-key")
	format, _ := cmd.Flags().GetString("format")

	if remote != "" {
		body, err := fetchRules(remote, apiKey, format)
		if err != nil {
			return err
		}
		fmt.Print(body)
		return nil
	}

	raw, err := os.ReadFile(".kiwi/rules.md")
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	content := localFormatRules(string(raw), format)
	if format == "skill" {
		const skillPath = ".cursor/skills/team-wiki/SKILL.md"
		if err := writeRulesOutput(skillPath, content); err != nil {
			return err
		}
		fmt.Fprintf(os.Stderr, "Wrote %s (%d bytes)\n", skillPath, len(content))
	}
	fmt.Print(content)
	return nil
}

func rulesSync(cmd *cobra.Command, args []string) error {
	remote, _ := cmd.Flags().GetString("remote")
	apiKey, _ := cmd.Flags().GetString("api-key")
	format, _ := cmd.Flags().GetString("format")
	output, _ := cmd.Flags().GetString("output")
	if output == "" && format == "skill" {
		output = ".cursor/skills/team-wiki/SKILL.md"
	}
	if output == "" {
		return fmt.Errorf("--output is required (except for --format skill, which defaults to .cursor/skills/team-wiki/SKILL.md)")
	}

	var content string
	if remote != "" {
		body, err := fetchRules(remote, apiKey, format)
		if err != nil {
			return err
		}
		content = body
	} else {
		raw, err := os.ReadFile(".kiwi/rules.md")
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		content = localFormatRules(string(raw), format)
	}

	if err := writeRulesOutput(output, content); err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "Wrote %s (%d bytes)\n", output, len(content))
	return nil
}

func writeRulesOutput(path, content string) error {
	dir := dirOf(path)
	if dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	return os.WriteFile(path, []byte(content), 0o644)
}

func dirOf(path string) string {
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '/' {
			return path[:i]
		}
	}
	return ""
}

func fetchRules(baseURL, apiKey, format string) (string, error) {
	u := strings.TrimRight(baseURL, "/") + "/api/kiwi/rules"
	if format != "" {
		u += "?format=" + url.QueryEscape(format)
	}
	req, err := http.NewRequest("GET", u, nil)
	if err != nil {
		return "", err
	}
	if apiKey == "" {
		apiKey = os.Getenv("KIWI_API_KEY")
	}
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("server returned %d: %s", resp.StatusCode, string(body))
	}
	return string(body), nil
}

func localFormatRules(raw, format string) string {
	userRules := strings.TrimSpace(raw)

	switch format {
	case "cursor":
		return localFormatCursor(userRules)
	case "claude":
		return localFormatClaude(userRules)
	case "agents":
		return localFormatAgents(userRules)
	case "openclaw":
		return localFormatOpenClaw(userRules)
	case "skill":
		return localFormatSkill(userRules)
	default:
		return raw
	}
}

func localFormatSkill(userRules string) string {
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

func localFormatCursor(userRules string) string {
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

func localFormatClaude(userRules string) string {
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

func localFormatAgents(userRules string) string {
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

func localFormatOpenClaw(userRules string) string {
	rules := userRules
	if rules == "" {
		rules = "(no rules defined)"
	}
	j, _ := json.MarshalIndent(map[string]any{
		"kiwifs": map[string]any{
			"type":  "mcp",
			"tools": []string{"kiwi_write", "kiwi_read", "kiwi_search", "kiwi_tree", "kiwi_context"},
			"rules": rules,
		},
	}, "", "  ")
	return string(j) + "\n"
}
