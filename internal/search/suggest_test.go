package search

import "testing"

func TestLevenshteinDistance(t *testing.T) {
	tests := []struct {
		a, b string
		want int
	}{
		{"authentication", "authentcation", 1},
		{"database", "datbase", 1},
		{"kiwi", "kivi", 1},
		{"hello", "hello", 0},
		{"", "abc", 3},
		{"abc", "", 3},
		{"OAuth", "oauth", 0},
	}
	for _, tt := range tests {
		if got := LevenshteinDistance(tt.a, tt.b); got != tt.want {
			t.Errorf("LevenshteinDistance(%q, %q) = %d, want %d", tt.a, tt.b, got, tt.want)
		}
	}
}

func TestSuggestTitles(t *testing.T) {
	pages := []PageTitle{
		{Path: "concepts/authentication.md", Title: "Authentication"},
		{Path: "concepts/database.md", Title: "Database"},
		{Path: "guides/getting-started.md", Title: "Getting Started"},
	}

	got := SuggestTitles("Authentcation", pages, 3, 3)
	if len(got) != 1 {
		t.Fatalf("expected 1 suggestion, got %d: %+v", len(got), got)
	}
	if got[0].Path != "concepts/authentication.md" || got[0].Distance != 1 {
		t.Fatalf("unexpected suggestion: %+v", got[0])
	}

	dupPages := []PageTitle{
		{Path: "concepts/authentication.md", Title: "Authentication"},
		{Path: "pages/auth.md", Title: "Authentication"},
		{Path: "concepts/database.md", Title: "Database"},
	}
	got = SuggestTitles("Authentcation", dupPages, 3, 3)
	if len(got) != 1 {
		t.Fatalf("expected 1 unique title, got %d: %+v", len(got), got)
	}

	got = SuggestTitles("Datbase", pages, 2, 3)
	if len(got) != 1 || got[0].Title != "Database" {
		t.Fatalf("expected Database suggestion, got %+v", got)
	}

	got = SuggestTitles("Authentication", pages, 3, 3)
	if len(got) != 0 {
		t.Fatalf("exact match should not suggest, got %+v", got)
	}

	got = SuggestTitles("zzzzzz", pages, 3, 3)
	if len(got) != 0 {
		t.Fatalf("expected no suggestions for unrelated query, got %+v", got)
	}
}

func TestTitleFromPath(t *testing.T) {
	if got := TitleFromPath("concepts/oauth-flow.md"); got != "oauth flow" {
		t.Fatalf("TitleFromPath = %q", got)
	}
}
