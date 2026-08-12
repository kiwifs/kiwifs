package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kiwifs/kiwifs/internal/brief"
	"github.com/kiwifs/kiwifs/internal/tokenize"
)

func postBrief(t *testing.T, s *Server, body string) (*httptest.ResponseRecorder, brief.Pack) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/kiwi/brief", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	var pack brief.Pack
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &pack); err != nil {
			t.Fatalf("decode: %v (%s)", err, rec.Body.String())
		}
	}
	return rec, pack
}

// briefCorpus seeds three pages of very different sizes so budgeting has
// something to actually decide.
func briefCorpus(t *testing.T, s *Server) {
	t.Helper()
	mustPutFile(t, s, "small.md", "# Small\n\nzebrabyte zebrabyte zebrabyte. A short note.\n")
	mustPutFile(t, s, "medium.md", "# Medium\n\nzebrabyte zebrabyte. "+strings.Repeat("filler words here. ", 40)+"\n")
	big := "# Big\n\nzebrabyte.\n\n" +
		"## Alpha\n\n" + strings.Repeat("alpha padding text. ", 300) + "\n\n" +
		"## Zebrabyte Details\n\nzebrabyte specifics live here.\n\n" +
		"## Omega\n\n" + strings.Repeat("omega padding text. ", 300) + "\n"
	mustPutFile(t, s, "big.md", big)
}

func TestBriefRespectsBudget(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	briefCorpus(t, s)

	rec, pack := postBrief(t, s, `{"query": "zebrabyte", "budget_tokens": 200}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	if pack.BudgetTokens != 200 {
		t.Fatalf("budget = %d", pack.BudgetTokens)
	}
	if pack.UsedTokens > pack.BudgetTokens {
		t.Fatalf("used %d tokens against a %d budget", pack.UsedTokens, pack.BudgetTokens)
	}
	if len(pack.Items) == 0 {
		t.Fatal("no items included")
	}
	// The reported total must match a real recount, not a running guess.
	counter, err := tokenize.NewCounter(pack.Tokenizer)
	if err != nil {
		t.Fatal(err)
	}
	sum := 0
	for _, item := range pack.Items {
		sum += counter.Count(item.Content)
	}
	if sum != pack.UsedTokens {
		t.Errorf("used_tokens = %d, recount = %d", pack.UsedTokens, sum)
	}
	if pack.Tokenizer != tokenize.DefaultEncoding {
		t.Errorf("tokenizer = %q, want %q", pack.Tokenizer, tokenize.DefaultEncoding)
	}
}

// Everything retrieval offered but the budget could not fit is named, with the
// token cost, so the caller can ask for it directly.
func TestBriefManifestListsDropped(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	briefCorpus(t, s)

	_, pack := postBrief(t, s, `{"query": "zebrabyte", "budget_tokens": 60}`)
	if len(pack.Dropped) == 0 {
		t.Fatalf("nothing reported as dropped even though the budget is tiny: %+v", pack)
	}
	included := map[string]bool{}
	for _, item := range pack.Items {
		included[item.Path] = true
	}
	for _, d := range pack.Dropped {
		if d.Reason == "" {
			t.Errorf("dropped %s carries no reason", d.Path)
		}
		if d.Tokens <= 0 && d.Reason == brief.ReasonBudgetExhausted {
			t.Errorf("dropped %s reports %d tokens; the cost is what makes the manifest actionable", d.Path, d.Tokens)
		}
	}
	// Candidates accounts for everything retrieval found.
	if pack.Candidates < len(pack.Items) {
		t.Errorf("candidates %d < items %d", pack.Candidates, len(pack.Items))
	}
}

// A zero budget is a costing question, not an error: empty pack, full manifest.
func TestBriefZeroBudgetReturnsFullManifest(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	briefCorpus(t, s)

	rec, pack := postBrief(t, s, `{"query": "zebrabyte", "budget_tokens": -1}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	if len(pack.Items) != 0 {
		t.Fatalf("zero budget included %d items", len(pack.Items))
	}
	if pack.UsedTokens != 0 {
		t.Errorf("used = %d, want 0", pack.UsedTokens)
	}
	if len(pack.Dropped) != pack.Candidates {
		t.Fatalf("dropped %d of %d candidates; a zero-budget manifest must list them all", len(pack.Dropped), pack.Candidates)
	}
	for _, d := range pack.Dropped {
		if d.Tokens <= 0 {
			t.Errorf("%s costs %d tokens; the point of a zero-budget call is learning the cost", d.Path, d.Tokens)
		}
	}
}

// A page too large to include whole contributes its best-matching sections
// instead of being dropped entirely.
func TestBriefFallsBackToSections(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	mustPutFile(t, s, "big.md", "# Big\n\nintro.\n\n"+
		"## Alpha\n\n"+strings.Repeat("alpha padding text. ", 400)+"\n\n"+
		"## Zebrabyte Details\n\nzebrabyte specifics live here.\n\n"+
		"## Omega\n\n"+strings.Repeat("omega padding text. ", 400)+"\n")

	_, pack := postBrief(t, s, `{"query": "zebrabyte", "budget_tokens": 120}`)
	if len(pack.Items) == 0 {
		t.Fatalf("expected a partial include, got %+v", pack)
	}
	var headings []string
	for _, item := range pack.Items {
		if !item.Partial {
			t.Errorf("item is not flagged partial: %+v", item)
		}
		if item.Heading == "" {
			t.Errorf("partial item should name its section: %+v", item)
		}
		headings = append(headings, item.Heading)
	}
	// The query-matching section beats the padding sections for the scarce
	// budget. Cheap non-matching sections may also ride along — the rule is
	// "fill the budget best-first", not "include only matches".
	matched := false
	for _, h := range headings {
		if strings.Contains(strings.ToLower(h), "zebrabyte") {
			matched = true
		}
		if strings.EqualFold(h, "Alpha") || strings.EqualFold(h, "Omega") {
			t.Errorf("padding section %q crowded out the budget: %v", h, headings)
		}
	}
	if !matched {
		t.Errorf("query-matching section missing from %v", headings)
	}
	if pack.UsedTokens > pack.BudgetTokens {
		t.Fatalf("used %d over budget %d", pack.UsedTokens, pack.BudgetTokens)
	}
	// The sections left behind are named too.
	var droppedHeadings []string
	for _, d := range pack.Dropped {
		if d.Heading != "" {
			droppedHeadings = append(droppedHeadings, d.Heading)
		}
	}
	if len(droppedHeadings) == 0 {
		t.Errorf("omitted sections not reported: %+v", pack.Dropped)
	}
}

func TestBriefWholePageWhenItFits(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	mustPutFile(t, s, "small.md", "# Small\n\nzebrabyte lives here.\n\n## Detail\n\nMore.\n")

	_, pack := postBrief(t, s, `{"query": "zebrabyte", "budget_tokens": 4000}`)
	if len(pack.Items) != 1 {
		t.Fatalf("got %d items", len(pack.Items))
	}
	if pack.Items[0].Partial || pack.Items[0].Heading != "" {
		t.Errorf("a page that fits should go in whole: %+v", pack.Items[0])
	}
	if !strings.Contains(pack.Items[0].Content, "More.") {
		t.Errorf("content is missing a section: %q", pack.Items[0].Content)
	}
	if len(pack.Dropped) != 0 {
		t.Errorf("nothing should be dropped: %+v", pack.Dropped)
	}
}

func TestBriefPathPrefix(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	mustPutFile(t, s, "keep/a.md", "# A\n\nzebrabyte\n")
	mustPutFile(t, s, "other/b.md", "# B\n\nzebrabyte\n")

	_, pack := postBrief(t, s, `{"query": "zebrabyte", "path_prefix": "keep/"}`)
	for _, item := range pack.Items {
		if !strings.HasPrefix(item.Path, "keep/") {
			t.Fatalf("path_prefix ignored: %s", item.Path)
		}
	}
	if len(pack.Items) != 1 {
		t.Fatalf("got %d items", len(pack.Items))
	}
}

func TestBriefRequiresQuery(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	rec, _ := postBrief(t, s, `{}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestBriefNoResults(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	mustPutFile(t, s, "a.md", "# A\n\nnothing relevant\n")

	rec, pack := postBrief(t, s, `{"query": "zebrabyte"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	if len(pack.Items) != 0 || pack.Candidates != 0 {
		t.Fatalf("expected an empty pack, got %+v", pack)
	}
}

func TestBriefMaxPages(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	for i := 0; i < 5; i++ {
		mustPutFile(t, s, fmt.Sprintf("p%d.md", i), "# P\n\nzebrabyte\n")
	}
	_, pack := postBrief(t, s, `{"query": "zebrabyte", "max_pages": 2}`)
	if pack.Candidates != 2 {
		t.Fatalf("candidates = %d, want 2", pack.Candidates)
	}
}

func TestBriefRejectsUnknownEncoding(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	mustPutFile(t, s, "a.md", "# A\n\nzebrabyte\n")

	rec, _ := postBrief(t, s, `{"query": "zebrabyte", "encoding": "no-such-encoding"}`)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d; an explicitly named bad encoding should not silently degrade", rec.Code)
	}
}
