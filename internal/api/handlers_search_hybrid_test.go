package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func getHybrid(t *testing.T, s *Server, query string) (*httptest.ResponseRecorder, hybridSearchResponse) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/search?mode=hybrid&"+query, nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	var resp hybridSearchResponse
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode: %v (%s)", err, rec.Body.String())
		}
	}
	return rec, resp
}

// With no vector index configured, mode=hybrid degrades to the lexical
// ranking and says so — it must not 503 the way /search/semantic does.
func TestHybridSearchFallsBackWithoutVectors(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	mustPutFile(t, s, "a.md", "# A\n\nzebrabyte zebrabyte\n")
	mustPutFile(t, s, "b.md", "# B\n\nzebrabyte\n")

	rec, resp := getHybrid(t, s, "q=zebrabyte")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	if resp.Mode != "hybrid" {
		t.Errorf("mode = %q", resp.Mode)
	}
	if len(resp.Engines) != 1 || resp.Engines[0] != "fts" {
		t.Errorf("engines = %v; the caller has to be able to tell", resp.Engines)
	}
	if len(resp.Results) != 2 {
		t.Fatalf("got %d results, want 2: %+v", len(resp.Results), resp.Results)
	}
	if resp.Results[0].Path != "a.md" {
		t.Errorf("first result = %q, want a.md", resp.Results[0].Path)
	}
	// Ranks show which engine contributed. Semantic contributed nothing.
	if resp.Results[0].FTSRank != 1 || resp.Results[0].SemanticRank != 0 {
		t.Errorf("ranks = %d / %d", resp.Results[0].FTSRank, resp.Results[0].SemanticRank)
	}
	if resp.RRFK != 60 {
		t.Errorf("rrf_k = %v, want the default 60", resp.RRFK)
	}
}

func TestHybridSearchRespectsLimitAndOffset(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	mustPutFile(t, s, "a.md", "# A\n\nzebrabyte zebrabyte zebrabyte\n")
	mustPutFile(t, s, "b.md", "# B\n\nzebrabyte zebrabyte\n")
	mustPutFile(t, s, "c.md", "# C\n\nzebrabyte\n")

	_, first := getHybrid(t, s, "q=zebrabyte&limit=1")
	if len(first.Results) != 1 {
		t.Fatalf("limit=1 returned %d results", len(first.Results))
	}
	_, second := getHybrid(t, s, "q=zebrabyte&limit=1&offset=1")
	if len(second.Results) != 1 {
		t.Fatalf("offset=1 returned %d results", len(second.Results))
	}
	if first.Results[0].Path == second.Results[0].Path {
		t.Fatalf("offset returned the same page %q", first.Results[0].Path)
	}
}

func TestHybridSearchPathPrefix(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	mustPutFile(t, s, "keep/a.md", "# A\n\nzebrabyte\n")
	mustPutFile(t, s, "other/b.md", "# B\n\nzebrabyte\n")

	_, resp := getHybrid(t, s, "q=zebrabyte&pathPrefix=keep/")
	if len(resp.Results) != 1 || resp.Results[0].Path != "keep/a.md" {
		t.Fatalf("got %+v", resp.Results)
	}
}

func TestSearchRejectsUnknownMode(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/search?q=x&mode=telepathy", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestSearchModeFTSIsUnchanged(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	mustPutFile(t, s, "a.md", "# A\n\nzebrabyte\n")

	for _, mode := range []string{"", "fts", "lexical"} {
		req := httptest.NewRequest(http.MethodGet, "/api/kiwi/search?q=zebrabyte&mode="+mode, nil)
		rec := httptest.NewRecorder()
		s.echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("mode=%q: status %d", mode, rec.Code)
		}
		var resp searchResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("mode=%q: decode: %v", mode, err)
		}
		if len(resp.Results) != 1 {
			t.Fatalf("mode=%q: got %d results", mode, len(resp.Results))
		}
	}
}

func TestHybridSearchRejectsBadRRFK(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	mustPutFile(t, s, "a.md", "# A\n\nzebrabyte\n")

	for _, k := range []string{"0", "-1", "abc"} {
		rec, _ := getHybrid(t, s, "q=zebrabyte&rrf_k="+k)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("rrf_k=%s: status %d, want 400", k, rec.Code)
		}
	}
}

func TestHybridSearchCustomRRFK(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	mustPutFile(t, s, "a.md", "# A\n\nzebrabyte\n")

	_, resp := getHybrid(t, s, "q=zebrabyte&rrf_k=1")
	if resp.RRFK != 1 {
		t.Fatalf("rrf_k = %v, want 1", resp.RRFK)
	}
	// k changes the scores even when it cannot change a single-engine order.
	if len(resp.Results) != 1 || resp.Results[0].Score != 0.5 {
		t.Fatalf("score = %+v, want 1/(1+1)", resp.Results)
	}
}
