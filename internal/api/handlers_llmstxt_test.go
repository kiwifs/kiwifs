package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func getText(t *testing.T, s *Server, path string) (*httptest.ResponseRecorder, string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec, rec.Body.String()
}

func llmsCorpus(t *testing.T, s *Server) {
	t.Helper()
	mustPutFile(t, s, "index.md", "# Home\n\nThe front page of the workspace.\n")
	mustPutFile(t, s, "guides/install.md", "---\ntitle: Installing\ndescription: How to install the thing.\n---\n# Install\n\nRun the installer.\n")
	mustPutFile(t, s, "guides/usage.md", "# Usage\n\nCall the command with a flag.\n")
}

func TestLLMsTxt(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	llmsCorpus(t, s)

	rec, body := getText(t, s, "/llms.txt")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, body)
	}
	// llmstxt.org shape: H1 title, blockquote summary, then link sections.
	if !strings.HasPrefix(body, "# ") {
		t.Errorf("missing H1 title:\n%s", body)
	}
	if !strings.Contains(body, "\n> ") {
		t.Errorf("missing blockquote summary:\n%s", body)
	}
	if !strings.Contains(body, "## guides") {
		t.Errorf("pages should be grouped by top-level folder:\n%s", body)
	}
	if !strings.Contains(body, "## Root") {
		t.Errorf("top-level pages need a group too:\n%s", body)
	}
	// Frontmatter title and description win over the filename.
	if !strings.Contains(body, "[Installing](") {
		t.Errorf("frontmatter title not used:\n%s", body)
	}
	if !strings.Contains(body, "How to install the thing.") {
		t.Errorf("frontmatter description not used:\n%s", body)
	}
	// A page without a description falls back to its first paragraph.
	if !strings.Contains(body, "Call the command with a flag.") {
		t.Errorf("first paragraph not used as a fallback summary:\n%s", body)
	}
}

func TestLLMsFullTxt(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	llmsCorpus(t, s)

	rec, body := getText(t, s, "/llms-full.txt")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	for _, want := range []string{"Run the installer.", "Call the command with a flag.", "The front page of the workspace."} {
		if !strings.Contains(body, want) {
			t.Errorf("missing page body %q", want)
		}
	}
	// Each block names its source so a reader can cite or re-fetch it.
	if !strings.Contains(body, "<!-- source: guides/install.md -->") {
		t.Errorf("missing source marker:\n%s", body)
	}
	// Frontmatter is stripped rather than shipped as content.
	if strings.Contains(body, "description: How to install") {
		t.Errorf("frontmatter leaked into the body:\n%s", body)
	}
}

func TestLLMsTxtEmptyWorkspace(t *testing.T) {
	s, _ := buildSQLiteTestServer(t)
	rec, body := getText(t, s, "/llms.txt")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	if !strings.HasPrefix(body, "# ") {
		t.Errorf("an empty workspace should still emit a valid header:\n%s", body)
	}
}

func TestFirstParagraph(t *testing.T) {
	cases := map[string]string{
		"# Title\n\nThe body.\n":                  "The body.",
		"# Title\n\n```go\ncode\n```\n\nAfter.\n": "After.",
		"# Title\n":               "",
		"Multi\nline\nparagraph.": "Multi line paragraph.",
	}
	for in, want := range cases {
		if got := firstParagraph(in); got != want {
			t.Errorf("firstParagraph(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestTruncateRunes(t *testing.T) {
	if got := truncateRunes("abcdef", 3); got != "abc…" {
		t.Errorf("got %q", got)
	}
	if got := truncateRunes("abc", 10); got != "abc" {
		t.Errorf("got %q", got)
	}
	// Must not split a multi-byte rune.
	if got := truncateRunes("日本語です", 2); got != "日本…" {
		t.Errorf("got %q", got)
	}
}

func TestTopFolder(t *testing.T) {
	for in, want := range map[string]string{
		"a/b/c.md": "a",
		"c.md":     "Root",
		"/c.md":    "Root",
	} {
		if got := topFolder(in); got != want {
			t.Errorf("topFolder(%q) = %q, want %q", in, got, want)
		}
	}
}
