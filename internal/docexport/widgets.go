package docexport

import (
	"fmt"
	"strings"

	"github.com/kiwifs/kiwifs/internal/markdown"
)

// RewriteWidgetFences turns every widget fence into something a static reader
// can use: the caption, the step notes, and the YAML kept as a code block for
// anyone who wants the data.
//
// Without this, pandoc, typst, marp and mkdocs all treat a widget fence as an
// opaque code block, so a PDF of a well-illustrated page is a wall of
// `activeIndices`. Rendering a real picture needs a headless pass; this is the
// honest text version until then.
func RewriteWidgetFences(content []byte) []byte {
	out := markdown.StripWidgetFences(string(content), renderStaticFence)
	return []byte(markdown.StripAppFences(out, renderStaticApp))
}

// renderStaticApp stands in for a kiwi-app. Its body is minified HTML and
// script, which in a PDF is pages of noise; the title and caption are what a
// reader can use.
func renderStaticApp(block markdown.AppFenceBlock) string {
	var buf strings.Builder
	if block.Title != "" {
		buf.WriteString("> **" + escapeInline(block.Title) + "**\n>\n")
	}
	if block.Caption != "" {
		buf.WriteString("> " + escapeInline(block.Caption) + "\n>\n")
	}
	buf.WriteString("> *Interactive app — open this page in KiwiFS to use it.*\n")
	return buf.String()
}

// HTML specials become entities rather than backslash escapes: not every
// renderer behind the export (mkdocs' Python-Markdown) honours `\<`.
var inlineEscaper = strings.NewReplacer(
	"&", "&amp;", "<", "&lt;", ">", "&gt;",
	`\`, `\\`, "`", "\\`", "*", `\*`, "_", `\_`, "[", `\[`, "]", `\]`,
	"#", `\#`, "|", `\|`, "~", `\~`, "$", `\$`,
)

// escapeInline makes fence meta, written by whoever wrote the page, print as
// the text it is instead of as markup in the exported document.
func escapeInline(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	s = inlineEscaper.Replace(s)
	// A leading list marker would turn the caption line into a list.
	if strings.HasPrefix(s, "-") || strings.HasPrefix(s, "+") {
		return `\` + s
	}
	digits := len(s) - len(strings.TrimLeft(s, "0123456789"))
	if digits > 0 && digits < len(s) && (s[digits] == '.' || s[digits] == ')') {
		return s[:digits] + `\` + s[digits:]
	}
	return s
}

func renderStaticFence(block markdown.WidgetFenceBlock) string {
	var buf strings.Builder

	// The code listing is already in the YAML below; repeating it as
	// blockquoted prose would print it twice, and unformatted.
	if prose := block.Prose(false); prose != "" {
		for _, line := range strings.Split(prose, "\n") {
			if strings.TrimSpace(line) == "" {
				buf.WriteString(">\n")
				continue
			}
			buf.WriteString("> ")
			buf.WriteString(line)
			buf.WriteString("\n")
		}
		buf.WriteString(">\n")
	}
	lang := block.Lang
	if block.Spec != nil {
		lang = block.Spec.Lang
	}
	buf.WriteString(fmt.Sprintf("> *Interactive %s widget — open this page in KiwiFS to step through it.*\n", lang))

	source := strings.TrimRight(block.Source, "\n")
	marker := strings.Repeat("`", max(3, longestBacktickRun(source)+1))
	buf.WriteString("\n" + marker + "yaml\n")
	buf.WriteString(source)
	buf.WriteString("\n" + marker + "\n")
	return buf.String()
}

// longestBacktickRun is the longest run of consecutive backticks in s. A
// `code:` listing holding a ``` fence of its own would otherwise close the
// YAML block early.
func longestBacktickRun(s string) int {
	longest, run := 0, 0
	for i := 0; i < len(s); i++ {
		if s[i] == '`' {
			run++
			longest = max(longest, run)
			continue
		}
		run = 0
	}
	return longest
}
