package importer

import (
	"bytes"
	"fmt"
	"regexp"
	"strings"

	"golang.org/x/net/html"
)

// convertConfluenceMacros handles Confluence storage format macros and converts
// them to KiwiFS markdown equivalents.
//
// Mapping:
//   {status}         → frontmatter status field + badge rendering
//   {info}           → > [!INFO]
//   {warning}        → > [!WARNING]
//   {note}           → > [!NOTE]
//   {tip}            → > [!TIP]
//   {toc}            → [[toc]]
//   {children}       → kiwi-query block listing child pages
//   {code}           → fenced code block
//   {expand}         → <details> block
//   {panel}          → blockquote with title
func convertConfluenceMacros(storageXML string) string {
	result := storageXML

	// Code macro MUST be converted FIRST since code blocks can appear
	// inside other macros (info, warning, expand, panel). Processing them
	// first means their content is already markdown when the parent macro
	// is converted by innerHTMLToMarkdown.
	result = convertCodeMacro(result)

	// Status macro (inline, not block-level)
	result = convertStatusMacro(result)

	// Expand/collapse macro - convert before admonitions since expands
	// can appear inside admonitions
	result = convertExpandMacro(result)

	// Panel macro - convert before admonitions for nesting support
	result = convertPanelMacro(result)

	// Admonition macros: info, warning, note, tip
	result = convertAdmonitionMacro(result, "info")
	result = convertAdmonitionMacro(result, "warning")
	result = convertAdmonitionMacro(result, "note")
	result = convertAdmonitionMacro(result, "tip")

	// Table of Contents
	result = convertTocMacro(result)

	// Children macro
	result = convertChildrenMacro(result)

	// Excerpt macro (just extract content)
	result = convertExcerptMacro(result)

	return result
}

var admonitionRegex = map[string]*regexp.Regexp{}

func init() {
	for _, kind := range []string{"info", "warning", "note", "tip"} {
		// Match <ac:structured-macro ac:name="info">...<ac:rich-text-body>CONTENT</ac:rich-text-body>...</ac:structured-macro>
		pattern := fmt.Sprintf(
			`(?s)<ac:structured-macro[^>]*ac:name="%s"[^>]*>.*?<ac:rich-text-body>(.*?)</ac:rich-text-body>.*?</ac:structured-macro>`,
			kind,
		)
		admonitionRegex[kind] = regexp.MustCompile(pattern)
	}
}

func convertAdmonitionMacro(input, kind string) string {
	re := admonitionRegex[kind]
	return re.ReplaceAllStringFunc(input, func(match string) string {
		submatch := re.FindStringSubmatch(match)
		if len(submatch) < 2 {
			return match
		}
		rawContent := strings.TrimSpace(submatch[1])

		// Extract optional title from ac:parameter
		title := extractMacroParam(match, "title")

		// Convert the inner HTML content to plain text/markdown before blockquoting.
		// The content is still HTML (e.g. <p>text</p>, <ul><li>...</li></ul>).
		content := innerHTMLToMarkdown(rawContent)

		// Map Confluence admonition types to KiwiFS callout types
		calloutType := strings.ToUpper(kind)

		var buf strings.Builder
		if title != "" {
			buf.WriteString(fmt.Sprintf("\n\n> [!%s] %s\n", calloutType, title))
		} else {
			buf.WriteString(fmt.Sprintf("\n\n> [!%s]\n", calloutType))
		}
		// Prefix each line of content with > for blockquote
		for _, line := range strings.Split(content, "\n") {
			buf.WriteString("> " + line + "\n")
		}
		buf.WriteString("\n")
		return buf.String()
	})
}

// innerHTMLToMarkdown converts a snippet of HTML (typically from inside a Confluence
// macro body) into simple markdown text. Handles <p>, <ul>, <ol>, <strong>, <em>, <code>.
func innerHTMLToMarkdown(htmlContent string) string {
	doc := parseHTMLString(htmlContent)
	if doc == nil {
		// Fallback: strip tags manually
		tagRe := regexp.MustCompile(`<[^>]+>`)
		return strings.TrimSpace(tagRe.ReplaceAllString(htmlContent, ""))
	}
	result := htmlToMarkdown(doc)
	return strings.TrimSpace(result)
}

var tocRegex = regexp.MustCompile(`(?s)<ac:structured-macro[^>]*ac:name="toc"[^>]*>.*?</ac:structured-macro>|<ac:structured-macro[^>]*ac:name="toc"[^>]*/>`)

func convertTocMacro(input string) string {
	return tocRegex.ReplaceAllString(input, "\n\n[[toc]]\n\n")
}

var childrenRegex = regexp.MustCompile(`(?s)<ac:structured-macro[^>]*ac:name="children"[^>]*>.*?</ac:structured-macro>|<ac:structured-macro[^>]*ac:name="children"[^>]*/>`)

func convertChildrenMacro(input string) string {
	return childrenRegex.ReplaceAllString(input, "\n\n```kiwi-query\ntype: children\n```\n\n")
}

var statusRegex = regexp.MustCompile(`(?s)<ac:structured-macro[^>]*ac:name="status"[^>]*>(.*?)</ac:structured-macro>`)

func convertStatusMacro(input string) string {
	return statusRegex.ReplaceAllStringFunc(input, func(match string) string {
		title := extractMacroParam(match, "title")
		colour := extractMacroParam(match, "colour")
		if title == "" {
			title = "STATUS"
		}
		if colour == "" {
			colour = "Grey"
		}
		return fmt.Sprintf(`<span class="status status-%s">%s</span>`, strings.ToLower(colour), title)
	})
}

var codeRegex = regexp.MustCompile(`(?s)<ac:structured-macro[^>]*ac:name="code"[^>]*>(.*?)</ac:structured-macro>`)

func convertCodeMacro(input string) string {
	return codeRegex.ReplaceAllStringFunc(input, func(match string) string {
		lang := extractMacroParam(match, "language")
		title := extractMacroParam(match, "title")

		// Extract the code body from <ac:plain-text-body>
		bodyRe := regexp.MustCompile(`(?s)<ac:plain-text-body><!\[CDATA\[(.*?)\]\]></ac:plain-text-body>`)
		bodyMatch := bodyRe.FindStringSubmatch(match)
		code := ""
		if len(bodyMatch) >= 2 {
			code = bodyMatch[1]
		}

		var buf strings.Builder
		if title != "" {
			buf.WriteString(fmt.Sprintf("\n\n**%s:**\n", title))
		}
		buf.WriteString("\n```")
		buf.WriteString(lang)
		buf.WriteByte('\n')
		buf.WriteString(code)
		buf.WriteString("\n```\n\n")
		return buf.String()
	})
}

var expandRegex = regexp.MustCompile(`(?s)<ac:structured-macro[^>]*ac:name="expand"[^>]*>(.*?)</ac:structured-macro>`)

func convertExpandMacro(input string) string {
	return expandRegex.ReplaceAllStringFunc(input, func(match string) string {
		title := extractMacroParam(match, "title")
		if title == "" {
			title = "Click to expand"
		}

		bodyRe := regexp.MustCompile(`(?s)<ac:rich-text-body>(.*?)</ac:rich-text-body>`)
		bodyMatch := bodyRe.FindStringSubmatch(match)
		content := ""
		if len(bodyMatch) >= 2 {
			content = strings.TrimSpace(bodyMatch[1])
		}

		return fmt.Sprintf("\n\n<details>\n<summary>%s</summary>\n\n%s\n\n</details>\n\n", title, content)
	})
}

var panelRegex = regexp.MustCompile(`(?s)<ac:structured-macro[^>]*ac:name="panel"[^>]*>(.*?)</ac:structured-macro>`)

func convertPanelMacro(input string) string {
	return panelRegex.ReplaceAllStringFunc(input, func(match string) string {
		title := extractMacroParam(match, "title")

		bodyRe := regexp.MustCompile(`(?s)<ac:rich-text-body>(.*?)</ac:rich-text-body>`)
		bodyMatch := bodyRe.FindStringSubmatch(match)
		content := ""
		if len(bodyMatch) >= 2 {
			content = strings.TrimSpace(bodyMatch[1])
		}

		var buf strings.Builder
		if title != "" {
			buf.WriteString(fmt.Sprintf("\n\n> **%s**\n>\n", title))
		} else {
			buf.WriteString("\n\n")
		}
		for _, line := range strings.Split(content, "\n") {
			buf.WriteString("> ")
			buf.WriteString(line)
			buf.WriteByte('\n')
		}
		buf.WriteString("\n\n")
		return buf.String()
	})
}

var excerptRegex = regexp.MustCompile(`(?s)<ac:structured-macro[^>]*ac:name="excerpt"[^>]*>(.*?)</ac:structured-macro>`)

func convertExcerptMacro(input string) string {
	return excerptRegex.ReplaceAllStringFunc(input, func(match string) string {
		bodyRe := regexp.MustCompile(`(?s)<ac:rich-text-body>(.*?)</ac:rich-text-body>`)
		bodyMatch := bodyRe.FindStringSubmatch(match)
		if len(bodyMatch) >= 2 {
			return strings.TrimSpace(bodyMatch[1])
		}
		return ""
	})
}

// extractMacroParam extracts a named parameter value from a Confluence macro XML block.
func extractMacroParam(macroXML, paramName string) string {
	pattern := fmt.Sprintf(`<ac:parameter ac:name="%s">(.*?)</ac:parameter>`, regexp.QuoteMeta(paramName))
	re := regexp.MustCompile(pattern)
	match := re.FindStringSubmatch(macroXML)
	if len(match) >= 2 {
		return match[1]
	}
	return ""
}

// parseHTMLString parses an HTML string into an *html.Node for tree traversal.
func parseHTMLString(s string) *html.Node {
	doc, err := html.Parse(bytes.NewReader([]byte(s)))
	if err != nil {
		return nil
	}
	return doc
}

// convertConfluenceInlineElements converts Confluence-specific inline XML elements
// (emoticons, links, task lists, time, etc.) into standard HTML before the HTML
// parser runs. Without this, the HTML parser treats them as unknown elements and
// strips their content.
func convertConfluenceInlineElements(input string) string {
	result := input

	// Task lists: <ac:task-list> → markdown checkbox list
	result = convertTaskList(result)

	// Emoticons: <ac:emoticon ac:emoji-fallback="✅"/> → emoji text
	result = convertEmoticons(result)

	// Attachments: <ri:attachment ri:filename="..."> links/images → local _assets paths
	result = convertAttachmentRefs(result)

	// Page links: <ac:link><ri:page ri:content-title="Page Title"/></ac:link> → [[Page Title]]
	result = convertPageLinks(result)

	// Anchor links: <ac:link ac:anchor="..."><ac:plain-text-link-body>text</ac:plain-text-link-body></ac:link>
	result = convertAnchorLinks(result)

	// User mentions: <ac:link><ri:user ri:userkey="..."/></ac:link> → @user
	result = convertUserMentions(result)

	// Time elements: <time datetime="2026-06-15"/> → 2026-06-15
	result = convertTimeElements(result)

	// Jira macro (common): show as linked issue key
	result = convertJiraMacro(result)

	// Unknown/corrupted macros: extract any remaining ac:plain-text-body content
	result = convertCorruptedMacros(result)

	return result
}

var attachmentImageRegex = regexp.MustCompile(`(?s)<ac:image[^>]*>.*?<ri:attachment[^>]*ri:filename="([^"]+)"[^>]*/>.*?</ac:image>`)
var attachmentLinkWithBodyRegex = regexp.MustCompile(`(?s)<ac:link[^>]*>.*?<ri:attachment[^>]*ri:filename="([^"]+)"[^>]*/>.*?<ac:plain-text-link-body><!\[CDATA\[(.*?)\]\]></ac:plain-text-link-body>.*?</ac:link>`)
var attachmentLinkSimpleRegex = regexp.MustCompile(`(?s)<ac:link[^>]*>\s*<ri:attachment[^>]*ri:filename="([^"]+)"[^>]*/>\s*</ac:link>`)

func convertAttachmentRefs(input string) string {
	result := attachmentImageRegex.ReplaceAllStringFunc(input, func(match string) string {
		m := attachmentImageRegex.FindStringSubmatch(match)
		if len(m) < 2 {
			return match
		}
		filename := m[1]
		return fmt.Sprintf(`<img src="_assets/%s" alt="%s" />`, filename, filename)
	})
	result = attachmentLinkWithBodyRegex.ReplaceAllString(result, `[$2](_assets/$1)`)
	result = attachmentLinkSimpleRegex.ReplaceAllString(result, `[_assets/$1](_assets/$1)`)
	return result
}

var taskListRegex = regexp.MustCompile(`(?s)<ac:task-list>(.*?)</ac:task-list>`)
var taskRegex = regexp.MustCompile(`(?s)<ac:task>.*?<ac:task-status>(.*?)</ac:task-status>.*?<ac:task-body>(.*?)</ac:task-body>.*?</ac:task>`)

func convertTaskList(input string) string {
	return taskListRegex.ReplaceAllStringFunc(input, func(match string) string {
		var buf strings.Builder
		buf.WriteString("\n<ul>\n")
		tasks := taskRegex.FindAllStringSubmatch(match, -1)
		for _, t := range tasks {
			if len(t) < 3 {
				continue
			}
			status := t[1]
			body := t[2]
			// Strip <span> wrapper from task body
			spanRe := regexp.MustCompile(`<span[^>]*>(.*?)</span>`)
			if m := spanRe.FindStringSubmatch(body); len(m) >= 2 {
				body = m[1]
			}
			if status == "complete" {
				buf.WriteString("<li>[x] " + body + "</li>\n")
			} else {
				buf.WriteString("<li>[ ] " + body + "</li>\n")
			}
		}
		buf.WriteString("</ul>\n")
		return buf.String()
	})
}

var emoticonRegex = regexp.MustCompile(`<ac:emoticon[^>]*ac:emoji-fallback="([^"]*)"[^>]*/>`)

func convertEmoticons(input string) string {
	return emoticonRegex.ReplaceAllString(input, "$1")
}

var pageLinkWithBodyRegex = regexp.MustCompile(`(?s)<ac:link[^>]*>.*?<ri:page[^>]*ri:content-title="([^"]*)"[^>]*/>.*?<ac:plain-text-link-body><!\[CDATA\[(.*?)\]\]></ac:plain-text-link-body>.*?</ac:link>`)
var pageLinkSimpleRegex = regexp.MustCompile(`(?s)<ac:link[^>]*>\s*<ri:page[^>]*ri:content-title="([^"]*)"[^>]*/>\s*</ac:link>`)

func convertPageLinks(input string) string {
	// Use [[wiki-link|label]] syntax for Confluence page references
	result := pageLinkWithBodyRegex.ReplaceAllString(input, `[[$1|$2]]`)
	result = pageLinkSimpleRegex.ReplaceAllString(result, `[[$1]]`)
	return result
}

var anchorLinkRegex = regexp.MustCompile(`(?s)<ac:link[^>]*ac:anchor="([^"]*)"[^>]*>.*?<ac:plain-text-link-body><!\[CDATA\[(.*?)\]\]></ac:plain-text-link-body>.*?</ac:link>`)

func convertAnchorLinks(input string) string {
	return anchorLinkRegex.ReplaceAllString(input, `<a href="#$1">$2</a>`)
}

var userMentionRegex = regexp.MustCompile(`(?s)<ac:link[^>]*>\s*<ri:user[^>]*ri:userkey="([^"]*)"[^>]*/>\s*</ac:link>`)

func convertUserMentions(input string) string {
	return userMentionRegex.ReplaceAllString(input, `@$1`)
}

var timeRegex = regexp.MustCompile(`<time[^>]*datetime="([^"]*)"[^>]*/>`)

func convertTimeElements(input string) string {
	return timeRegex.ReplaceAllString(input, `$1`)
}

var jiraMacroRegex = regexp.MustCompile(`(?s)<ac:structured-macro[^>]*ac:name="jira"[^>]*>(.*?)</ac:structured-macro>`)

func convertJiraMacro(input string) string {
	return jiraMacroRegex.ReplaceAllStringFunc(input, func(match string) string {
		key := extractMacroParam(match, "key")
		server := extractMacroParam(match, "server")
		if key != "" {
			if server != "" {
				return fmt.Sprintf(`<code>%s</code>`, key)
			}
			return fmt.Sprintf(`<code>%s</code>`, key)
		}
		return ""
	})
}

var corruptedMacroRegex = regexp.MustCompile(`(?s)<ac:structured-macro>.*?<ac:plain-text-body><!\[CDATA\[(.*?)\]\]></ac:plain-text-body>\s*</ac:structured-macro>`)

func convertCorruptedMacros(input string) string {
	return corruptedMacroRegex.ReplaceAllStringFunc(input, func(match string) string {
		bodyRe := regexp.MustCompile(`(?s)<ac:plain-text-body><!\[CDATA\[(.*?)\]\]></ac:plain-text-body>`)
		bodyMatch := bodyRe.FindStringSubmatch(match)
		if len(bodyMatch) >= 2 {
			lang := extractMacroParam(match, "language")
			code := bodyMatch[1]
			return fmt.Sprintf("\n```%s\n%s\n```\n", lang, code)
		}
		return match
	})
}
