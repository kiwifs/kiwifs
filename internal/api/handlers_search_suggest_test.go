package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSearchSuggestionsOnZeroResults(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)

	mustPutFile(t, s, "concepts/authentication.md", "---\ntitle: Authentication\n---\n# Authentication\nOAuth and JWT.\n")
	mustPutFile(t, s, "concepts/database.md", "---\ntitle: Database\n---\n# Database\nSchema notes.\n")

	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/search?q=Authentcation", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /search: %d %s", rec.Code, rec.Body.String())
	}

	var resp searchResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(resp.Results) != 0 {
		t.Fatalf("expected zero results, got %d", len(resp.Results))
	}
	if len(resp.Suggestions) == 0 {
		t.Fatalf("expected suggestions, got none: %s", rec.Body.String())
	}
	if resp.Suggestions[0].Path != "concepts/authentication.md" {
		t.Fatalf("unexpected suggestion: %+v", resp.Suggestions[0])
	}
	if resp.Suggestions[0].Distance > 3 {
		t.Fatalf("distance too high: %+v", resp.Suggestions[0])
	}
}

func TestSearchNoSuggestionsWhenResultsFound(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)

	mustPutFile(t, s, "guide.md", "# Guide\nSearchable kiwi content here.\n")

	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/search?q=searchable", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /search: %d %s", rec.Code, rec.Body.String())
	}

	var resp searchResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(resp.Results) == 0 {
		t.Fatal("expected results for searchable query")
	}
	if len(resp.Suggestions) != 0 {
		t.Fatalf("expected no suggestions when results exist, got %+v", resp.Suggestions)
	}
}
