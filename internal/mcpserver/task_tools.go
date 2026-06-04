package mcpserver

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

const defaultTaskWorkflow = "tasks"

func taskSlugFromTitle(title string) string {
	s := strings.ToLower(strings.TrimSpace(title))
	var b strings.Builder
	lastDash := false
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			lastDash = false
			continue
		}
		if !lastDash && b.Len() > 0 {
			b.WriteByte('-')
			lastDash = true
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		out = "task"
	}
	return out
}

func buildTaskMarkdown(title, description, assignee string, priority int, blockedBy, labels []string, parent string, artifacts []string) (string, error) {
	fm := map[string]any{
		"type":     "task",
		"title":    title,
		"workflow": defaultTaskWorkflow,
		"state":    "backlog",
		"priority": priority,
	}
	if assignee != "" {
		fm["assignee"] = assignee
	}
	if len(blockedBy) > 0 {
		fm["blocked_by"] = blockedBy
	} else {
		fm["blocked_by"] = []string{}
	}
	if len(labels) > 0 {
		fm["labels"] = labels
	} else {
		fm["labels"] = []string{}
	}
	if parent != "" {
		fm["parent"] = parent
	}
	if len(artifacts) > 0 {
		fm["artifacts"] = artifacts
	} else {
		fm["artifacts"] = []string{}
	}
	fm["due_date"] = ""

	yamlBytes, err := yamlMarshal(fm)
	if err != nil {
		return "", err
	}

	var buf strings.Builder
	buf.WriteString("---\n")
	buf.Write(yamlBytes)
	buf.WriteString("---\n\n")
	if strings.TrimSpace(description) != "" {
		buf.WriteString(strings.TrimSpace(description))
		if !strings.HasSuffix(description, "\n") {
			buf.WriteByte('\n')
		}
	} else {
		fmt.Fprintf(&buf, "## Summary\n\n%s\n", title)
	}
	return buf.String(), nil
}

func appendTaskProgress(content, agent, message string) string {
	agent = strings.TrimSpace(agent)
	if agent == "" {
		agent = "mcp-agent"
	}
	entry := fmt.Sprintf("### %s — %s\n\n%s\n", time.Now().UTC().Format(time.RFC3339), agent, strings.TrimSpace(message))

	progressHeading := "## Progress"
	idx := strings.Index(content, progressHeading)
	if idx < 0 {
		trimmed := strings.TrimRight(content, "\n")
		return trimmed + "\n\n" + progressHeading + "\n\n" + entry
	}

	after := idx + len(progressHeading)
	rest := content[after:]
	nextH2 := strings.Index(rest, "\n## ")
	if nextH2 >= 0 {
		before := content[:idx+after+nextH2]
		middle := strings.TrimRight(rest[:nextH2], "\n") + "\n\n" + entry
		tail := rest[nextH2:]
		return strings.TrimRight(before, "\n") + middle + tail
	}
	return strings.TrimRight(content, "\n") + "\n\n" + entry
}

func handleTaskCreate(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		title, _ := args["title"].(string)
		if strings.TrimSpace(title) == "" {
			return mcp.NewToolResultError("title is required"), nil
		}

		description, _ := args["description"].(string)
		assignee, _ := args["assignee"].(string)
		priority := intArg(args, "priority", 3)
		if priority < 1 || priority > 5 {
			return mcp.NewToolResultError("priority must be between 1 and 5"), nil
		}

		blockedBy := stringSliceArg(args, "blocked_by")
		labels := stringSliceArg(args, "labels")
		parent, _ := args["parent"].(string)
		artifacts := stringSliceArg(args, "artifacts")

		claim, _ := args["claim"].(bool)
		actor, _ := args["actor"].(string)
		if actor == "" {
			actor = "mcp-agent"
		}

		slug := taskSlugFromTitle(title)
		path := "tasks/" + slug + ".md"

		body, err := buildTaskMarkdown(title, description, assignee, priority, blockedBy, labels, parent, artifacts)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("build task: %v", err)), nil
		}

		_, err = b.WriteFile(ctx, path, body, actor, "")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("write task: %v", err)), nil
		}

		if claim {
			if _, err := b.Claim(ctx, path, actor, 30*time.Minute); err != nil {
				return mcp.NewToolResultError(fmt.Sprintf("created %s but claim failed: %v", path, err)), nil
			}
		}

		return mcp.NewToolResultText(fmt.Sprintf("Created task %s (workflow: %s, state: backlog)", path, defaultTaskWorkflow)), nil
	}
}

func handleTaskProgress(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		path, err := mutationPathArg(args, "path")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		message, _ := args["message"].(string)
		if strings.TrimSpace(message) == "" {
			return mcp.NewToolResultError("message is required"), nil
		}
		agent, _ := args["agent"].(string)
		actor, _ := args["actor"].(string)
		if actor == "" {
			actor = "mcp-agent"
		}
		if agent == "" {
			agent = actor
		}

		content, _, err := b.ReadFile(ctx, path)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("read task: %v", err)), nil
		}

		updated := appendTaskProgress(content, agent, message)
		etag, err := b.WriteFile(ctx, path, updated, actor, "")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("write progress: %v", err)), nil
		}
		return mcp.NewToolResultText(fmt.Sprintf("Progress appended to %s (ETag: %s)", path, etag)), nil
	}
}

func stringSliceArg(args map[string]any, key string) []string {
	raw, ok := args[key]
	if !ok || raw == nil {
		return nil
	}
	switch v := raw.(type) {
	case []string:
		return v
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if s, ok := item.(string); ok && s != "" {
				out = append(out, s)
			}
		}
		return out
	default:
		return nil
	}
}
