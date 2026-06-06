package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/kiwifs/kiwifs/internal/search"
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

func TestSearchRecencyWeightRanksNewest(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)

	mustPutFile(t, s, "old.md", "# Old\n\nkiwi memory alpha shared content.\n")
	mustPutFile(t, s, "new.md", "# New\n\nkiwi memory alpha shared content.\n")

	sqliteSearcher, ok := s.pipe.Searcher.(*search.SQLite)
	if !ok {
		t.Fatalf("test server searcher is %T, want *search.SQLite", s.pipe.Searcher)
	}
	oldTime := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339)
	newTime := time.Date(2026, 1, 3, 0, 0, 0, 0, time.UTC).Format(time.RFC3339)
	if _, err := sqliteSearcher.WriteDB().ExecContext(context.Background(), `UPDATE file_meta SET updated_at = ? WHERE path = ?`, oldTime, "old.md"); err != nil {
		t.Fatalf("set old updated_at: %v", err)
	}
	if _, err := sqliteSearcher.WriteDB().ExecContext(context.Background(), `UPDATE file_meta SET updated_at = ? WHERE path = ?`, newTime, "new.md"); err != nil {
		t.Fatalf("set new updated_at: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/search?q=kiwi+memory+alpha&recency_weight=1", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /search: %d %s", rec.Code, rec.Body.String())
	}

	var resp searchResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(resp.Results) != 2 {
		t.Fatalf("want 2 results, got %+v", resp.Results)
	}
	if resp.Results[0].Path != "new.md" {
		t.Fatalf("newest result should rank first, got %+v", resp.Results)
	}
}

func TestSearchRejectsInvalidRecencyWeight(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/search?q=kiwi&recency_weight=1.5", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("GET /search status = %d, want %d; body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}
