package mcpserver

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kiwifs/kiwifs/internal/markdown"
	"github.com/kiwifs/kiwifs/internal/workspace"
)

func TestADRWorkflowAdvanceSyncsStatus(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	if err := workspace.Init(root, "adr"); err != nil {
		t.Fatal(err)
	}
	b := NewLocalBackend(root)
	defer b.Close()
	ctx := context.Background()

	path := "decisions/ADR-002-test-sync.md"
	content := `---
type: adr
title: "ADR-002: Status sync test"
status: proposed
date: 2026-06-20
deciders: [engineering-team]
workflow: adr
state: proposed
---
# ADR-002

Test workflow advance keeps status aligned with state.
`
	if _, err := b.WriteFile(ctx, path, content, "author", ""); err != nil {
		t.Fatal(err)
	}

	result, err := b.WorkflowAdvance(ctx, path, "accepted", "reviewer")
	if err != nil {
		t.Fatalf("WorkflowAdvance: %v", err)
	}
	if result.FromState != "proposed" || result.ToState != "accepted" {
		t.Fatalf("unexpected transition: %+v", result)
	}

	raw, _, err := b.ReadFile(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	disk, err := os.ReadFile(filepath.Join(root, path))
	if err != nil {
		t.Fatal(err)
	}
	fm, err := markdown.Frontmatter(disk)
	if err != nil {
		t.Fatal(err)
	}
	if fm["state"] != "accepted" {
		t.Fatalf("state = %v, want accepted\nfile on disk:\n%s", fm["state"], disk)
	}
	if fm["status"] != "accepted" {
		t.Fatalf("status = %v, want accepted (must mirror state for ADRs)\nread via backend:\n%s", fm["status"], raw)
	}
}

func TestADRWorkflowAdvanceRejectsInvalidTransition(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	if err := workspace.Init(root, "adr"); err != nil {
		t.Fatal(err)
	}
	b := NewLocalBackend(root)
	defer b.Close()
	ctx := context.Background()

	path := "decisions/ADR-003-skip-test.md"
	content := `---
type: adr
title: "ADR-003: Skip test"
status: proposed
date: 2026-06-20
deciders: [engineering-team]
workflow: adr
state: proposed
---
# ADR-003
`
	if _, err := b.WriteFile(ctx, path, content, "author", ""); err != nil {
		t.Fatal(err)
	}

	_, err := b.WorkflowAdvance(ctx, path, "superseded", "reviewer")
	if err == nil {
		t.Fatal("expected error for proposed -> superseded skip")
	}
	if !strings.Contains(err.Error(), "transition") {
		t.Fatalf("unexpected error: %v", err)
	}
}
