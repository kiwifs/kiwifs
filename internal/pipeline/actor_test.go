package pipeline

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestNormalizeActor(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"plain", "my-agent", "my-agent"},
		{"trims surrounding space", "  my-agent \t", "my-agent"},
		{"blank becomes empty", "   ", ""},
		{"empty stays empty", "", ""},
		{"strips control characters", "bad\x00\nactor\x7f", "badactor"},
		{"keeps inner spaces", "Ada Lovelace", "Ada Lovelace"},
		{"keeps multibyte runes", "café", "café"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := NormalizeActor(tc.in); got != tc.want {
				t.Fatalf("NormalizeActor(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestNormalizeActorClampsLength(t *testing.T) {
	got := NormalizeActor(strings.Repeat("A", 5000))
	if len(got) != MaxActorLen {
		t.Fatalf("length = %d, want %d", len(got), MaxActorLen)
	}
}

// Truncating mid-rune would hand git and the JSON event encoder invalid
// UTF-8, so the cut has to land on a rune boundary.
func TestNormalizeActorTruncatesOnRuneBoundary(t *testing.T) {
	// "é" is two bytes, so a 256-byte cut of this string lands mid-rune.
	got := NormalizeActor(strings.Repeat("é", 500))
	if !utf8.ValidString(got) {
		t.Fatalf("result is not valid UTF-8: %q", got)
	}
	if len(got) > MaxActorLen {
		t.Fatalf("length = %d, want <= %d", len(got), MaxActorLen)
	}
	if len(got) < MaxActorLen-utf8.UTFMax {
		t.Fatalf("length = %d, truncated more than one rune below the cap", len(got))
	}
}
