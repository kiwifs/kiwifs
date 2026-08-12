package mcpserver

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func setupBriefBackend(t *testing.T) *LocalBackend {
	t.Helper()
	b, root := setupTestBackend(t)
	write := func(rel, body string) {
		t.Helper()
		full := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("notes/small.md", "# Small\n\nzebrabyte lives here.\n")
	write("notes/big.md", "# Big\n\nzebrabyte.\n\n## Padding\n\n"+
		strings.Repeat("padding text that goes on and on. ", 400)+"\n")

	if err := b.init(); err != nil {
		t.Fatalf("init: %v", err)
	}
	if _, err := b.stack.Searcher.Reindex(context.Background()); err != nil {
		t.Fatalf("reindex: %v", err)
	}
	return b
}

func TestBriefToolAssemblesPack(t *testing.T) {
	b := setupBriefBackend(t)

	out := mustCallTool(t, handleBrief(b), "kiwi_brief", map[string]any{
		"query":         "zebrabyte",
		"budget_tokens": float64(4000),
	})
	if !strings.Contains(out, "# Context pack: zebrabyte") {
		t.Fatalf("missing header:\n%s", out)
	}
	if !strings.Contains(out, "zebrabyte lives here.") {
		t.Fatalf("page content missing:\n%s", out)
	}
	if !strings.Contains(out, "tokens used (counted with cl100k_base)") {
		t.Fatalf("budget accounting missing:\n%s", out)
	}
}

// The manifest, not a summary, is what a squeezed budget produces.
func TestBriefToolReportsDropped(t *testing.T) {
	b := setupBriefBackend(t)

	out := mustCallTool(t, handleBrief(b), "kiwi_brief", map[string]any{
		"query":         "zebrabyte",
		"budget_tokens": float64(40),
	})
	if !strings.Contains(out, "## Not included") {
		t.Fatalf("expected a dropped manifest:\n%s", out)
	}
	if !strings.Contains(out, "tokens)") {
		t.Fatalf("dropped entries should carry their token cost:\n%s", out)
	}
	if !strings.Contains(out, "kiwi_read") {
		t.Fatalf("the manifest should say how to fetch what was withheld:\n%s", out)
	}
}

func TestBriefToolPathPrefix(t *testing.T) {
	b := setupBriefBackend(t)

	pack, err := b.Brief(context.Background(), BriefRequest{
		Query:      "zebrabyte",
		PathPrefix: "notes/",
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range pack.Items {
		if !strings.HasPrefix(item.Path, "notes/") {
			t.Fatalf("path_prefix ignored: %s", item.Path)
		}
	}
	if len(pack.Items) == 0 {
		t.Fatal("expected results under notes/")
	}
}

func TestBriefToolRequiresQuery(t *testing.T) {
	b := setupBriefBackend(t)
	msg := mustCallToolError(t, handleBrief(b), "kiwi_brief", map[string]any{})
	if !strings.Contains(msg, "query is required") {
		t.Fatalf("unexpected error: %s", msg)
	}
}

func TestBriefToolNeverExceedsBudget(t *testing.T) {
	b := setupBriefBackend(t)

	for _, budget := range []int{20, 100, 500, 4000} {
		pack, err := b.Brief(context.Background(), BriefRequest{
			Query:        "zebrabyte",
			BudgetTokens: budget,
		})
		if err != nil {
			t.Fatalf("budget %d: %v", budget, err)
		}
		if pack.UsedTokens > budget {
			t.Errorf("budget %d: used %d", budget, pack.UsedTokens)
		}
	}
}
