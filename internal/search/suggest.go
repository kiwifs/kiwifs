package search

import (
	"path/filepath"
	"strings"
	"unicode"
)

const (
	DefaultSuggestMaxDistance = 3
	DefaultSuggestLimit       = 3
	MaxSuggestMaxDistance     = 10
)

// TitleSuggestion is a fuzzy-match correction for a failed search query.
type TitleSuggestion struct {
	Query    string `json:"query"`
	Path     string `json:"path"`
	Title    string `json:"title"`
	Distance int    `json:"distance"`
}

// PageTitle is a indexed page title used for fuzzy matching.
type PageTitle struct {
	Path  string
	Title string
}

// LevenshteinDistance returns the edit distance between two strings (case-insensitive).
func LevenshteinDistance(a, b string) int {
	a = strings.ToLower(strings.TrimSpace(a))
	b = strings.ToLower(strings.TrimSpace(b))
	if a == b {
		return 0
	}
	la, lb := len(a), len(b)
	if la == 0 {
		return lb
	}
	if lb == 0 {
		return la
	}
	if la > lb {
		a, b = b, a
		la, lb = lb, la
	}

	prev := make([]int, la+1)
	curr := make([]int, la+1)
	for i := 0; i <= la; i++ {
		prev[i] = i
	}
	for j := 1; j <= lb; j++ {
		curr[0] = j
		bj := b[j-1]
		for i := 1; i <= la; i++ {
			cost := 1
			if a[i-1] == bj {
				cost = 0
			}
			del := prev[i] + 1
			ins := curr[i-1] + 1
			sub := prev[i-1] + cost
			curr[i] = min3(del, ins, sub)
		}
		prev, curr = curr, prev
	}
	return prev[la]
}

func min3(a, b, c int) int {
	if a <= b && a <= c {
		return a
	}
	if b <= c {
		return b
	}
	return c
}

// TitleFromPath derives a human-readable title from a markdown path.
func TitleFromPath(path string) string {
	base := filepath.Base(path)
	base = strings.TrimSuffix(base, ".markdown")
	base = strings.TrimSuffix(base, ".md")
	if base == "" {
		return path
	}
	base = strings.NewReplacer("-", " ", "_", " ").Replace(base)
	return strings.TrimSpace(strings.Join(strings.Fields(base), " "))
}

// SuggestTitles finds up to limit titles within maxDistance edits of query.
func SuggestTitles(query string, pages []PageTitle, maxDistance, limit int) []TitleSuggestion {
	query = strings.TrimSpace(query)
	if query == "" || len(pages) == 0 || limit <= 0 || maxDistance < 0 {
		return nil
	}
	if maxDistance > MaxSuggestMaxDistance {
		maxDistance = MaxSuggestMaxDistance
	}

	type candidate struct {
		suggestion TitleSuggestion
	}
	var matches []candidate

	for _, page := range pages {
		title := strings.TrimSpace(page.Title)
		if title == "" {
			title = TitleFromPath(page.Path)
		}
		if title == "" {
			continue
		}
		// Skip exact matches (search should have found these).
		if strings.EqualFold(title, query) {
			continue
		}
		if abs(len([]rune(title))-len([]rune(query))) > maxDistance {
			continue
		}
		d := LevenshteinDistance(query, title)
		if d == 0 || d > maxDistance {
			continue
		}
		matches = append(matches, candidate{TitleSuggestion{
			Query:    title,
			Path:     page.Path,
			Title:    title,
			Distance: d,
		}})
	}

	// Sort by distance asc, then title asc for stable output.
	for i := 0; i < len(matches); i++ {
		for j := i + 1; j < len(matches); j++ {
			a, b := matches[i].suggestion, matches[j].suggestion
			if b.Distance < a.Distance || (b.Distance == a.Distance && strings.ToLower(b.Title) < strings.ToLower(a.Title)) {
				matches[i], matches[j] = matches[j], matches[i]
			}
		}
	}

	seen := make(map[string]struct{})
	var out []TitleSuggestion
	for _, m := range matches {
		key := strings.ToLower(m.suggestion.Title)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, m.suggestion)
		if len(out) >= limit {
			break
		}
	}
	return out
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// NormalizeSuggestQuery strips punctuation for matching while keeping words.
func NormalizeSuggestQuery(q string) string {
	q = strings.TrimSpace(q)
	if q == "" {
		return q
	}
	var b strings.Builder
	lastSpace := false
	for _, r := range q {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || unicode.IsSpace(r) {
			if unicode.IsSpace(r) {
				if !lastSpace {
					b.WriteRune(' ')
					lastSpace = true
				}
			} else {
				b.WriteRune(r)
				lastSpace = false
			}
		}
	}
	return strings.TrimSpace(b.String())
}
