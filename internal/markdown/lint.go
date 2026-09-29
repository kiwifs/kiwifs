package markdown

import (
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	extast "github.com/yuin/goldmark/extension/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
	"gopkg.in/yaml.v3"
)

// LintIssue is a single finding from LintMarkdown.
type LintIssue struct {
	Rule     string `json:"rule"`   // e.g. "table-column-mismatch"
	Line     int    `json:"line"`   // 1-based, 0 = file-level
	Column   int    `json:"column"` // 1-based, 0 = N/A
	Message  string `json:"message"`
	Severity string `json:"severity"` // "error" | "warning"
}

// LintMarkdown checks content for structural/semantic issues that
// auto-format cannot fix. Returns nil if clean.
func LintMarkdown(content []byte) []LintIssue {
	var issues []LintIssue

	fm, body, fmErr := SplitFrontmatter(content)

	// Rule 1: frontmatter-yaml-invalid
	if fmErr != nil {
		issues = append(issues, LintIssue{
			Rule:     "frontmatter-yaml-invalid",
			Line:     1,
			Message:  "frontmatter block not terminated",
			Severity: "error",
		})
	} else if fm != nil {
		var parsed map[string]any
		if err := yaml.Unmarshal(fm, &parsed); err != nil {
			issues = append(issues, LintIssue{
				Rule:     "frontmatter-yaml-invalid",
				Line:     1,
				Message:  "YAML parse error in frontmatter: " + err.Error(),
				Severity: "error",
			})
		} else {
			// Rule 2: frontmatter-missing-required
			issues = append(issues, lintFrontmatterRequired(parsed)...)

			// Rule 10: frontmatter-date-invalid
			issues = append(issues, lintFrontmatterDates(parsed)...)
		}
	} else {
		// No frontmatter at all — still check required fields.
		issues = append(issues, lintFrontmatterRequired(nil)...)
	}

	// Parse the body (after frontmatter) with goldmark for AST-based rules.
	if body == nil {
		body = content
	}
	md := goldmark.New(goldmark.WithExtensions(extension.Table))
	doc := md.Parser().Parse(text.NewReader(body), parser.WithContext(parser.NewContext()))

	// Calculate frontmatter line offset so reported line numbers are
	// relative to the full file, not just the body.
	fmLineOffset := 0
	if fm != nil {
		// frontmatter block = "---\n" + fm + "---\n"
		fmLineOffset = 2 // opening and closing "---" lines
		for _, b := range fm {
			if b == '\n' {
				fmLineOffset++
			}
		}
	}

	// Rule 3 & 4: table rules
	issues = append(issues, lintTables(body, doc, fmLineOffset)...)

	// Rule 5: fence-unclosed (post-format check)
	issues = append(issues, lintFences(body, fmLineOffset)...)

	// Rule 6: fence-mermaid-invalid
	issues = append(issues, lintMermaid(body, fmLineOffset)...)

	// Rule 7: heading-duplicate-slug
	// Rule 8: heading-skip-level
	issues = append(issues, lintHeadings(body, doc, fmLineOffset)...)

	// Rule 9: link-image-broken
	issues = append(issues, lintBrokenImages(body, doc, fmLineOffset)...)

	issues = append(issues, lintQuizCallouts(content)...)

	if len(issues) == 0 {
		return nil
	}
	return issues
}

// ---------------------------------------------------------------------------
// Rule 2: frontmatter-missing-required
// ---------------------------------------------------------------------------

func lintFrontmatterRequired(fm map[string]any) []LintIssue {
	var issues []LintIssue
	if _, ok := fm["title"]; !ok {
		issues = append(issues, LintIssue{
			Rule:     "frontmatter-missing-required",
			Line:     1,
			Message:  "frontmatter missing required field: title",
			Severity: "warning",
		})
	}
	return issues
}

// ---------------------------------------------------------------------------
// Rule 10: frontmatter-date-invalid
// ---------------------------------------------------------------------------

// iso8601Formats are the date/datetime formats we accept.
var iso8601Formats = []string{
	"2006-01-02",
	"2006-01-02T15:04:05Z07:00",
	"2006-01-02T15:04:05Z",
	"2006-01-02T15:04:05",
	"2006-01-02 15:04:05",
}

func lintFrontmatterDates(fm map[string]any) []LintIssue {
	var issues []LintIssue
	for _, key := range []string{"created", "updated", "last-reviewed"} {
		v, ok := fm[key]
		if !ok {
			continue
		}
		s, ok := v.(string)
		if !ok {
			// Could be a time.Time already parsed by YAML decoder.
			if _, ok := v.(time.Time); ok {
				continue
			}
			continue
		}
		valid := false
		for _, fmt := range iso8601Formats {
			if _, err := time.Parse(fmt, s); err == nil {
				valid = true
				break
			}
		}
		if !valid {
			issues = append(issues, LintIssue{
				Rule:     "frontmatter-date-invalid",
				Line:     1,
				Message:  key + " is not a valid ISO 8601 date: " + s,
				Severity: "warning",
			})
		}
	}
	return issues
}

// ---------------------------------------------------------------------------
// Rules 3 & 4: table-column-mismatch, table-no-separator
// ---------------------------------------------------------------------------

func lintTables(body []byte, doc ast.Node, lineOffset int) []LintIssue {
	var issues []LintIssue

	// Walk the AST to find table nodes.
	ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		tbl, ok := n.(*extast.Table)
		if !ok {
			return ast.WalkContinue, nil
		}

		// Count header columns.
		header, ok := tbl.FirstChild().(*extast.TableHeader)
		if !ok {
			return ast.WalkContinue, nil
		}
		headerCols := 0
		for c := header.FirstChild(); c != nil; c = c.NextSibling() {
			headerCols++
		}

		// Check each row.
		for row := header.NextSibling(); row != nil; row = row.NextSibling() {
			tr, ok := row.(*extast.TableRow)
			if !ok {
				continue
			}
			rowCols := 0
			for c := tr.FirstChild(); c != nil; c = c.NextSibling() {
				rowCols++
			}
			if rowCols != headerCols {
				line := nodeLineNumber(body, tr) + lineOffset
				issues = append(issues, LintIssue{
					Rule:     "table-column-mismatch",
					Line:     line,
					Message:  "data row has " + itoa(rowCols) + " columns, header has " + itoa(headerCols),
					Severity: "error",
				})
			}
		}

		return ast.WalkContinue, nil
	})

	// Rule 4: table-no-separator — check using raw text since goldmark
	// won't parse a table without separators as a Table node.
	issues = append(issues, lintTableSeparators(body, lineOffset)...)

	return issues
}

// lintTableSeparators checks for table-like blocks where the header row
// is not followed by a separator row.
func lintTableSeparators(body []byte, lineOffset int) []LintIssue {
	var issues []LintIssue
	lines := strings.Split(string(body), "\n")
	inFence := false
	var fenceMarker string

	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if !inFence {
			if isOpeningFence(trimmed) {
				inFence = true
				fenceMarker = extractFenceMarker(trimmed)
				continue
			}
		} else {
			if isClosingFence(trimmed, fenceMarker) {
				inFence = false
				fenceMarker = ""
			}
			continue
		}

		// Check if this line looks like a table row and the next doesn't
		// have a separator. We only flag if: this line has pipes, and
		// the NEXT line also has pipes (suggesting a table) but no
		// separator row between them.
		if tableLineRe.MatchString(line) {
			cells := parseTableRow(line)
			if len(cells) < 2 {
				continue
			}
			// Check the next line.
			if i+1 < len(lines) && tableLineRe.MatchString(lines[i+1]) {
				nextCells := parseTableRow(lines[i+1])
				if !isSeparatorRow(nextCells) {
					// Is there a separator already? Check if previous line
					// was a header (i.e., this is a data row).
					if i > 0 && tableLineRe.MatchString(lines[i-1]) {
						prevCells := parseTableRow(lines[i-1])
						if isSeparatorRow(prevCells) {
							continue // There IS a separator before this row.
						}
					}
					// Check if this is the first table line — it might be
					// the header with a missing separator.
					if i == 0 || !tableLineRe.MatchString(lines[i-1]) {
						issues = append(issues, LintIssue{
							Rule:     "table-no-separator",
							Line:     i + 1 + lineOffset,
							Message:  "table header not followed by separator row (|---|)",
							Severity: "error",
						})
					}
				}
			}
		}
	}
	return issues
}

// ---------------------------------------------------------------------------
// Rule 5: fence-unclosed
// ---------------------------------------------------------------------------

func lintFences(body []byte, lineOffset int) []LintIssue {
	var issues []LintIssue
	lines := strings.Split(string(body), "\n")
	inFence := false
	var fenceMarker string
	fenceStart := 0

	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if !inFence {
			if isOpeningFence(trimmed) {
				inFence = true
				fenceMarker = extractFenceMarker(trimmed)
				fenceStart = i
			}
		} else {
			if isClosingFence(trimmed, fenceMarker) {
				inFence = false
				fenceMarker = ""
			}
		}
	}

	if inFence {
		issues = append(issues, LintIssue{
			Rule:     "fence-unclosed",
			Line:     fenceStart + 1 + lineOffset,
			Message:  "code fence opened but never closed",
			Severity: "error",
		})
	}
	return issues
}

// ---------------------------------------------------------------------------
// Rule 6: fence-mermaid-invalid (heuristic)
// ---------------------------------------------------------------------------

// mermaidKeywords are the diagram type keywords that a valid mermaid block
// should start with.
var mermaidKeywords = []string{
	"graph", "flowchart", "sequencediagram", "classdiagram",
	"statediagram", "erdiagram", "gantt", "pie", "journey",
	"gitgraph", "mindmap", "timeline", "quadrantchart",
	"sankey", "xychart", "block", "packet", "kanban",
	"architecture",
}

func lintMermaid(body []byte, lineOffset int) []LintIssue {
	var issues []LintIssue
	lines := strings.Split(string(body), "\n")
	inFence := false
	var fenceMarker string
	isMermaid := false
	fenceStart := 0
	var blockLines []string

	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if !inFence {
			if isOpeningFence(trimmed) {
				inFence = true
				fenceMarker = extractFenceMarker(trimmed)
				fenceStart = i
				_, lang := FenceInfo(trimmed)
				isMermaid = strings.EqualFold(lang, "mermaid")
				blockLines = nil
			}
		} else {
			if isClosingFence(trimmed, fenceMarker) {
				if isMermaid {
					if issue := checkMermaidBlock(blockLines, fenceStart+1+lineOffset); issue != nil {
						issues = append(issues, *issue)
					}
				}
				inFence = false
				fenceMarker = ""
				isMermaid = false
			} else if isMermaid {
				blockLines = append(blockLines, line)
			}
		}
	}

	return issues
}

func checkMermaidBlock(lines []string, reportLine int) *LintIssue {
	// Find first non-empty, non-comment line.
	var firstLine string
	for _, l := range lines {
		t := strings.TrimSpace(l)
		if t != "" && !strings.HasPrefix(t, "%%") {
			firstLine = t
			break
		}
	}
	if firstLine == "" || len(lines) == 0 {
		return &LintIssue{
			Rule:     "fence-mermaid-invalid",
			Line:     reportLine,
			Message:  "mermaid code block is empty",
			Severity: "error",
		}
	}

	// Check if first non-comment line starts with a known keyword.
	firstLower := strings.ToLower(firstLine)
	// Some keywords are hyphenated: "sequence-diagram" → "sequencediagram".
	firstNormalized := strings.ReplaceAll(firstLower, "-", "")
	firstNormalized = strings.ReplaceAll(firstNormalized, " ", "")

	found := false
	for _, kw := range mermaidKeywords {
		if strings.HasPrefix(firstNormalized, kw) {
			found = true
			break
		}
	}
	if !found {
		return &LintIssue{
			Rule:     "fence-mermaid-invalid",
			Line:     reportLine,
			Message:  "mermaid block does not start with a recognized diagram type keyword",
			Severity: "error",
		}
	}

	return nil
}

// ---------------------------------------------------------------------------
// Rules 7 & 8: heading-duplicate-slug, heading-skip-level
// ---------------------------------------------------------------------------

func lintHeadings(body []byte, doc ast.Node, lineOffset int) []LintIssue {
	var issues []LintIssue

	type headingInfo struct {
		level int
		text  string
		slug  string
		line  int
	}
	var headings []headingInfo

	ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		h, ok := n.(*ast.Heading)
		if !ok {
			return ast.WalkContinue, nil
		}
		var buf strings.Builder
		for c := h.FirstChild(); c != nil; c = c.NextSibling() {
			extractInlineText(&buf, c, body)
		}
		txt := strings.TrimSpace(buf.String())
		if txt == "" {
			return ast.WalkContinue, nil
		}
		line := nodeLineNumber(body, h) + lineOffset
		headings = append(headings, headingInfo{
			level: h.Level,
			text:  txt,
			slug:  Slugify(txt),
			line:  line,
		})
		return ast.WalkContinue, nil
	})

	// Rule 7: duplicate slugs.
	slugSeen := map[string]int{} // slug → first occurrence line
	for _, h := range headings {
		if prev, ok := slugSeen[h.slug]; ok {
			issues = append(issues, LintIssue{
				Rule:     "heading-duplicate-slug",
				Line:     h.line,
				Message:  "heading \"" + h.text + "\" produces the same anchor (#" + h.slug + ") as heading at line " + itoa(prev),
				Severity: "warning",
			})
		} else {
			slugSeen[h.slug] = h.line
		}
	}

	// Rule 8: skipped heading levels.
	for i := 1; i < len(headings); i++ {
		prev := headings[i-1].level
		curr := headings[i].level
		if curr > prev+1 {
			issues = append(issues, LintIssue{
				Rule:     "heading-skip-level",
				Line:     headings[i].line,
				Message:  "heading jumps from h" + itoa(prev) + " to h" + itoa(curr) + " (skips h" + itoa(prev+1) + ")",
				Severity: "warning",
			})
		}
	}

	return issues
}

func extractInlineText(buf *strings.Builder, n ast.Node, source []byte) {
	if t, ok := n.(*ast.Text); ok {
		buf.Write(t.Segment.Value(source))
		return
	}
	for c := n.FirstChild(); c != nil; c = c.NextSibling() {
		extractInlineText(buf, c, source)
	}
}

// ---------------------------------------------------------------------------
// Rule 9: link-image-broken
// ---------------------------------------------------------------------------

// emptyImageRe matches ![alt]() with empty URL.
var emptyImageRe = regexp.MustCompile(`!\[[^\]]*\]\(\s*\)`)

func lintBrokenImages(body []byte, _ ast.Node, lineOffset int) []LintIssue {
	var issues []LintIssue
	lines := strings.Split(string(body), "\n")
	inFence := false
	var fenceMarker string

	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if !inFence {
			if isOpeningFence(trimmed) {
				inFence = true
				fenceMarker = extractFenceMarker(trimmed)
				continue
			}
		} else {
			if isClosingFence(trimmed, fenceMarker) {
				inFence = false
				fenceMarker = ""
			}
			continue
		}

		if emptyImageRe.MatchString(line) {
			issues = append(issues, LintIssue{
				Rule:     "link-image-broken",
				Line:     i + 1 + lineOffset,
				Message:  "image reference with empty URL",
				Severity: "warning",
			})
		}
	}
	return issues
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// nodeLineNumber returns the 1-based line number of a block node in the source.
func nodeLineNumber(src []byte, n ast.Node) int {
	if n.Lines().Len() > 0 {
		seg := n.Lines().At(0)
		return countNewlines(src, seg.Start) + 1
	}
	return 0
}

func itoa(n int) string {
	return strconv.Itoa(n)
}
