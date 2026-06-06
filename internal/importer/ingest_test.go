package importer

import (
	"strings"
	"testing"
)

func TestSplitByHeadings_Basic(t *testing.T) {
	input := `# Introduction
Some intro text here.

# Methods
Method description.

## Sub Method
Sub method details.

# Results
Final results.
`
	sections := SplitByHeadings([]byte(input))
	if len(sections) != 4 {
		t.Fatalf("expected 4 sections, got %d", len(sections))
	}
	if sections[0].Heading != "Introduction" {
		t.Errorf("expected heading 'Introduction', got %q", sections[0].Heading)
	}
	if sections[0].Level != 1 {
		t.Errorf("expected level 1, got %d", sections[0].Level)
	}
	if !strings.Contains(sections[0].Content, "intro text") {
		t.Errorf("expected intro text in content, got %q", sections[0].Content)
	}
	if sections[2].Heading != "Sub Method" {
		t.Errorf("expected heading 'Sub Method', got %q", sections[2].Heading)
	}
	if sections[2].Level != 2 {
		t.Errorf("expected level 2, got %d", sections[2].Level)
	}
}

func TestSplitByHeadings_Empty(t *testing.T) {
	sections := SplitByHeadings([]byte(""))
	if len(sections) != 0 {
		t.Fatalf("expected 0 sections, got %d", len(sections))
	}
}

func TestSplitByHeadings_NoHeadings(t *testing.T) {
	sections := SplitByHeadings([]byte("Just some text\nwith no headings."))
	if len(sections) != 0 {
		t.Fatalf("expected 0 sections from text without headings, got %d", len(sections))
	}
}

func TestSlugify(t *testing.T) {
	tests := []struct {
		input, want string
	}{
		{"Hello World", "hello-world"},
		{"Section 1.2", "section-1-2"},
		{"Already-Slugified", "already-slugified"},
		{"  Leading Spaces  ", "leading-spaces"},
		{"CamelCase", "camelcase"},
		{"with/slash", "with-slash"},
		{"multiple   spaces", "multiple-spaces"},
	}
	for _, tt := range tests {
		got := slugify(tt.input)
		if got != tt.want {
			t.Errorf("slugify(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestExtractKeywords_Basic(t *testing.T) {
	text := "The authentication system uses OAuth tokens. Authentication tokens are validated by the middleware. The middleware checks token expiry and signature."
	corpusDF := BuildCorpusDF([]string{text})
	keywords := ExtractKeywords(text, corpusDF, 1, 5)

	if len(keywords) == 0 {
		t.Fatal("expected at least one keyword")
	}
	found := false
	for _, kw := range keywords {
		if kw == "authentication" || kw == "tokens" || kw == "middleware" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected authentication, tokens, or middleware in top keywords, got %v", keywords)
	}
}

func TestExtractKeywords_MaxLimit(t *testing.T) {
	text := "word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12"
	corpusDF := BuildCorpusDF([]string{text})
	keywords := ExtractKeywords(text, corpusDF, 1, 3)
	if len(keywords) > 3 {
		t.Errorf("expected at most 3 keywords, got %d", len(keywords))
	}
}

func TestExtractKeywords_EmptyText(t *testing.T) {
	keywords := ExtractKeywords("", map[string]int{}, 1, 5)
	if keywords != nil {
		t.Errorf("expected nil for empty text, got %v", keywords)
	}
}

func TestBuildCorpusDF(t *testing.T) {
	sections := []string{
		"The cat sat on the mat",
		"The dog sat on the log",
		"A bird flew over the mat",
	}
	df := BuildCorpusDF(sections)
	if df["the"] != 3 {
		t.Errorf("expected 'the' in all 3 docs, got %d", df["the"])
	}
	if df["cat"] != 1 {
		t.Errorf("expected 'cat' in 1 doc, got %d", df["cat"])
	}
	if df["sat"] != 2 {
		t.Errorf("expected 'sat' in 2 docs, got %d", df["sat"])
	}
	if df["mat"] != 2 {
		t.Errorf("expected 'mat' in 2 docs, got %d", df["mat"])
	}
}

func TestConvertCrossRefs(t *testing.T) {
	sectionMap := map[string]string{
		"1":   "imports/doc/introduction",
		"2":   "imports/doc/methods",
		"2.1": "imports/doc/sub-method",
		"A":   "imports/doc/appendix-a",
	}
	tests := []struct {
		input, want string
	}{
		{
			"See Section 1 for details.",
			"[[imports/doc/introduction|See Section 1]] for details.",
		},
		{
			"Described in section 2.1 above.",
			"[[imports/doc/sub-method|Described in section 2.1]] above.",
		},
		{
			"See Appendix A for data.",
			"See [[imports/doc/appendix-a|Appendix A]] for data.",
		},
		{
			"No cross reference here.",
			"No cross reference here.",
		},
	}
	for _, tt := range tests {
		got := ConvertCrossRefs(tt.input, sectionMap)
		if got != tt.want {
			t.Errorf("ConvertCrossRefs(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestGenerateMarkdownFromSection(t *testing.T) {
	section := IngestSection{
		Heading:  "Methods",
		Level:    2,
		Content:  "We used logistic regression.",
		Keywords: []string{"regression", "logistic"},
	}
	out := GenerateMarkdownFromSection(section, "My Paper")
	if !strings.Contains(out, "source: \"My Paper\"") {
		t.Error("expected source in frontmatter")
	}
	if !strings.Contains(out, "keywords: [regression, logistic]") {
		t.Error("expected keywords in frontmatter")
	}
	if !strings.Contains(out, "## Methods") {
		t.Error("expected ## Methods heading")
	}
	if !strings.Contains(out, "logistic regression") {
		t.Error("expected content")
	}
	if !strings.Contains(out, "word_count:") {
		t.Error("expected word_count in frontmatter")
	}
}

func TestGenerateMarkdownSingleFile(t *testing.T) {
	sections := []IngestSection{
		{Heading: "Intro", Level: 1, Content: "Intro text."},
		{Heading: "Methods", Level: 2, Content: "Method text."},
	}
	out := GenerateMarkdownSingleFile(sections, "Report", []string{"key1", "key2"})
	if !strings.Contains(out, "source: \"Report\"") {
		t.Error("expected source")
	}
	if !strings.Contains(out, "sections: 2") {
		t.Error("expected sections count")
	}
	if !strings.Contains(out, "# Report") {
		t.Error("expected doc title heading")
	}
	if !strings.Contains(out, "# Intro") {
		t.Error("expected Intro heading")
	}
	if !strings.Contains(out, "## Methods") {
		t.Error("expected Methods heading")
	}
}

func TestIsMarkItDownFormat(t *testing.T) {
	tests := []struct {
		ext  string
		want bool
	}{
		{".pdf", true},
		{".PDF", true},
		{".docx", true},
		{".pptx", true},
		{".xlsx", true},
		{".html", true},
		{".epub", true},
		{".md", false},
		{".go", false},
		{".txt", false},
		{"pdf", true},
	}
	for _, tt := range tests {
		got := IsMarkItDownFormat(tt.ext)
		if got != tt.want {
			t.Errorf("IsMarkItDownFormat(%q) = %v, want %v", tt.ext, got, tt.want)
		}
	}
}

func TestDedup(t *testing.T) {
	input := []string{"a", "b", "a", "c", "b", "d"}
	got := dedup(input)
	want := []string{"a", "b", "c", "d"}
	if len(got) != len(want) {
		t.Fatalf("expected %d items, got %d", len(want), len(got))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("index %d: got %q, want %q", i, got[i], want[i])
		}
	}
}

func TestIngest_WithoutPipeline(t *testing.T) {
	input := `# Introduction
Some intro text.

# Methods
Method description.

# Results
Final results here.
`
	sections := SplitByHeadings([]byte(input))
	if len(sections) != 3 {
		t.Fatalf("expected 3 sections, got %d", len(sections))
	}

	sectionTexts := make([]string, len(sections))
	for i, s := range sections {
		sectionTexts[i] = s.Content
	}
	corpusDF := BuildCorpusDF(sectionTexts)

	for i := range sections {
		kw := ExtractKeywords(sections[i].Content, corpusDF, len(sections), 5)
		sections[i].Keywords = kw
	}

	single := GenerateMarkdownSingleFile(sections, "Test Doc", nil)
	if !strings.Contains(single, "# Test Doc") {
		t.Error("expected doc title")
	}
	if !strings.Contains(single, "# Introduction") {
		t.Error("expected Introduction section")
	}

	for _, sec := range sections {
		out := GenerateMarkdownFromSection(sec, "Test Doc")
		if !strings.Contains(out, "source: \"Test Doc\"") {
			t.Errorf("missing source in section %q", sec.Heading)
		}
	}
}

func TestIngestHeadingLevel(t *testing.T) {
	tests := []struct {
		line  string
		level int
	}{
		{"# Heading", 1},
		{"## Sub Heading", 2},
		{"### Deep", 3},
		{"Not a heading", 0},
		{"#NoSpace", 0},
		{"", 0},
		{"####", 0},
	}
	for _, tt := range tests {
		got := ingestHeadingLevel(tt.line)
		if got != tt.level {
			t.Errorf("ingestHeadingLevel(%q) = %d, want %d", tt.line, got, tt.level)
		}
	}
}
