package markdown

import (
	"encoding/json"
	"strings"
	"testing"
)

func mustExtract(t *testing.T, src string) []Claim {
	t.Helper()
	claims, err := ExtractClaims([]byte(src))
	if err != nil {
		t.Fatalf("ExtractClaims: %v", err)
	}
	return claims
}

func TestExtractClaimsBlockForm(t *testing.T) {
	src := `# Notes

:::claim{evidence=inferred confidence=0.6 source="sources/reports/575784"}
The dominant feature being 11.6% missing is why a non-linear level-2 stacker wins.
:::

Trailing prose.
`
	claims := mustExtract(t, src)
	if len(claims) != 1 {
		t.Fatalf("got %d claims, want 1: %+v", len(claims), claims)
	}
	c := claims[0]
	if c.Scope != "block" {
		t.Errorf("scope = %q, want block", c.Scope)
	}
	if c.Evidence != "inferred" {
		t.Errorf("evidence = %q", c.Evidence)
	}
	if c.Confidence == nil || *c.Confidence != 0.6 {
		t.Errorf("confidence = %v, want 0.6", c.Confidence)
	}
	if c.Source != "sources/reports/575784" {
		t.Errorf("source = %q", c.Source)
	}
	if !strings.Contains(c.Text, "11.6% missing") {
		t.Errorf("text = %q", c.Text)
	}
	if c.Line != 3 {
		t.Errorf("line = %d, want 3", c.Line)
	}
}

func TestExtractClaimsInlineForm(t *testing.T) {
	src := "Stacking helps, and :claim[hill-climbing is measurably worse]{evidence=stated confidence=0.9 source=\"projects/atlas\"} on this data.\n"
	claims := mustExtract(t, src)
	if len(claims) != 1 {
		t.Fatalf("got %d claims, want 1: %+v", len(claims), claims)
	}
	c := claims[0]
	if c.Scope != "inline" {
		t.Errorf("scope = %q, want inline", c.Scope)
	}
	if c.Text != "hill-climbing is measurably worse" {
		t.Errorf("text = %q", c.Text)
	}
	if c.Evidence != "stated" {
		t.Errorf("evidence = %q", c.Evidence)
	}
	if c.Confidence == nil || *c.Confidence != 0.9 {
		t.Errorf("confidence = %v", c.Confidence)
	}
}

// TestExtractClaimsIgnoresCodeFences is the reason this goes through a real
// block parser instead of a regex: documentation *about* claims must not
// register as claims.
func TestExtractClaimsIgnoresCodeFences(t *testing.T) {
	src := "Write a claim like this:\n\n```markdown\n:::claim{evidence=stated confidence=1.0}\nNot a real claim.\n:::\n\nAnd inline: :claim[also not real]{evidence=stated}\n```\n\n:::claim{evidence=stated}\nThis one is real.\n:::\n"
	claims := mustExtract(t, src)
	if len(claims) != 1 {
		t.Fatalf("got %d claims, want 1 — a fenced example was indexed: %+v", len(claims), claims)
	}
	if claims[0].Text != "This one is real." {
		t.Errorf("text = %q", claims[0].Text)
	}
}

func TestExtractClaimsIgnoresIndentedCode(t *testing.T) {
	src := "Example:\n\n    :::claim{evidence=stated}\n    indented, so it is code\n    :::\n\nDone.\n"
	if claims := mustExtract(t, src); len(claims) != 0 {
		t.Fatalf("got %d claims, want 0: %+v", len(claims), claims)
	}
}

// TestExtractClaimsIgnoresOtherDirectives: :::tabs and :::columns already
// exist in the UI and must keep parsing as directives without becoming claims.
func TestExtractClaimsIgnoresOtherDirectives(t *testing.T) {
	src := ":::columns{ratio=\"2:1\"}\n:::col\nLeft.\n:::\n:::\n\n:::claim{evidence=derived}\nReal.\n:::\n"
	claims := mustExtract(t, src)
	if len(claims) != 1 {
		t.Fatalf("got %d claims, want 1: %+v", len(claims), claims)
	}
	if claims[0].Evidence != "derived" {
		t.Errorf("evidence = %q", claims[0].Evidence)
	}
}

// TestExtractClaimsPlainProseIsNotADirective guards the inline parser against
// eating ordinary text. A colon followed by a word is extremely common.
func TestExtractClaimsPlainProseIsNotADirective(t *testing.T) {
	for _, src := range []string{
		"Note: this is prose.\n",
		"See http://example.com/x for details.\n",
		"Ratio 2:1 and time 10:30.\n",
		"A bare :claim without a label.\n",
		"Emoji shortcode :smile: stays put.\n",
	} {
		if claims := mustExtract(t, src); len(claims) != 0 {
			t.Errorf("%q produced %d claims, want 0: %+v", src, len(claims), claims)
		}
	}
}

func TestExtractClaimsDocumentOrderAndIndex(t *testing.T) {
	src := ":claim[first]{evidence=stated}\n\n:::claim{evidence=inferred}\nsecond\n:::\n\n:claim[third]{evidence=stated}\n"
	claims := mustExtract(t, src)
	if len(claims) != 3 {
		t.Fatalf("got %d claims, want 3: %+v", len(claims), claims)
	}
	wantText := []string{"first", "second", "third"}
	for i, c := range claims {
		if c.Index != i {
			t.Errorf("claim %d has Index %d", i, c.Index)
		}
		if c.Text != wantText[i] {
			t.Errorf("claim %d text = %q, want %q", i, c.Text, wantText[i])
		}
	}
}

// TestExtractClaimsNonNumericConfidence: the claim survives with a null
// confidence and the problem is reported. Dropping it would hide the claim
// from the very audit query the feature exists for; keeping "high" as a string
// would corrupt every `confidence < 0.7` comparison.
func TestExtractClaimsNonNumericConfidence(t *testing.T) {
	src := ":::claim{evidence=inferred confidence=high}\nGuessy.\n:::\n"
	claims, err := ExtractClaims([]byte(src))
	if err == nil {
		t.Fatal("expected a reported error for a non-numeric confidence")
	}
	if !strings.Contains(err.Error(), "not a number") {
		t.Errorf("err = %v", err)
	}
	if len(claims) != 1 {
		t.Fatalf("got %d claims, want the claim to survive: %+v", len(claims), claims)
	}
	if claims[0].Confidence != nil {
		t.Errorf("confidence = %v, want nil", claims[0].Confidence)
	}
	rec := claims[0].Record()
	if rec["confidence"] != nil {
		t.Errorf("record confidence = %#v, want nil", rec["confidence"])
	}
}

// TestClaimRecordTypes pins the two rules the DQL side depends on.
func TestClaimRecordTypes(t *testing.T) {
	src := ":::claim{evidence=inferred confidence=0.65 method=regression}\nBody.\n:::\n\n:::claim{evidence=stated}\nNo confidence, no source.\n:::\n"
	claims := mustExtract(t, src)
	if len(claims) != 2 {
		t.Fatalf("got %d claims, want 2", len(claims))
	}

	// Round-trip through JSON, which is exactly what the indexer stores.
	raw, err := json.Marshal(claims[0].Record())
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if f, ok := got["confidence"].(float64); !ok || f != 0.65 {
		t.Errorf("confidence = %#v, want the JSON number 0.65", got["confidence"])
	}
	// An unrecognised attribute stays queryable rather than being dropped.
	if got["method"] != "regression" {
		t.Errorf("method = %#v", got["method"])
	}

	bare := claims[1].Record()
	if bare["source"] != nil {
		t.Errorf("source = %#v, want nil so `source IS NULL` finds it", bare["source"])
	}
	if bare["confidence"] != nil {
		t.Errorf("confidence = %#v, want nil", bare["confidence"])
	}
}

func TestExtractClaimsEmptyDocument(t *testing.T) {
	if claims := mustExtract(t, "# Just a heading\n\nSome prose.\n"); len(claims) != 0 {
		t.Fatalf("got %d claims, want 0", len(claims))
	}
}

// TestExtractClaimsUnclosedContainer: an unterminated :::claim runs to the end
// of the document rather than losing the claim or failing the page.
func TestExtractClaimsUnclosedContainer(t *testing.T) {
	src := ":::claim{evidence=stated}\nStill a claim even though the fence never closes.\n"
	claims := mustExtract(t, src)
	if len(claims) != 1 {
		t.Fatalf("got %d claims, want 1: %+v", len(claims), claims)
	}
	if !strings.Contains(claims[0].Text, "never closes") {
		t.Errorf("text = %q", claims[0].Text)
	}
}

func TestExtractClaimsNestedMarkupInBody(t *testing.T) {
	src := ":::claim{evidence=inferred confidence=0.5}\nThe **dominant** feature is `target_mean` and it is [documented](x.md).\n:::\n"
	claims := mustExtract(t, src)
	if len(claims) != 1 {
		t.Fatalf("got %d claims, want 1", len(claims))
	}
	want := "The dominant feature is target_mean and it is documented."
	if claims[0].Text != want {
		t.Errorf("text = %q, want %q", claims[0].Text, want)
	}
}

// TestExtractClaimsIgnoresInlineCodeSpans: goldmark's code-span parser runs at
// a higher priority than the directive parser, so a claim quoted in backticks
// stays literal. Documentation about the syntax is the common case.
func TestExtractClaimsIgnoresInlineCodeSpans(t *testing.T) {
	src := "Write `:claim[the assertion]{evidence=stated confidence=0.9}` to mark a claim.\n"
	if claims := mustExtract(t, src); len(claims) != 0 {
		t.Fatalf("got %d claims, want 0: %+v", len(claims), claims)
	}
}

// TestExtractClaimsInListsAndHeadings: claims are not restricted to top-level
// paragraphs, so an inline claim inside a list item still indexes.
func TestExtractClaimsInListsAndHeadings(t *testing.T) {
	src := "## Findings\n\n- First, :claim[the metric is RMSE]{evidence=stated}\n- Second, plain text\n"
	claims := mustExtract(t, src)
	if len(claims) != 1 {
		t.Fatalf("got %d claims, want 1: %+v", len(claims), claims)
	}
	if claims[0].Text != "the metric is RMSE" {
		t.Errorf("text = %q", claims[0].Text)
	}
}
