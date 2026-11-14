package api

import (
	"encoding/json"
	"net/http"
	"reflect"
	"sort"
	"testing"
)

func postRecall(t *testing.T, s *Server, body string) (int, recallResponse, string) {
	t.Helper()
	rec := postJSON(t, s, "/api/kiwi/recall", body)
	var resp recallResponse
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode: %v (%s)", err, rec.Body.String())
		}
	}
	return rec.Code, resp, rec.Body.String()
}

func recallByPath(resp recallResponse) map[string]recallResultEntry {
	out := make(map[string]recallResultEntry, len(resp.Results))
	for _, r := range resp.Results {
		out[r.Path] = r
	}
	return out
}

// A page that never mentions the query but links to the hits is recalled
// through the link graph, and the response says which signal found it.
func TestRecallFusesKeywordAndGraph(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	mustPutFile(t, s, "auth-migration.md", "# Auth migration\n\nzebrabyte tokens were rotated.\n")
	mustPutFile(t, s, "sessions.md", "# Sessions\n\nzebrabyte sessions expire.\n")
	mustPutFile(t, s, "postmortem.md", "# Postmortem\n\nSee [[auth-migration]] and [[sessions]].\n")
	mustPutFile(t, s, "unrelated.md", "# Unrelated\n\nNothing to see.\n")

	code, resp, body := postRecall(t, s, `{"query":"zebrabyte"}`)
	if code != http.StatusOK {
		t.Fatalf("status %d: %s", code, body)
	}
	// No vector index is configured: recall degrades, and engines says so.
	if !reflect.DeepEqual(resp.Engines, []string{"fts", "graph"}) {
		t.Errorf("engines = %v, want [fts graph]", resp.Engines)
	}
	if resp.RRFK != 60 || resp.Limit != 10 {
		t.Errorf("rrf_k = %v, limit = %d; want the defaults 60 and 10", resp.RRFK, resp.Limit)
	}
	got := recallByPath(resp)
	pm, ok := got["postmortem.md"]
	if !ok {
		t.Fatalf("postmortem.md was not recalled: %s", body)
	}
	if pm.GraphRank != 1 || pm.FTSRank != 0 {
		t.Errorf("postmortem ranks = fts %d, graph %d", pm.FTSRank, pm.GraphRank)
	}
	if !reflect.DeepEqual(pm.Sources, []string{"graph"}) {
		t.Errorf("postmortem sources = %v", pm.Sources)
	}
	if len(pm.LinksTo) != 2 {
		t.Errorf("postmortem links_to = %v, want both hits", pm.LinksTo)
	}
	if hit := got["auth-migration.md"]; hit.FTSRank == 0 || hit.Snippet == "" {
		t.Errorf("keyword hit = %+v", hit)
	}
	if _, ok := got["unrelated.md"]; ok {
		t.Error("unrelated.md has no signal and must not be recalled")
	}
}

func TestRecallSourcesAndLimit(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	mustPutFile(t, s, "a.md", "# A\n\nzebrabyte zebrabyte\n")
	mustPutFile(t, s, "b.md", "# B\n\nzebrabyte\n")
	mustPutFile(t, s, "hub.md", "# Hub\n\n[[a]]\n")

	code, resp, body := postRecall(t, s, `{"query":"zebrabyte","sources":["fts"]}`)
	if code != http.StatusOK {
		t.Fatalf("status %d: %s", code, body)
	}
	if !reflect.DeepEqual(resp.Engines, []string{"fts"}) {
		t.Errorf("engines = %v", resp.Engines)
	}
	if _, ok := recallByPath(resp)["hub.md"]; ok {
		t.Error("graph hit returned although only fts was requested")
	}

	_, limited, _ := postRecall(t, s, `{"query":"zebrabyte","limit":1}`)
	if len(limited.Results) != 1 {
		t.Errorf("limit=1 returned %d results", len(limited.Results))
	}
}

func TestRecallBoostVerifiedUsesConfidence(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	mustPutFile(t, s, "loud.md", "# Loud\n\nzebrabyte zebrabyte zebrabyte zebrabyte\n")
	mustPutFile(t, s, "sure.md", "---\nconfidence: 0.95\n---\n# Sure\n\nzebrabyte is described here among many other words.\n")

	_, plain, _ := postRecall(t, s, `{"query":"zebrabyte","sources":["fts"]}`)
	if len(plain.Results) != 2 || plain.Results[0].Path != "loud.md" {
		t.Fatalf("baseline order = %+v; the test needs loud.md first", plain.Results)
	}

	code, boosted, body := postRecall(t, s, `{"query":"zebrabyte","sources":["fts"],"boost_verified":true}`)
	if code != http.StatusOK {
		t.Fatalf("status %d: %s", code, body)
	}
	if boosted.Results[0].Path != "sure.md" {
		t.Fatalf("boosted order = %+v; confidence should lift sure.md", boosted.Results)
	}
	if c := boosted.Results[0].Confidence; c == nil || *c != 0.95 {
		t.Errorf("confidence = %v, want 0.95", c)
	}
}

func TestRecallScope(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	mustPutFile(t, s, "alice.md", "---\nscope: user:alice\n---\n# Alice\n\nzebrabyte\n")
	mustPutFile(t, s, "bob.md", "---\nscope: user:bob\n---\n# Bob\n\nzebrabyte\n")
	mustPutFile(t, s, "alice-hub.md", "---\nscope: user:alice\n---\n# Hub\n\n[[alice]]\n")
	mustPutFile(t, s, "bob-hub.md", "---\nscope: user:bob\n---\n# Hub\n\n[[alice]]\n")

	code, resp, body := postRecall(t, s, `{"query":"zebrabyte","scope":"user:alice"}`)
	if code != http.StatusOK {
		t.Fatalf("status %d: %s", code, body)
	}
	var paths []string
	for _, r := range resp.Results {
		paths = append(paths, r.Path)
	}
	sort.Strings(paths)
	if !reflect.DeepEqual(paths, []string{"alice-hub.md", "alice.md"}) {
		t.Errorf("scoped recall = %v, want [alice.md alice-hub.md]", paths)
	}
}

func TestRecallRejectsBadRequests(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	for _, tc := range []struct {
		name string
		body string
		want int
	}{
		{"missing query", `{}`, http.StatusBadRequest},
		{"unknown source", `{"query":"x","sources":["bm25"]}`, http.StatusBadRequest},
		{"graph alone", `{"query":"x","sources":["graph"]}`, http.StatusBadRequest},
		{"negative rrf_k", `{"query":"x","rrf_k":-1}`, http.StatusBadRequest},
		{"malformed body", `{"query":`, http.StatusBadRequest},
		{"vector without an index", `{"query":"x","sources":["vector"]}`, http.StatusServiceUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if code, _, body := postRecall(t, s, tc.body); code != tc.want {
				t.Errorf("status %d, want %d: %s", code, tc.want, body)
			}
		})
	}
}

// The grep backend indexes no frontmatter, so a scoped recall cannot be
// honoured and must say so rather than leak other scopes.
func TestRecallScopeOnGrepBackend(t *testing.T) {
	s := buildTestServer(t)
	mustPutFile(t, s, "a.md", "---\nscope: user:bob\n---\nzebrabyte\n")

	if code, _, body := postRecall(t, s, `{"query":"zebrabyte","scope":"user:alice"}`); code != http.StatusNotImplemented {
		t.Fatalf("status %d, want 501: %s", code, body)
	}
	code, resp, body := postRecall(t, s, `{"query":"zebrabyte"}`)
	if code != http.StatusOK {
		t.Fatalf("status %d: %s", code, body)
	}
	if !reflect.DeepEqual(resp.Engines, []string{"fts"}) || len(resp.Results) != 1 {
		t.Errorf("grep recall = %v from %v", resp.Results, resp.Engines)
	}
}
