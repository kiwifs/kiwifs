package mcpserver

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func setupHybridBackend(t *testing.T) *LocalBackend {
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
	write("notes/alpha.md", "# Alpha\n\nzebrabyte zebrabyte zebrabyte\n")
	write("notes/beta.md", "# Beta\n\nzebrabyte zebrabyte\n")
	write("other/gamma.md", "# Gamma\n\nzebrabyte\n")

	if err := b.init(); err != nil {
		t.Fatalf("init: %v", err)
	}
	if _, err := b.stack.Searcher.Reindex(context.Background()); err != nil {
		t.Fatalf("reindex: %v", err)
	}
	return b
}

// Without a vector index the tool still answers — a hybrid search that errors
// because an optional index is absent is worse than one that degrades.
func TestSearchHybridToolFallsBackToLexical(t *testing.T) {
	b := setupHybridBackend(t)

	out := mustCallTool(t, handleSearchHybrid(b), "kiwi_search_hybrid", map[string]any{
		"query": "zebrabyte",
	})
	if !strings.Contains(out, "notes/alpha.md") {
		t.Fatalf("expected the top lexical hit:\n%s", out)
	}
	// The provenance of each hit is spelled out, not left to the score.
	if !strings.Contains(out, "keyword only") {
		t.Fatalf("expected per-engine attribution:\n%s", out)
	}
}

func TestSearchHybridToolPathPrefix(t *testing.T) {
	b := setupHybridBackend(t)

	out := mustCallTool(t, handleSearchHybrid(b), "kiwi_search_hybrid", map[string]any{
		"query":       "zebrabyte",
		"path_prefix": "notes/",
	})
	if strings.Contains(out, "other/gamma.md") {
		t.Fatalf("path_prefix was ignored:\n%s", out)
	}
	if !strings.Contains(out, "notes/alpha.md") {
		t.Fatalf("expected notes/ hits:\n%s", out)
	}
}

func TestSearchHybridToolLimit(t *testing.T) {
	b := setupHybridBackend(t)

	out := mustCallTool(t, handleSearchHybrid(b), "kiwi_search_hybrid", map[string]any{
		"query": "zebrabyte",
		"limit": float64(1),
	})
	if strings.Count(out, ".md") != 1 {
		t.Fatalf("limit was ignored:\n%s", out)
	}
}

func TestSearchHybridToolRequiresQuery(t *testing.T) {
	b := setupHybridBackend(t)
	msg := mustCallToolError(t, handleSearchHybrid(b), "kiwi_search_hybrid", map[string]any{})
	if !strings.Contains(msg, "query is required") {
		t.Fatalf("unexpected error: %s", msg)
	}
}

func TestDescribeHybridRanks(t *testing.T) {
	cases := []struct {
		in   HybridSearchResult
		want string
	}{
		{HybridSearchResult{FTSRank: 2, SemanticRank: 1}, "both: keyword #2, semantic #1"},
		{HybridSearchResult{FTSRank: 3}, "keyword only, #3"},
		{HybridSearchResult{SemanticRank: 4}, "semantic only, #4"},
		{HybridSearchResult{}, "unranked"},
	}
	for _, tc := range cases {
		if got := describeHybridRanks(tc.in); got != tc.want {
			t.Errorf("got %q, want %q", got, tc.want)
		}
	}
}
