package links

import (
	"context"
	"fmt"
	"reflect"
	"testing"
	"time"
)

func TestExtractContradicts(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		fm   map[string]any
		want []string
	}{
		{
			name: "string path",
			fm:   map[string]any{"contradicts": "pages/b.md"},
			want: []string{"pages/b.md"},
		},
		{
			name: "leading slash stripped",
			fm:   map[string]any{"contradicts": "/pages/b.md"},
			want: []string{"pages/b.md"},
		},
		{
			name: "wiki link syntax",
			fm:   map[string]any{"contradicts": "[[pages/b.md|legacy]]"},
			want: []string{"pages/b.md"},
		},
		{
			name: "string array",
			fm:   map[string]any{"contradicts": []any{"pages/b.md", "pages/c.md"}},
			want: []string{"pages/b.md", "pages/c.md"},
		},
		{
			name: "native string slice",
			fm:   map[string]any{"contradicts": []string{"pages/d.md"}},
			want: []string{"pages/d.md"},
		},
		{
			name: "absent",
			fm:   map[string]any{"title": "x"},
			want: nil,
		},
		{
			name: "wiki link with leading slash inside brackets",
			fm:   map[string]any{"contradicts": "[[/pages/b.md]]"},
			want: []string{"pages/b.md"},
		},
		{
			name: "wiki link with leading slash and label",
			fm:   map[string]any{"contradicts": "[[/pages/b.md|old policy]]"},
			want: []string{"pages/b.md"},
		},
		{
			name: "array with mixed slash wiki-links",
			fm:   map[string]any{"contradicts": []any{"[[/pages/a.md]]", "/pages/b.md", "pages/c.md"}},
			want: []string{"pages/a.md", "pages/b.md", "pages/c.md"},
		},
		{
			name: "empty wiki-link",
			fm:   map[string]any{"contradicts": "[[]]"},
			want: nil,
		},
		{
			name: "whitespace only",
			fm:   map[string]any{"contradicts": "   "},
			want: nil,
		},
		{
			name: "nil value",
			fm:   map[string]any{"contradicts": nil},
			want: nil,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ExtractContradicts(tc.fm)
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("got %v want %v", got, tc.want)
			}
		})
	}
}

func TestExtractForIndex(t *testing.T) {
	t.Parallel()
	content := []byte(`---
contradicts: pages/b.md
---
See [[foo]] and [[bar|label]].
`)
	got := ExtractForIndex(content, nil)
	want := []Link{
		{Target: "foo"},
		{Target: "bar"},
		{Target: "pages/b.md", Relation: RelationContradicts},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

func TestExtractAndUnique(t *testing.T) {
	body := []byte("see [[foo]] and [[bar|label]] and [[foo]] again\n")
	got := Extract(body)
	want := []string{"foo", "bar", "foo"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("extract: %v", got)
	}
	uniq := Unique(got)
	if len(uniq) != 2 || uniq[0] != "foo" || uniq[1] != "bar" {
		t.Fatalf("unique: %v", uniq)
	}
}

func TestExtract_IgnoresFencedCodeBlock(t *testing.T) {
	body := []byte("see [[real]] link\n```\n[[inside-code]]\n```\nand [[another]]\n")
	got := Extract(body)
	want := []string{"real", "another"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestExtract_IgnoresFencedCodeBlockWithLanguage(t *testing.T) {
	body := []byte("# Config\n\n```toml\n[server]\nhost = \"localhost\"\n\n[[routes]]\npath = \"/api\"\n```\n\nSee [[config-docs]]\n")
	got := Extract(body)
	want := []string{"config-docs"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestExtract_IgnoresTildeFencedCodeBlock(t *testing.T) {
	body := []byte("~~~\n[[in-tilde-fence]]\n~~~\n[[real]]\n")
	got := Extract(body)
	want := []string{"real"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestExtract_IgnoresIndentedCodeBlock(t *testing.T) {
	// Per CommonMark §4.4, indented code blocks require a preceding blank
	// line — they cannot interrupt a paragraph. Lines after a blank line
	// with 4+ space / tab indent ARE code; lines continuing a paragraph
	// with 4+ spaces are hanging indents (NOT code), so links are kept.
	body := []byte("# heading\n\n    [[indented-code-after-blank]]\n\t[[tab-indented-after-blank]]\nnot indented [[real]]\n")
	got := Extract(body)
	want := []string{"real"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestExtract_IndentedAfterParagraphIsNotCode(t *testing.T) {
	// CommonMark §4.4: "An indented code block cannot interrupt a paragraph"
	// so 4-space-indented lines after non-blank content are paragraph
	// continuations (hanging indent), not code. Links should be extracted.
	body := []byte("paragraph text\n    [[hanging-indent-link]]\nnormal [[other]]\n")
	got := Extract(body)
	want := []string{"hanging-indent-link", "other"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestExtract_ListContinuationWithLinks(t *testing.T) {
	// List item continuation is indented but not a code block.
	body := []byte("- item one\n    continuation with [[link-in-list]]\n- item two [[another]]\n")
	got := Extract(body)
	want := []string{"link-in-list", "another"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestExtract_ConsecutiveIndentedCodeLines(t *testing.T) {
	// Multiple indented lines after a blank line are all code.
	body := []byte("text\n\n    [[code-line-1]]\n    [[code-line-2]]\n\n[[real]]\n")
	got := Extract(body)
	want := []string{"real"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestExtract_IgnoresInlineCode(t *testing.T) {
	body := []byte("Use `[[not-a-link]]` syntax, but [[real-link]] is real.\n")
	got := Extract(body)
	want := []string{"real-link"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestExtract_IgnoresDoubleBacktickInlineCode(t *testing.T) {
	body := []byte("Example ``[[not-a-link]]`` and [[yes]].\n")
	got := Extract(body)
	want := []string{"yes"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestExtract_MixedCodeAndRealLinks(t *testing.T) {
	body := []byte("[[a]] before\n```python\nx = [[b]]\n```\nMiddle `[[c]]` text\n~~~\n[[d]]\n~~~\n[[e]] end\n")
	got := Extract(body)
	want := []string{"a", "e"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestExtract_UnclosedFenceTreatsRestAsCode(t *testing.T) {
	body := []byte("[[before]]\n```\n[[inside]]\nno closing fence\n[[also-inside]]\n")
	got := Extract(body)
	want := []string{"before"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestExtract_FenceLengthMustMatch(t *testing.T) {
	body := []byte("````\n[[inside]]\n```\n[[still-inside]]\n````\n[[outside]]\n")
	got := Extract(body)
	want := []string{"outside"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestExtract_NoLinksReturnsNil(t *testing.T) {
	body := []byte("```\n[[only-in-code]]\n```\n")
	got := Extract(body)
	if got != nil {
		t.Fatalf("expected nil, got %v", got)
	}
}

// --- Edge cases per CommonMark spec ---

func TestExtract_FourSpaceIndentIsNotFence(t *testing.T) {
	// CommonMark §4.5: "Four spaces of indentation is too many"
	// A line with 4+ spaces is an indented code block, NOT a fence opener.
	// The [[link]] after the "fence" should still be extracted since the
	// fake fence never opened.
	body := []byte("    ```\n    [[indented-content]]\n    ```\n[[real]]\n")
	got := Extract(body)
	// The 4-space lines are not fences, so [[indented-content]] is visible
	// to the regex (it's just indented text, not inside a real fence).
	// [[real]] is also visible.
	if len(got) < 1 {
		t.Fatalf("expected at least [[real]], got %v", got)
	}
	found := false
	for _, g := range got {
		if g == "real" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected [[real]] to be extracted, got %v", got)
	}
}

func TestExtract_ThreeSpaceIndentIsFence(t *testing.T) {
	// CommonMark §4.5: up to 3 spaces of indentation is valid for a fence.
	body := []byte("   ```\n[[inside]]\n   ```\n[[outside]]\n")
	got := Extract(body)
	want := []string{"outside"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestExtract_ClosingFenceIndentedFourSpaces(t *testing.T) {
	// CommonMark: "This is not a closing fence, because it is indented 4 spaces"
	// So the fence stays open past the 4-space-indented "closing" line.
	body := []byte("```\n[[inside]]\n    ```\n[[still-inside]]\n```\n[[outside]]\n")
	got := Extract(body)
	want := []string{"outside"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestExtract_BacktickInfoStringWithBackticks(t *testing.T) {
	// CommonMark §4.5: "Info strings for backtick code blocks cannot
	// contain backticks". So this is NOT a valid fence opener.
	body := []byte("``` foo`bar\n[[visible]]\n```\n")
	got := Extract(body)
	if len(got) == 0 || got[0] != "visible" {
		t.Fatalf("expected [[visible]] (invalid fence), got %v", got)
	}
}

func TestExtract_TildeInfoStringWithBackticks(t *testing.T) {
	// Tilde fences CAN have backticks in the info string.
	body := []byte("~~~ foo`bar\n[[hidden]]\n~~~\n[[visible]]\n")
	got := Extract(body)
	want := []string{"visible"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestExtract_TildeCannotCloseBacktickFence(t *testing.T) {
	// CommonMark: "The closing code fence must use the same character"
	body := []byte("```\n[[inside]]\n~~~\n[[still-inside]]\n```\n[[outside]]\n")
	got := Extract(body)
	want := []string{"outside"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestExtract_EmptyFencedBlock(t *testing.T) {
	body := []byte("```\n```\n[[after]]\n")
	got := Extract(body)
	want := []string{"after"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestExtract_MultipleFencedBlocks(t *testing.T) {
	body := []byte("[[a]]\n```\n[[b]]\n```\n[[c]]\n~~~\n[[d]]\n~~~\n[[e]]\n")
	got := Extract(body)
	want := []string{"a", "c", "e"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestExtract_EmbedSyntaxInCodeBlock(t *testing.T) {
	body := []byte("```\n![[embed-in-code]]\n```\n![[real-embed]]\n")
	got := Extract(body)
	want := []string{"real-embed"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestExtract_WikilinkWithPathInCodeBlock(t *testing.T) {
	body := []byte("```\n[[concepts/auth]]\n```\n[[concepts/billing]]\n")
	got := Extract(body)
	want := []string{"concepts/billing"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestExtract_LabeledWikilinkInInlineCode(t *testing.T) {
	body := []byte("See `[[auth|login docs]]` and [[billing|payments]].\n")
	got := Extract(body)
	want := []string{"billing"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestExtract_UnmatchedBacktickDoesNotSwallowLine(t *testing.T) {
	// A single backtick with no closing should not eat the rest of the line.
	body := []byte("It's a `broken span [[real-link]] here.\n")
	got := Extract(body)
	want := []string{"real-link"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestExtract_TripleBacktickInlineCode(t *testing.T) {
	// Triple backtick as inline code (matched by triple closing backticks on same line).
	body := []byte("Run ```[[not-link]]``` to test, and see [[real]].\n")
	got := Extract(body)
	want := []string{"real"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestExtract_FrontmatterNotAffected(t *testing.T) {
	// YAML frontmatter delimiters (---) should not interfere with fence detection.
	body := []byte("---\ntitle: test\n---\n\n[[real-link]]\n\n```\n[[in-code]]\n```\n")
	got := Extract(body)
	want := []string{"real-link"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestExtract_FrontmatterWikilinksIgnored(t *testing.T) {
	// Wikilink syntax in frontmatter values (e.g. contradicts: [[path]])
	// must not be extracted as body wikilinks. The contradicts field is
	// handled separately by ExtractContradicts.
	body := []byte("---\ntitle: test\ncontradicts: \"[[pages/old.md]]\"\n---\n\n[[real-link]]\n")
	got := Extract(body)
	want := []string{"real-link"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestExtract_NoFrontmatterStillWorks(t *testing.T) {
	body := []byte("# No Frontmatter\n\n[[link-a]] and [[link-b]]\n")
	got := Extract(body)
	want := []string{"link-a", "link-b"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestExtract_TOMLArrayOfTables(t *testing.T) {
	// The exact scenario from issue #301.
	body := []byte("---\ntitle: example config\ntype: resource\nprovenance: human\nstatus: active\n---\n\n# Example TOML Configuration\n\n```toml\n[server]\nhost = \"localhost\"\nport = 8080\n\n[[routes]]\npath = \"/api\"\nhandler = \"proxy\"\n```\n")
	got := Extract(body)
	if got != nil {
		t.Fatalf("expected nil (no real wikilinks), got %v", got)
	}
}

func TestExtract_ConsecutiveInlineCodeSpans(t *testing.T) {
	body := []byte("`[[a]]` normal `[[b]]` text [[c]].\n")
	got := Extract(body)
	want := []string{"c"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestExtract_FencedBlockWithTrailingSpaces(t *testing.T) {
	// Trailing spaces after closing fence are allowed per CommonMark.
	body := []byte("```   \n[[inside]]\n```   \n[[outside]]\n")
	got := Extract(body)
	want := []string{"outside"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestExtract_FiveBacktickFence(t *testing.T) {
	// Opening with 5 backticks requires at least 5 to close.
	body := []byte("`````\n[[inside]]\n```\n[[still-inside]]\n`````\n[[outside]]\n")
	got := Extract(body)
	want := []string{"outside"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestResolveWikiLinksToMarkdown(t *testing.T) {
	resolver := func(target string) string {
		m := map[string]string{
			"auth":    "concepts/auth.md",
			"billing": "concepts/billing.md",
			"notes":   "my notes/auth flow.md",
			"日本語":     "日本語/ノート.md",
			"sharp":   "file#2.md",
		}
		return m[target]
	}
	cases := []struct {
		name, input, want string
	}{
		{
			"bare link",
			"See [[auth]] for details.",
			"See [auth](https://wiki.co/page/concepts/auth.md) for details.",
		},
		{
			"labeled link",
			"Check [[auth|authentication docs]] here.",
			"Check [authentication docs](https://wiki.co/page/concepts/auth.md) here.",
		},
		{
			"unresolved link stays",
			"See [[unknown]] page.",
			"See [[unknown]] page.",
		},
		{
			"multiple links",
			"See [[auth]] and [[billing]].",
			"See [auth](https://wiki.co/page/concepts/auth.md) and [billing](https://wiki.co/page/concepts/billing.md).",
		},
		{
			"empty publicURL returns unchanged",
			"See [[auth]].",
			"See [[auth]].",
		},
		{
			"path with spaces",
			"See [[notes]].",
			"See [notes](https://wiki.co/page/my%20notes/auth%20flow.md).",
		},
		{
			"unicode path",
			"See [[日本語]].",
			"See [日本語](https://wiki.co/page/%E6%97%A5%E6%9C%AC%E8%AA%9E/%E3%83%8E%E3%83%BC%E3%83%88.md).",
		},
		{
			"path with hash",
			"See [[sharp]].",
			"See [sharp](https://wiki.co/page/file%232.md).",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			pub := "https://wiki.co"
			if tc.name == "empty publicURL returns unchanged" {
				pub = ""
			}
			got := ResolveWikiLinksToMarkdown(tc.input, pub, resolver)
			if got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestTargetForms(t *testing.T) {
	forms := TargetForms("concepts/authentication.md")
	// concepts/authentication.md, concepts/authentication, authentication.md, authentication
	wantContains := []string{
		"concepts/authentication.md",
		"concepts/authentication",
		"authentication.md",
		"authentication",
	}
	m := map[string]bool{}
	for _, f := range forms {
		m[f] = true
	}
	for _, w := range wantContains {
		if !m[w] {
			t.Fatalf("missing form %q in %v", w, forms)
		}
	}
}

func TestTargetFormsSpecialChars(t *testing.T) {
	cases := []struct {
		path string
		want []string
	}{
		{
			"my notes/auth flow.md",
			[]string{"my notes/auth flow.md", "my notes/auth flow", "auth flow.md", "auth flow"},
		},
		{
			"日本語/ノート.md",
			[]string{"日本語/ノート.md", "日本語/ノート", "ノート.md", "ノート"},
		},
		{
			"file#2.md",
			[]string{"file#2.md", "file#2"},
		},
	}
	for _, tc := range cases {
		m := map[string]bool{}
		for _, f := range TargetForms(tc.path) {
			m[f] = true
		}
		for _, w := range tc.want {
			if !m[w] {
				t.Errorf("TargetForms(%q): missing %q, got %v", tc.path, w, TargetForms(tc.path))
			}
		}
	}
}

func TestResolverCaching(t *testing.T) {
	const fileCount = 1000
	paths := make([]string, fileCount)
	for i := range paths {
		paths[i] = fmt.Sprintf("dir%d/file%d.md", i%10, i)
	}

	walker := func(_ context.Context, fn func(string)) error {
		for _, p := range paths {
			fn(p)
		}
		return nil
	}
	r := NewResolver(walker)

	ctx := context.Background()
	content := "See [[file500]] for details."

	got := r.Resolve(ctx, content, "https://wiki.co")
	if got == content {
		t.Fatalf("first resolve returned unmodified content")
	}

	start := time.Now()
	got2 := r.Resolve(ctx, content, "https://wiki.co")
	elapsed := time.Since(start)

	if got2 != got {
		t.Fatalf("second resolve returned different result: %q vs %q", got2, got)
	}
	if elapsed > 10*time.Millisecond {
		t.Fatalf("cached resolve took %v, expected <10ms", elapsed)
	}
}

func BenchmarkResolverResolve(b *testing.B) {
	const fileCount = 1000
	paths := make([]string, fileCount)
	for i := range paths {
		paths[i] = fmt.Sprintf("dir%d/file%d.md", i%10, i)
	}
	walker := func(_ context.Context, fn func(string)) error {
		for _, p := range paths {
			fn(p)
		}
		return nil
	}
	r := NewResolver(walker)
	ctx := context.Background()
	content := "See [[file500]] and [[file100]] and [[file999]]."

	r.Resolve(ctx, content, "https://wiki.co")

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		r.Resolve(ctx, content, "https://wiki.co")
	}
}

func TestExtractTypedField(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name, field string
		fm          map[string]any
		want        []string
	}{
		{
			name: "string wiki link", field: "cites",
			fm: map[string]any{"cites": "[[pages/ref.md]]"},
			want: []string{"pages/ref.md"},
		},
		{
			name: "supersedes string", field: "supersedes",
			fm: map[string]any{"supersedes": "[[pages/old.md]]"},
			want: []string{"pages/old.md"},
		},
		{
			name: "superseded_by string", field: "superseded_by",
			fm: map[string]any{"superseded_by": "/pages/new.md"},
			want: []string{"pages/new.md"},
		},
		{
			name: "array values", field: "supersedes",
			fm: map[string]any{"supersedes": []any{"pages/a.md", "[[pages/b.md]]"}},
			want: []string{"pages/a.md", "pages/b.md"},
		},
		{
			name: "missing field", field: "extends",
			fm: map[string]any{"title": "x"},
			want: nil,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ExtractTypedField(tc.fm, tc.field)
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("got %v want %v", got, tc.want)
			}
		})
	}
}

func TestExtractTypedFieldsMultipleRelations(t *testing.T) {
	t.Parallel()
	fm := map[string]any{
		"cites":       "pages/a.md",
		"extends":     []any{"pages/b.md"},
		"contradicts": "pages/c.md",
	}
	got := ExtractTypedFields(fm, []string{"cites", "extends", "contradicts"})
	want := []Link{
		{Target: "pages/a.md", Relation: "cites"},
		{Target: "pages/b.md", Relation: "extends"},
		{Target: "pages/c.md", Relation: "contradicts"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

func TestExtractForIndexRespectsTypedFieldsConfig(t *testing.T) {
	t.Parallel()
	content := []byte(`---
cites: pages/b.md
contradicts: pages/c.md
---
See [[foo]].
`)
	got := ExtractForIndex(content, []string{"cites"})
	want := []Link{
		{Target: "foo"},
		{Target: "pages/b.md", Relation: "cites"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

func TestValidTypedFieldName(t *testing.T) {
	t.Parallel()
	valid := []string{"cites", "supersedes", "superseded_by", "variant_of", "extends", "services", "contradicts"}
	for _, name := range valid {
		if !ValidTypedFieldName(name) {
			t.Fatalf("%q should be valid", name)
		}
	}
	invalid := []string{"", "cites; DROP TABLE links", "field.name", "field-name", "123", "a b"}
	for _, name := range invalid {
		if ValidTypedFieldName(name) {
			t.Fatalf("%q should be invalid", name)
		}
	}
}

func TestSanitizeTypedLinkFields(t *testing.T) {
	t.Parallel()
	got := SanitizeTypedLinkFields([]string{"cites", "bad;injection", "extends", ""})
	want := []string{"cites", "extends"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}
