package mcpserver

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMCP_KiwiRecall(t *testing.T) {
	b, tmp := setupTestBackend(t)
	defer b.Close()

	path := "episodes/auth-migration.md"
	body := "---\ntitle: Auth Migration Plan\nconfidence: 0.9\n---\n# Auth Migration\nWe decided to migrate auth to OAuth.\n"
	if err := os.MkdirAll(filepath.Join(tmp, "episodes"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tmp, path), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := b.init(); err != nil {
		t.Fatal(err)
	}
	if err := b.stack.Searcher.Index(t.Context(), path, []byte(body)); err != nil {
		t.Fatalf("index: %v", err)
	}

	out := mustCallTool(t, handleRecall(b), "kiwi_recall", map[string]any{
		"query":          "auth migration",
		"limit":          float64(5),
		"sources":        []any{"fts"},
		"boost_verified": true,
	})
	if !strings.Contains(out, "auth-migration.md") {
		t.Fatalf("want auth-migration.md in:\n%s", out)
	}
	if !strings.Contains(out, "sources: fts") {
		t.Fatalf("want fts source in:\n%s", out)
	}
}

func TestMCP_KiwiRecallRequiresQuery(t *testing.T) {
	b, _ := setupTestBackend(t)
	defer b.Close()

	req := callToolReq("kiwi_recall", map[string]any{"limit": float64(5)})
	result, err := handleRecall(b)(t.Context(), req)
	if err != nil {
		t.Fatalf("handleRecall: %v", err)
	}
	if !result.IsError {
		t.Fatalf("expected error result, got: %+v", result)
	}
}
