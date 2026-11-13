package mcpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func setupRecallBackend(t *testing.T) *LocalBackend {
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
	write("notes/alpha.md", "# Alpha\n\nzebrabyte zebrabyte\n")
	write("notes/beta.md", "---\nconfidence: 0.9\n---\n# Beta\n\nzebrabyte\n")
	write("notes/hub.md", "# Hub\n\nSee [[alpha]] and [[beta]].\n")
	write("other/gamma.md", "# Gamma\n\nzebrabyte\n")

	if err := b.init(); err != nil {
		t.Fatalf("init: %v", err)
	}
	if _, err := b.stack.Searcher.Reindex(context.Background()); err != nil {
		t.Fatalf("reindex: %v", err)
	}
	return b
}

// The graph signal surfaces a page with none of the query terms, and the
// tool says which signals found each page and what a graph hit links to.
func TestRecallToolFusesGraph(t *testing.T) {
	b := setupRecallBackend(t)

	out := mustCallTool(t, handleRecall(b), "kiwi_recall", map[string]any{
		"query": "zebrabyte",
	})
	if !strings.Contains(out, "Signals used: fts, graph") {
		t.Fatalf("expected the contributing signals:\n%s", out)
	}
	if !strings.Contains(out, "notes/hub.md (graph #1)") {
		t.Fatalf("expected the linking page from the graph:\n%s", out)
	}
	if !strings.Contains(out, "links to: notes/alpha.md, notes/beta.md") {
		t.Fatalf("expected graph provenance:\n%s", out)
	}
	if !strings.Contains(out, "notes/alpha.md (keyword #1") {
		t.Fatalf("expected keyword attribution:\n%s", out)
	}
}

func TestRecallToolOptions(t *testing.T) {
	b := setupRecallBackend(t)

	out := mustCallTool(t, handleRecall(b), "kiwi_recall", map[string]any{
		"query":          "zebrabyte",
		"sources":        []any{"fts"},
		"path_prefix":    "notes/",
		"boost_verified": true,
	})
	if strings.Contains(out, "hub.md") || strings.Contains(out, "other/gamma.md") {
		t.Fatalf("sources or path_prefix ignored:\n%s", out)
	}
	if !strings.Contains(out, "confidence 0.90") {
		t.Fatalf("expected the applied confidence:\n%s", out)
	}

	limited := mustCallTool(t, handleRecall(b), "kiwi_recall", map[string]any{
		"query": "zebrabyte",
		"limit": float64(1),
	})
	if strings.Count(limited, ".md (") != 1 {
		t.Fatalf("limit was ignored:\n%s", limited)
	}
}

func TestRecallToolRejectsBadArguments(t *testing.T) {
	b := setupRecallBackend(t)
	for name, args := range map[string]map[string]any{
		"missing query":  {},
		"unknown source": {"query": "x", "sources": []any{"bm25"}},
		"graph alone":    {"query": "x", "sources": []any{"graph"}},
		"negative rrf_k": {"query": "x", "rrf_k": float64(-1)},
		"vector only":    {"query": "x", "sources": []any{"vector"}},
	} {
		t.Run(name, func(t *testing.T) {
			mustCallToolError(t, handleRecall(b), "kiwi_recall", args)
		})
	}
}

func TestRemoteRecallPostsRequest(t *testing.T) {
	var (
		gotPath string
		gotBody map[string]any
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"query":"q","engines":["fts","graph"],"results":[{"path":"hub.md","score":0.016,"sources":["graph"],"fts_rank":0,"vector_rank":0,"graph_rank":1,"links_to":["a.md"],"permalink":"https://x/hub"}]}`))
	}))
	defer srv.Close()

	rb := NewRemoteBackend(srv.URL, "", "default")
	resp, err := rb.Recall(context.Background(), RecallRequest{
		Query:         "q",
		Limit:         5,
		Sources:       []string{"fts", "graph"},
		BoostVerified: true,
	})
	if err != nil {
		t.Fatalf("Recall: %v", err)
	}
	if gotPath != "/api/kiwi/recall" {
		t.Errorf("path = %q", gotPath)
	}
	if gotBody["query"] != "q" || gotBody["limit"] != float64(5) || gotBody["boost_verified"] != true {
		t.Errorf("body = %v", gotBody)
	}
	if !reflect.DeepEqual(resp.Engines, []string{"fts", "graph"}) {
		t.Errorf("engines = %v", resp.Engines)
	}
	if len(resp.Results) != 1 || resp.Results[0].GraphRank != 1 || !reflect.DeepEqual(resp.Results[0].LinksTo, []string{"a.md"}) {
		t.Errorf("results = %+v", resp.Results)
	}
}
