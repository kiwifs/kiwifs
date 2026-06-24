package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kiwifs/kiwifs/internal/search"
)

func TestRecallFusesFTSResults(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	mustPutFile(t, s, "episodes/auth-migration.md", "---\ntitle: Auth Migration Plan\nconfidence: 0.9\n---\n# Auth Migration\nWe decided to migrate auth to OAuth.\n")
	mustPutFile(t, s, "pages/other.md", "---\ntitle: Other\n---\n# Other\nUnrelated content.\n")

	body := bytes.NewBufferString(`{"query":"auth migration","limit":5,"sources":["fts"],"boost_verified":true}`)
	req := httptest.NewRequest(http.MethodPost, "/api/kiwi/recall", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST /recall: %d %s", rec.Code, rec.Body.String())
	}

	var resp recallResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(resp.Results) == 0 {
		t.Fatalf("expected recall results, got: %s", rec.Body.String())
	}
	if resp.Results[0].Path != "episodes/auth-migration.md" {
		t.Fatalf("top result = %+v, want auth-migration", resp.Results[0])
	}
	if resp.Results[0].Snippet == "" {
		t.Fatalf("expected snippet on top result")
	}
	if len(resp.Results[0].Sources) != 1 || resp.Results[0].Sources[0] != search.SourceFTS {
		t.Fatalf("sources = %v", resp.Results[0].Sources)
	}
	if resp.Results[0].FTSRank != 1 {
		t.Fatalf("fts_rank = %d", resp.Results[0].FTSRank)
	}
}

func TestRecallRequiresQuery(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	req := httptest.NewRequest(http.MethodPost, "/api/kiwi/recall", bytes.NewBufferString(`{"limit":5}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestRecallVectorSourceSkippedWhenDisabled(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	mustPutFile(t, s, "note.md", "# Note\nsemantic keyword alpha\n")

	body := bytes.NewBufferString(`{"query":"semantic keyword","sources":["fts","vector"]}`)
	req := httptest.NewRequest(http.MethodPost, "/api/kiwi/recall", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST /recall: %d %s", rec.Code, rec.Body.String())
	}
	var resp recallResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(resp.Results) == 0 {
		t.Fatal("expected fts fallback results")
	}
	for _, source := range resp.Results[0].Sources {
		if source == search.SourceVector {
			t.Fatal("vector source should be absent when vectors disabled")
		}
	}
}
