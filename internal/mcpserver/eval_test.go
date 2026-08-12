package mcpserver

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kiwifs/kiwifs/internal/eval"
)

func setupEvalBackend(t *testing.T) (*LocalBackend, string) {
	t.Helper()
	b, root := setupTestBackend(t)
	writeEvalPage := func(rel, body string) {
		t.Helper()
		full := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	writeEvalPage("competitions/s5e4/index.md", "# S5E4\n\nzebrabyte zebrabyte zebrabyte held out\n")
	writeEvalPage("sources/writeups/s5e4.md", "# Writeup\n\nzebrabyte zebrabyte zebrabyte held out\n")
	writeEvalPage("competitions/s5e5/index.md", "# S5E5\n\nzebrabyte zebrabyte kept\n")
	writeEvalPage("techniques/stacking.md", "# Stacking\n\nzebrabyte kept\n")

	if err := b.init(); err != nil {
		t.Fatalf("init backend: %v", err)
	}
	if _, err := b.stack.Searcher.Reindex(context.Background()); err != nil {
		t.Fatalf("reindex: %v", err)
	}
	return b, root
}

func TestEvalToolInlineQueries(t *testing.T) {
	b, _ := setupEvalBackend(t)

	out := mustCallTool(t, handleEval(b), "kiwi_eval", map[string]any{
		"queries": []any{
			map[string]any{
				"question":       "zebrabyte",
				"expected_paths": []any{"competitions/s5e4/index.md"},
			},
		},
	})
	if !strings.Contains(out, "hit_rate=1.00") {
		t.Fatalf("expected a hit:\n%s", out)
	}
	if !strings.Contains(out, "ndcg=") {
		t.Errorf("nDCG should be reported:\n%s", out)
	}
}

func TestEvalToolExcludePrefix(t *testing.T) {
	b, _ := setupEvalBackend(t)

	res, err := b.Eval(context.Background(), EvalRequest{
		Queries: []EvalQuery{{
			Question:      "zebrabyte",
			ExpectedPaths: []string{"competitions/s5e5/index.md"},
		}},
		ExcludePrefix: []string{"competitions/s5e4/", "sources/writeups/"},
		TopK:          2,
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.TopK != 2 {
		t.Fatalf("top_k = %d, want 2", res.TopK)
	}
	if res.PerQuery[0].FTSRank != 1 {
		t.Fatalf("fts_rank = %d, want 1 once the higher-scoring pages are excluded", res.PerQuery[0].FTSRank)
	}
	// Both slots filled means the exclusion ran before the limit, not after.
	if res.FTS.PrecisionAtK != 0.5 {
		t.Errorf("precision@2 = %v, want 0.5", res.FTS.PrecisionAtK)
	}
}

// A scalar exclude_prefix from a tool call is accepted as a one-element list.
func TestEvalToolAcceptsScalarExcludePrefix(t *testing.T) {
	b, _ := setupEvalBackend(t)

	out := mustCallTool(t, handleEval(b), "kiwi_eval", map[string]any{
		"queries": []any{
			map[string]any{"question": "zebrabyte", "expected_paths": []any{"techniques/stacking.md"}},
		},
		"exclude_prefix": "competitions/",
	})
	if !strings.Contains(out, "Excluded before ranking: competitions/") {
		t.Fatalf("scalar exclude_prefix should be honoured:\n%s", out)
	}
}

func TestEvalToolGoldenSet(t *testing.T) {
	b, root := setupEvalBackend(t)

	dir := filepath.Join(root, filepath.FromSlash(eval.EvalDir))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "loo.qrels"), []byte("q1 0 competitions/s5e5/index.md 1\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "loo.topics"), []byte("q1\tzebrabyte\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	out := mustCallTool(t, handleEval(b), "kiwi_eval", map[string]any{"set": "loo"})
	if !strings.Contains(out, "1 queries scored") {
		t.Fatalf("golden set should supply the query:\n%s", out)
	}
}

func TestEvalToolRequiresSetOrQueries(t *testing.T) {
	b, _ := setupEvalBackend(t)
	msg := mustCallToolError(t, handleEval(b), "kiwi_eval", map[string]any{})
	if !strings.Contains(msg, "set or queries is required") {
		t.Fatalf("unexpected error: %s", msg)
	}
}

// A query whose relevant set is entirely hidden is reported, not silently
// dropped or scored as a failure.
func TestEvalToolReportsSkipped(t *testing.T) {
	b, _ := setupEvalBackend(t)

	out := mustCallTool(t, handleEval(b), "kiwi_eval", map[string]any{
		"queries": []any{
			map[string]any{"question": "zebrabyte", "expected_paths": []any{"competitions/s5e4/index.md"}},
		},
		"exclude_prefix": []any{"competitions/s5e4/"},
	})
	if !strings.Contains(out, "SKIPPED") {
		t.Fatalf("expected a skip line:\n%s", out)
	}
}

func TestStringArrayArg(t *testing.T) {
	cases := []struct {
		name string
		args map[string]any
		want []string
	}{
		{"scalar", map[string]any{"k": "a"}, []string{"a"}},
		{"empty scalar", map[string]any{"k": ""}, nil},
		{"array", map[string]any{"k": []any{"a", "b"}}, []string{"a", "b"}},
		{"array with junk", map[string]any{"k": []any{"a", 3, ""}}, []string{"a"}},
		{"missing", map[string]any{}, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := stringArrayArg(tc.args, "k")
			if len(got) != len(tc.want) {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Fatalf("got %v, want %v", got, tc.want)
				}
			}
		})
	}
}
