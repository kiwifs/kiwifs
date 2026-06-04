package mcpserver

import (
	"strings"
	"testing"
)

func TestTaskSlugFromTitle(t *testing.T) {
	if got := taskSlugFromTitle("Add Login Rate Limit"); got != "add-login-rate-limit" {
		t.Fatalf("slug = %q", got)
	}
}

func TestAppendTaskProgressCreatesSection(t *testing.T) {
	out := appendTaskProgress("# Task\n\nBody.\n", "agent-a", "First update.")
	if !strings.Contains(out, "## Progress") {
		t.Fatal("missing progress heading")
	}
	if !strings.Contains(out, "agent-a") || !strings.Contains(out, "First update.") {
		t.Fatal("missing entry:", out)
	}
}

func TestAppendTaskProgressAppendsSecondEntry(t *testing.T) {
	base := "# Task\n\n## Progress\n\n### 2026-01-01T00:00:00Z — a\n\nOld.\n"
	out := appendTaskProgress(base, "b", "New.")
	if strings.Count(out, "### ") < 2 {
		t.Fatalf("expected two entries, got:\n%s", out)
	}
	if !strings.Contains(out, "New.") {
		t.Fatal("missing second entry")
	}
}

func TestHandleTaskCreateAndProgress(t *testing.T) {
	b, _ := setupTestBackend(t)
	defer b.Close()

	text := mustCallTool(t, handleTaskCreate(b), "kiwi_task_create", map[string]any{
		"title":       "Ship MCP task tools",
		"description": "## Summary\n\nImplement create + progress.",
		"priority":    float64(2),
	})
	if !strings.Contains(text, "tasks/ship-mcp-task-tools.md") {
		t.Fatalf("unexpected create result: %s", text)
	}

	prog := mustCallTool(t, handleTaskProgress(b), "kiwi_task_progress", map[string]any{
		"path":    "tasks/ship-mcp-task-tools.md",
		"message": "Handlers registered and tested.",
		"agent":   "test-agent",
	})
	if !strings.Contains(prog, "Progress appended") {
		t.Fatalf("unexpected progress result: %s", prog)
	}

	body := mustCallTool(t, handleRead(b), "kiwi_read", map[string]any{
		"path": "tasks/ship-mcp-task-tools.md",
	})
	if !strings.Contains(body, "workflow: tasks") || !strings.Contains(body, "## Progress") {
		t.Fatalf("task file missing expected content:\n%s", body)
	}
}
