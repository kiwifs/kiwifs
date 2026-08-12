package mcpserver

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"

	"github.com/kiwifs/kiwifs/internal/similar"
)

// mustCallToolError is mustCallTool's mirror: it requires the tool to fail
// and returns the message.
func mustCallToolError(t *testing.T, handler server.ToolHandlerFunc, name string, args map[string]any) string {
	t.Helper()
	req := mcp.CallToolRequest{}
	req.Params.Name = name
	req.Params.Arguments = args
	result, err := handler(context.Background(), req)
	if err != nil {
		t.Fatalf("%s: transport error: %v", name, err)
	}
	if !result.IsError {
		t.Fatalf("%s: want an error result, got %v", name, result.Content)
	}
	if len(result.Content) == 0 {
		return ""
	}
	return result.Content[0].(mcp.TextContent).Text
}

func setupSimilarBackend(t *testing.T) *LocalBackend {
	t.Helper()
	tmp := t.TempDir()
	kiwiDir := filepath.Join(tmp, ".kiwi")
	if err := os.MkdirAll(kiwiDir, 0o755); err != nil {
		t.Fatal(err)
	}
	cfg := `
[search]
engine = "sqlite"
[versioning]
strategy = "none"

[[similarity.profiles]]
name = "dataset"
match = { kind = "dataset" }
numeric = ["stats.rows"]
categorical = ["format", "license", "stats.ordered"]

[[similarity.profiles]]
name = "dataset-weighted"
match = { kind = "dataset" }
numeric = ["stats.rows"]
categorical = ["format", "license", "stats.ordered"]
weights = { "stats.ordered" = 3.0 }
`
	if err := os.WriteFile(filepath.Join(kiwiDir, "config.toml"), []byte(cfg), 0o644); err != nil {
		t.Fatal(err)
	}
	datasets := filepath.Join(tmp, "datasets")
	if err := os.MkdirAll(datasets, 0o755); err != nil {
		t.Fatal(err)
	}
	pages := map[string]string{
		"sales.md":   "---\nkind: dataset\nformat: csv\nlicense: mit\nstats:\n  ordered: true\n  rows: 750000\n---\n# Sales\n",
		"revenue.md": "---\nkind: dataset\nformat: csv\nlicense: mit\nstats:\n  ordered: true\n  rows: 700000\n---\n# Revenue\n",
		"traffic.md": "---\nkind: dataset\nformat: parquet\nlicense: apache-2.0\nstats:\n  ordered: false\n  rows: 3000\n---\n# Traffic\n",
	}
	for name, body := range pages {
		if err := os.WriteFile(filepath.Join(datasets, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return NewLocalBackend(tmp)
}

func decodeSimilar(t *testing.T, raw string) *similar.Result {
	t.Helper()
	var res similar.Result
	if err := json.Unmarshal([]byte(raw), &res); err != nil {
		t.Fatalf("decode: %v (raw %s)", err, raw)
	}
	return &res
}

func TestHandleSimilarByPath(t *testing.T) {
	b := setupSimilarBackend(t)
	out := mustCallTool(t, handleSimilar(b), "kiwi_similar", map[string]any{
		"path":    "datasets/sales.md",
		"profile": "dataset",
		"k":       float64(2),
	})
	res := decodeSimilar(t, out)
	if len(res.Neighbors) != 2 {
		t.Fatalf("got %d neighbours, want 2", len(res.Neighbors))
	}
	if res.Neighbors[0].Path != "datasets/revenue.md" {
		t.Errorf("nearest = %q, want datasets/revenue.md", res.Neighbors[0].Path)
	}
	if res.Neighbors[0].ComparableFields != 4 || res.Neighbors[0].TotalFields != 4 {
		t.Errorf("comparable/total = %d/%d, want 4/4",
			res.Neighbors[0].ComparableFields, res.Neighbors[0].TotalFields)
	}
}

func TestHandleSimilarInlineVector(t *testing.T) {
	b := setupSimilarBackend(t)
	out := mustCallTool(t, handleSimilar(b), "kiwi_similar", map[string]any{
		"profile": "dataset",
		"k":       float64(1),
		"vector": map[string]any{
			"format":        "parquet",
			"license":       "apache-2.0",
			"stats.ordered": false,
			"stats.rows":    float64(3500),
		},
	})
	res := decodeSimilar(t, out)
	if res.Neighbors[0].Path != "datasets/traffic.md" {
		t.Errorf("nearest = %q, want datasets/traffic.md", res.Neighbors[0].Path)
	}
}

func TestHandleSimilarWeightsReorder(t *testing.T) {
	b := setupSimilarBackend(t)
	vector := map[string]any{
		"format":        "csv",
		"license":       "mit",
		"stats.ordered": false,
		"stats.rows":    float64(500000),
	}
	rank := func(profile, path string) int {
		out := mustCallTool(t, handleSimilar(b), "kiwi_similar", map[string]any{
			"profile": profile, "k": float64(5), "vector": vector,
		})
		for i, n := range decodeSimilar(t, out).Neighbors {
			if n.Path == path {
				return i
			}
		}
		return -1
	}
	const unordered = "datasets/traffic.md"
	if rank("dataset", unordered) <= rank("dataset-weighted", unordered) {
		t.Error("weighting stats.ordered at 3.0 did not reorder the list")
	}
}

func TestHandleSimilarErrors(t *testing.T) {
	b := setupSimilarBackend(t)
	tests := []struct {
		name string
		args map[string]any
	}{
		{"no path or vector", map[string]any{"profile": "dataset"}},
		{"unknown profile", map[string]any{"path": "datasets/sales.md", "profile": "nope"}},
		{"ambiguous profile", map[string]any{"path": "datasets/sales.md"}},
		{"unindexed path", map[string]any{"path": "datasets/ghost.md", "profile": "dataset"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			res := mustCallToolError(t, handleSimilar(b), "kiwi_similar", tc.args)
			if res == "" {
				t.Fatal("want an error message")
			}
		})
	}
}

func TestSimilarWithoutProfilesIsReported(t *testing.T) {
	b, _ := setupTestBackend(t) // config with no [[similarity.profiles]]
	if _, err := b.Similar(context.Background(), "concepts/auth.md", "", 5, nil); err == nil {
		t.Fatal("want an error explaining that no profiles are configured")
	}
}
