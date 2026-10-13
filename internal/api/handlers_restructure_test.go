package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func postJSON(t *testing.T, s *Server, url, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, url, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}

func TestRefactorPlanThenApply(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	mustPutFile(t, s, "old/page.md", "# Page\n")
	mustPutFile(t, s, "index.md", "See [[old/page|the page]].\n")

	rec := postJSON(t, s, "/api/kiwi/refactor/plan", "moves:\n  - from: old/page.md\n    to: new/page.md\n")
	if rec.Code != http.StatusOK {
		t.Fatalf("plan: %d %s", rec.Code, rec.Body.String())
	}
	var plan struct {
		Digest string `json:"digest"`
		Edits  []struct {
			Path  string `json:"path"`
			Links []struct{ Old, New string }
		} `json:"edits"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &plan); err != nil {
		t.Fatal(err)
	}
	if plan.Digest == "" || len(plan.Edits) != 1 || plan.Edits[0].Links[0].New != "new/page" {
		t.Fatalf("plan = %s", rec.Body.String())
	}

	stale := postJSON(t, s, "/api/kiwi/refactor/apply",
		`{"manifest":{"moves":[{"from":"old/page.md","to":"new/page.md"}]},"digest":"not-the-reviewed-plan"}`)
	if stale.Code != http.StatusConflict {
		t.Fatalf("stale digest: want 409, got %d %s", stale.Code, stale.Body.String())
	}

	rec = postJSON(t, s, "/api/kiwi/refactor/apply",
		`{"manifest":{"moves":[{"from":"old/page.md","to":"new/page.md"}]},"digest":"`+plan.Digest+`"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("apply: %d %s", rec.Code, rec.Body.String())
	}

	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/file?path=index.md", nil)
	got := httptest.NewRecorder()
	s.echo.ServeHTTP(got, req)
	if body := got.Body.String(); body != "See [[new/page|the page]].\n" {
		t.Fatalf("index.md = %q", body)
	}
}

func TestRefactorApplyRejectsAPlanWithErrors(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	mustPutFile(t, s, "a.md", "a\n")
	mustPutFile(t, s, "b.md", "b\n")
	rec := postJSON(t, s, "/api/kiwi/refactor/apply", `{"manifest":{"moves":[{"from":"a.md","to":"b.md"}]}}`)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("want 422, got %d %s", rec.Code, rec.Body.String())
	}
}
