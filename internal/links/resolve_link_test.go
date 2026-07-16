package links

import "testing"

// This fixture mirrors ui/src/lib/wikiLinks.test.ts. If you change a case
// here, change it there too so the two resolvers stay in lockstep.
var resolveFixturePaths = []string{
	"02-arrays-and-strings/_index.md",
	"02-arrays-and-strings/01-linear-scan/summary-ranges.md",
	"02-arrays-and-strings/01-linear-scan/merge-intervals.md",
	"02-arrays-and-strings/02-two-pointers/_index.md",
	"02-arrays-and-strings/02-two-pointers/reverse-string.md",
	"02-arrays-and-strings/02-two-pointers/valid-palindrome.md",
	"17-intervals/merge-intervals.md",
	"00-foundations/index.md",
	"assets/diagram.png",
}

func TestResolveLink(t *testing.T) {
	t.Parallel()
	idx := BuildPathIndex(resolveFixturePaths)

	const from = "02-arrays-and-strings/_index.md"
	const twoPtr = "02-arrays-and-strings/02-two-pointers/_index.md"

	cases := []struct {
		name     string
		target   string
		fromPath string
		want     string
	}{
		{"chapter-relative partial path", "02-two-pointers/reverse-string", from,
			"02-arrays-and-strings/02-two-pointers/reverse-string.md"},
		{"chapter-relative partial path 2", "02-two-pointers/valid-palindrome", from,
			"02-arrays-and-strings/02-two-pointers/valid-palindrome.md"},
		{"explicit ../ relative", "../01-linear-scan/summary-ranges", twoPtr,
			"02-arrays-and-strings/01-linear-scan/summary-ranges.md"},
		{"explicit ./ sibling", "./reverse-string", twoPtr,
			"02-arrays-and-strings/02-two-pointers/reverse-string.md"},
		{"vault-absolute leading slash", "/02-arrays-and-strings/02-two-pointers/reverse-string", from,
			"02-arrays-and-strings/02-two-pointers/reverse-string.md"},
		{"full absolute no ext", "02-arrays-and-strings/02-two-pointers/reverse-string", from,
			"02-arrays-and-strings/02-two-pointers/reverse-string.md"},
		{"full absolute with ext", "02-arrays-and-strings/02-two-pointers/reverse-string.md", from,
			"02-arrays-and-strings/02-two-pointers/reverse-string.md"},
		{"unique bare stem from unrelated dir", "valid-palindrome", "00-foundations/index.md",
			"02-arrays-and-strings/02-two-pointers/valid-palindrome.md"},
		{"case and separator insensitive", "Reverse String", from,
			"02-arrays-and-strings/02-two-pointers/reverse-string.md"},
		{"no stem-prefix fuzzy", "reverse", from, ""},
		{"ambiguous stem prefers same dir A", "merge-intervals",
			"02-arrays-and-strings/01-linear-scan/summary-ranges.md",
			"02-arrays-and-strings/01-linear-scan/merge-intervals.md"},
		{"ambiguous stem prefers same dir B", "merge-intervals", "17-intervals/_index.md",
			"17-intervals/merge-intervals.md"},
		{"ambiguous stem shortest path with no dir hint", "merge-intervals", "00-foundations/index.md",
			"17-intervals/merge-intervals.md"},
		{"non-markdown embed exact", "assets/diagram.png", from, "assets/diagram.png"},
		{"unknown bare", "does-not-exist", from, ""},
		{"unknown partial", "02-two-pointers/nope", from, ""},
		{"anchor stripped for page resolution", "reverse-string#two-pointer-trick", from,
			"02-arrays-and-strings/02-two-pointers/reverse-string.md"},
		{"empty target", "", from, ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := idx.ResolveLink(tc.target, tc.fromPath)
			if got != tc.want {
				t.Fatalf("ResolveLink(%q, %q) = %q, want %q", tc.target, tc.fromPath, got, tc.want)
			}
		})
	}
}
