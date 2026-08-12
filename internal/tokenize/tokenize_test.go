package tokenize

import (
	"strings"
	"testing"
)

func TestBPECounter(t *testing.T) {
	c, err := NewCounter("")
	if err != nil {
		t.Fatalf("NewCounter: %v", err)
	}
	if c.Name() != DefaultEncoding {
		t.Fatalf("name = %q, want %q", c.Name(), DefaultEncoding)
	}
	// cl100k_base encodes this to exactly 13 tokens.
	if got := c.Count("# Heading\n\nThe quick brown fox jumps over the lazy dog."); got != 13 {
		t.Errorf("count = %d, want 13", got)
	}
	if got := c.Count(""); got != 0 {
		t.Errorf("empty count = %d, want 0", got)
	}
}

// The whole reason not to use len/4: dense markdown tokenizes far above one
// token per four bytes, so the heuristic would let an over-budget pack through.
func TestBPECounterCatchesDenseMarkdown(t *testing.T) {
	c, err := NewCounter("")
	if err != nil {
		t.Fatal(err)
	}
	table := strings.Repeat("| a | 0.12 | `x[0]` | [[link]] |\n", 40)
	real := c.Count(table)
	naive := len(table) / 4
	if real <= naive {
		t.Fatalf("BPE count %d did not exceed the len/4 estimate %d; the fixture is not dense enough to be a regression test", real, naive)
	}
}

func TestNewCounterUnknownEncodingFallsBack(t *testing.T) {
	c, err := NewCounter("no-such-encoding")
	if err == nil {
		t.Fatal("expected an error for an unknown encoding")
	}
	// Still usable — Name() is how the caller finds out it degraded.
	if c == nil || c.Name() != "estimate" {
		t.Fatalf("fallback counter = %v", c)
	}
	if c.Count("hello world") == 0 {
		t.Error("fallback counter returned 0 for non-empty text")
	}
}

func TestNewCounterCachesEncoding(t *testing.T) {
	a, err := NewCounter(DefaultEncoding)
	if err != nil {
		t.Fatal(err)
	}
	b, err := NewCounter(DefaultEncoding)
	if err != nil {
		t.Fatal(err)
	}
	if a.Count("hello") != b.Count("hello") {
		t.Fatal("cached and fresh counters disagree")
	}
}

func TestEstimateCounter(t *testing.T) {
	e := EstimateCounter{}
	if got := e.Count("   "); got != 0 {
		t.Errorf("blank = %d, want 0", got)
	}
	if got := e.Count("hello"); got != 2 {
		t.Errorf("\"hello\" = %d, want 2 (5 ascii chars -> ceil(5/4))", got)
	}
	// CJK is charged per rune, which is roughly what real vocabularies do and
	// is where dividing bytes by four goes badly wrong.
	if got := e.Count("日本語"); got != 3 {
		t.Errorf("CJK = %d, want 3", got)
	}
	if got := e.Count("x"); got != 1 {
		t.Errorf("single char = %d, want 1", got)
	}
}

func TestEstimateCounterNeverReturnsZeroForContent(t *testing.T) {
	if got := (EstimateCounter{}).Count("."); got < 1 {
		t.Fatalf("got %d", got)
	}
}
