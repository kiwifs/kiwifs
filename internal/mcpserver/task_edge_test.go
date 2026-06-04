package mcpserver

import (
	"strings"
	"testing"
)

func TestTaskSlugEdgeCases(t *testing.T) {
	cases := []struct {
		title string
		want  string
	}{
		{"", "task"},
		{"   ", "task"},
		{"!@#$%^&*()", "task"},
		{"---", "task"},
		{"Hello World", "hello-world"},
		{"CamelCaseTitle", "camelcasetitle"},
		{"multiple   spaces   between", "multiple-spaces-between"},
		{"leading---dashes---trailing", "leading-dashes-trailing"},
		{"unicode: 日本語テスト", "unicode"},  // taskSlugFromTitle only preserves ASCII letters/digits
		{"123 numeric only", "123-numeric-only"},
		{"a", "a"},
		{"a-b-c", "a-b-c"},
		{"UPPER CASE TITLE", "upper-case-title"},
		{"file/path/like", "file-path-like"},
		{"dot.separated.title", "dot-separated-title"},
		{"title_with_underscores", "title-with-underscores"},
		{"title\twith\ttabs", "title-with-tabs"},
		{"title\nwith\nnewlines", "title-with-newlines"},
		{strings.Repeat("a", 500), strings.Repeat("a", 500)},
	}
	for _, tc := range cases {
		got := taskSlugFromTitle(tc.title)
		if got != tc.want {
			t.Errorf("taskSlugFromTitle(%q) = %q, want %q", tc.title, got, tc.want)
		}
	}
}

func TestAppendTaskProgressEdgeCases(t *testing.T) {
	// Empty content
	out := appendTaskProgress("", "agent", "msg")
	if !strings.Contains(out, "## Progress") || !strings.Contains(out, "msg") {
		t.Fatalf("empty content: %q", out)
	}

	// Content with multiple H2 sections after Progress
	multiH2 := "# Task\n\n## Progress\n\n### old\nOld entry.\n\n## Notes\n\nSome notes.\n\n## References\n\nRefs.\n"
	out = appendTaskProgress(multiH2, "b", "New update.")
	if !strings.Contains(out, "New update.") {
		t.Fatalf("multi-H2: missing entry: %q", out)
	}
	// Notes and References should still be present
	if !strings.Contains(out, "## Notes") || !strings.Contains(out, "## References") {
		t.Fatalf("multi-H2: lost sections: %q", out)
	}
	// No content duplication
	if strings.Count(out, "Old entry.") > 1 {
		t.Fatalf("multi-H2: duplicated content: %q", out)
	}
	if strings.Count(out, "## Notes") > 1 {
		t.Fatalf("multi-H2: duplicated Notes section: %q", out)
	}
	// Progress should appear before Notes
	progIdx := strings.Index(out, "New update.")
	notesIdx := strings.Index(out, "## Notes")
	if progIdx > notesIdx {
		t.Fatalf("progress appended after Notes section: prog=%d notes=%d\n%s", progIdx, notesIdx, out)
	}

	// Empty agent defaults to mcp-agent
	out = appendTaskProgress("# T\n", "", "msg")
	if !strings.Contains(out, "mcp-agent") {
		t.Fatalf("empty agent: %q", out)
	}

	// Very long message
	longMsg := strings.Repeat("x", 10000)
	out = appendTaskProgress("# T\n\n## Progress\n", "a", longMsg)
	if !strings.Contains(out, longMsg) {
		t.Fatal("long message truncated")
	}

	// Message with markdown that shouldn't be escaped
	mdMsg := "Found **3 bugs** in `auth.go`. See [PR #42](https://github.com/org/repo/pull/42)."
	out = appendTaskProgress("# T\n", "agent", mdMsg)
	if !strings.Contains(out, "**3 bugs**") || !strings.Contains(out, "[PR #42]") {
		t.Fatalf("markdown in msg: %q", out)
	}
}

func TestBuildTaskMarkdownEdgeCases(t *testing.T) {
	// Minimal
	md, err := buildTaskMarkdown("Test", "", "", 3, nil, nil, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(md, "workflow: tasks") || !strings.Contains(md, "state: backlog") {
		t.Fatalf("missing workflow/state: %s", md)
	}
	if !strings.Contains(md, "title: Test") {
		t.Fatalf("missing title: %s", md)
	}

	// All fields populated
	md, err = buildTaskMarkdown("Complex Task", "Custom body.", "alice", 1,
		[]string{"tasks/dep-a.md", "tasks/dep-b.md"},
		[]string{"urgent", "backend"},
		"tasks/parent.md",
		[]string{"docs/spec.md"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(md, "assignee: alice") {
		t.Fatalf("missing assignee: %s", md)
	}
	if !strings.Contains(md, "tasks/dep-a.md") || !strings.Contains(md, "tasks/dep-b.md") {
		t.Fatalf("missing blocked_by: %s", md)
	}
	if !strings.Contains(md, "parent: tasks/parent.md") {
		t.Fatalf("missing parent: %s", md)
	}

	// Title with YAML-special characters
	md, err = buildTaskMarkdown("Task: with colons & 'quotes' and \"doubles\"", "", "", 3, nil, nil, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(md, "Task:") {
		t.Fatalf("YAML-special title: %s", md)
	}

	// Priority boundary
	md, err = buildTaskMarkdown("P1", "", "", 1, nil, nil, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(md, "priority: 1") {
		t.Fatalf("priority 1: %s", md)
	}
}
