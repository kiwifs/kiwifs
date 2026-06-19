// Package links models the [[wiki-link]] graph across the knowledge base.
//
// A "source" is the page that contains the [[...]] syntax; a "target" is the
// raw string inside the brackets (before any |label). The resolver is
// intentionally fuzzy: [[auth]] matches concepts/authentication.md.
//
// We store targets in their raw form and fan out at query time: when the user
// asks for backlinks of concepts/authentication.md we query for any of
// {concepts/authentication.md, concepts/authentication, authentication.md,
// authentication}. That keeps indexing simple (one pass) while still
// supporting Obsidian-style shorthand.
package links

import (
	"context"
	"net/url"
	"regexp"
	"strings"

	"github.com/kiwifs/kiwifs/internal/markdown"
)

// RelationContradicts is the link relation for frontmatter contradicts: fields.
const RelationContradicts = "contradicts"

// RelationSupersedes is the link relation for frontmatter supersedes: fields.
const RelationSupersedes = "supersedes"

// RelationSupersededBy is the link relation for frontmatter superseded_by: fields.
const RelationSupersededBy = "superseded_by"

// validTypedFieldNameRe limits typed-link field names to safe frontmatter keys.
// Values are bound as SQL parameters; this guards config against odd keys.
var validTypedFieldNameRe = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_]*$`)

// ValidTypedFieldName reports whether name is a safe typed-link frontmatter key.
func ValidTypedFieldName(name string) bool {
	return validTypedFieldNameRe.MatchString(name)
}

// SanitizeTypedLinkFields drops invalid configured field names.
func SanitizeTypedLinkFields(fields []string) []string {
	if len(fields) == 0 {
		return fields
	}
	out := make([]string, 0, len(fields))
	for _, field := range fields {
		if ValidTypedFieldName(field) {
			out = append(out, field)
		}
	}
	return out
}

// Link is one indexed outbound reference from a source page.
type Link struct {
	Target   string
	Relation string // empty for [[wiki-links]]
}

// Entry is a single backlink row: one source page that links to the target.
type Entry struct {
	Path     string `json:"path"`
	Count    int    `json:"count"`
	Relation string `json:"relation,omitempty"`
}

// Edge is a raw (source, target) pair as it appears in the wiki-link index.
// Target is the string inside [[...]] — unresolved — so callers can apply
// their own path-resolution rules (exact/stem/prefix).
type Edge struct {
	Source   string `json:"source"`
	Target   string `json:"target"`
	Relation string `json:"relation,omitempty"`
}

// Linker manages the reverse index of wiki links. Engines that don't support
// this (grep) return a nil Linker; API handlers check for nil and return a
// 503-equivalent JSON response.
//
// Every method takes context.Context as the first parameter so SQL-backed
// implementations can forward cancellation to the database driver.
type Linker interface {
	// IndexLinks replaces all links emitted by `source`. Call on every write.
	IndexLinks(ctx context.Context, source string, targets []string) error
	// RemoveLinks drops all link rows for `source`. Call on delete.
	RemoveLinks(ctx context.Context, source string) error
	// Backlinks returns all sources that reference `target` in any of the
	// common fuzzy forms (see package docs).
	Backlinks(ctx context.Context, target string) ([]Entry, error)
	// AllEdges returns every (source, target) pair currently indexed. Used by
	// the graph view so clients can build the full link map in one round trip.
	AllEdges(ctx context.Context) ([]Edge, error)
}

// wikiLinkRe matches [[target]] or [[target|label]]. Target may contain any
// character except ] and |.
var wikiLinkRe = regexp.MustCompile(`!?\[\[([^\]|]+)(?:\|[^\]]+)?\]\]`)

// Extract pulls [[target]] entries out of a markdown body. Targets are
// returned verbatim (trimmed of surrounding whitespace) in order of
// appearance, with duplicates preserved so callers can derive a weight if
// they want one. Most callers should de-dupe with Unique().
//
// YAML frontmatter is stripped before extraction — frontmatter fields like
// `contradicts: [[path]]` are metadata indexed separately, not prose links.
//
// Per the CommonMark spec, content inside fenced code blocks, indented
// code blocks, and inline code spans is literal text and is not parsed
// for wikilinks. For example, TOML [[array-of-tables]] inside a code
// fence will not be mistaken for a wikilink.
func Extract(content []byte) []string {
	if len(content) == 0 {
		return nil
	}
	body := stripFrontmatter(content)
	cleaned := stripCodeRegions(body)
	matches := wikiLinkRe.FindAllSubmatch(cleaned, -1)
	if len(matches) == 0 {
		return nil
	}
	out := make([]string, 0, len(matches))
	for _, m := range matches {
		t := strings.TrimSpace(string(m[1]))
		if t == "" {
			continue
		}
		out = append(out, t)
	}
	return out
}

// stripFrontmatter removes YAML frontmatter (--- delimited) from the
// beginning of content. Frontmatter values like contradicts: [[path]]
// are metadata handled by ExtractContradicts, not body wikilinks.
func stripFrontmatter(content []byte) []byte {
	s := string(content)
	if !strings.HasPrefix(s, "---") {
		return content
	}
	rest := s[3:]
	idx := strings.Index(rest, "\n---")
	if idx < 0 {
		return content
	}
	after := rest[idx+4:]
	if len(after) > 0 && after[0] == '\n' {
		after = after[1:]
	}
	return []byte(after)
}

// openFenceRe matches the opening of a fenced code block per CommonMark
// §4.5: up to 3 spaces of indentation followed by 3+ backticks or tildes,
// then an optional info string. Applied to the RAW line (not trimmed) so
// the indent constraint is enforced.
var openFenceRe = regexp.MustCompile(`^ {0,3}(` + "`{3,}" + `|~{3,})(.*)$`)

// closeFenceRe matches a closing fence per CommonMark §4.5: up to 3 spaces
// of indentation followed by 3+ backticks or tildes, then only whitespace.
// Closing fences cannot have info strings.
var closeFenceRe = regexp.MustCompile(`^ {0,3}(` + "`{3,}" + `|~{3,})\s*$`)

// stripCodeRegions blanks out content inside fenced code blocks (``` / ~~~),
// indented code blocks (4+ spaces / tab), and inline code spans so the
// wikilink regex does not match literal text inside code. This follows
// CommonMark §4.4 (indented code blocks), §4.5 (fenced code blocks),
// and §6.1 (code spans).
func stripCodeRegions(content []byte) []byte {
	s := string(content)
	lines := strings.Split(s, "\n")
	inFence := false
	inIndented := false
	var fenceChar byte
	var fenceRunLen int
	// Per CommonMark §4.4, an indented code block cannot interrupt a
	// paragraph — a blank line must precede it. We track whether the
	// previous line was blank (or a block-level boundary like a fence)
	// to decide if a 4-space-indented line starts a new indented code
	// block, vs. a hanging indent / list continuation with real wikilinks.
	prevBlank := true

	for i, line := range lines {
		if inFence {
			if isClosingCodeFence(line, fenceChar, fenceRunLen) {
				inFence = false
				prevBlank = true
			}
			lines[i] = ""
			continue
		}
		if inIndented {
			if hasIndentedCodePrefix(line) {
				lines[i] = ""
				continue
			}
			if strings.TrimSpace(line) == "" {
				continue
			}
			inIndented = false
		}

		m := openFenceRe.FindStringSubmatch(line)
		if m != nil {
			marker := m[1]
			info := m[2]
			ch := marker[0]
			runLen := len(marker)
			if ch == '`' && strings.ContainsRune(info, '`') {
				lines[i] = stripInlineCodeSpans(line)
				prevBlank = false
				continue
			}
			inFence = true
			fenceChar = ch
			fenceRunLen = runLen
			lines[i] = ""
			prevBlank = true
			continue
		}
		if prevBlank && hasIndentedCodePrefix(line) {
			inIndented = true
			lines[i] = ""
			continue
		}
		prevBlank = strings.TrimSpace(line) == ""
		if !prevBlank {
			lines[i] = stripInlineCodeSpans(line)
		}
	}
	return []byte(strings.Join(lines, "\n"))
}

// hasIndentedCodePrefix returns true if the line starts with 4+ spaces or a
// tab. The caller is responsible for checking the CommonMark §4.4 context
// rule (must follow a blank line or another indented code line).
func hasIndentedCodePrefix(line string) bool {
	if len(line) == 0 {
		return false
	}
	if line[0] == '\t' {
		return true
	}
	if len(line) >= 4 && line[0] == ' ' && line[1] == ' ' && line[2] == ' ' && line[3] == ' ' {
		return true
	}
	return false
}

// isClosingCodeFence checks whether a raw line is a valid closing fence
// for the given opening fence character and minimum run length.
// Per CommonMark §4.5: 0-3 spaces indent, same char, at least as many
// repetitions as the opening, followed only by whitespace.
func isClosingCodeFence(line string, fenceChar byte, minRunLen int) bool {
	m := closeFenceRe.FindStringSubmatch(line)
	if m == nil {
		return false
	}
	marker := m[1]
	return marker[0] == fenceChar && len(marker) >= minRunLen
}

// stripInlineCodeSpans replaces content inside backtick code spans with
// spaces. Handles arbitrary backtick-string lengths per CommonMark §6.1.
func stripInlineCodeSpans(line string) string {
	result := []byte(line)
	i := 0
	for i < len(result) {
		if result[i] != '`' {
			i++
			continue
		}
		openStart := i
		openLen := 0
		for i < len(result) && result[i] == '`' {
			openLen++
			i++
		}
		closeIdx := findClosingBackticks(result[i:], openLen)
		if closeIdx < 0 {
			i = openStart + openLen
			continue
		}
		spanEnd := i + closeIdx + openLen
		for j := openStart; j < spanEnd && j < len(result); j++ {
			result[j] = ' '
		}
		i = spanEnd
	}
	return string(result)
}

// findClosingBackticks scans data for a backtick string of exactly n
// backticks (not preceded or followed by a backtick). Returns the byte
// offset of the first backtick of the closing string, or -1 if not found.
func findClosingBackticks(data []byte, n int) int {
	i := 0
	for i < len(data) {
		if data[i] != '`' {
			i++
			continue
		}
		start := i
		runLen := 0
		for i < len(data) && data[i] == '`' {
			runLen++
			i++
		}
		if runLen == n {
			return start
		}
	}
	return -1
}

// DefaultTypedLinkFields is used when [links] typed_fields is unset in config.
func DefaultTypedLinkFields() []string {
	return []string{RelationContradicts, RelationSupersedes, RelationSupersededBy}
}

// ExtractForIndex returns wiki links from the body plus configured typed
// frontmatter fields.
func ExtractForIndex(content []byte, typedFields []string) []Link {
	if len(typedFields) == 0 {
		typedFields = DefaultTypedLinkFields()
	}
	var out []Link
	for _, t := range Unique(Extract(content)) {
		out = append(out, Link{Target: t})
	}
	fm, _ := markdown.Frontmatter(content)
	out = append(out, ExtractTypedFields(fm, typedFields)...)
	return UniqueLinks(out)
}

// ExtractTypedFields reads wiki-link values from the listed frontmatter fields.
func ExtractTypedFields(fm map[string]any, fields []string) []Link {
	if fm == nil || len(fields) == 0 {
		return nil
	}
	var out []Link
	for _, field := range fields {
		if !ValidTypedFieldName(field) {
			continue
		}
		for _, t := range ExtractTypedField(fm, field) {
			out = append(out, Link{Target: t, Relation: field})
		}
	}
	return out
}

// ExtractTypedField reads one frontmatter field (string or sequence).
// Values may be plain paths or [[wiki-link]] syntax; leading slashes are stripped.
// Nested arrays are flattened so that YAML values like `[[target]]` (parsed as
// a nested sequence) are handled the same as `[target]`.
func ExtractTypedField(fm map[string]any, field string) []string {
	if fm == nil || field == "" {
		return nil
	}
	raw, ok := fm[field]
	if !ok || raw == nil {
		return nil
	}
	var paths []string
	collectStrings(raw, &paths)
	return paths
}

// collectStrings recursively extracts string leaves from arbitrarily nested
// slices, normalising each via normalizeTypedLinkTarget. This handles the
// common YAML pitfall where [[wiki-link]] is parsed as a nested array.
func collectStrings(v any, out *[]string) {
	switch val := v.(type) {
	case string:
		if t := normalizeTypedLinkTarget(val); t != "" {
			*out = append(*out, t)
		}
	case []any:
		for _, item := range val {
			collectStrings(item, out)
		}
	case []string:
		for _, s := range val {
			if t := normalizeTypedLinkTarget(s); t != "" {
				*out = append(*out, t)
			}
		}
	}
}

// ExtractContradicts reads the contradicts frontmatter field.
func ExtractContradicts(fm map[string]any) []string {
	return ExtractTypedField(fm, RelationContradicts)
}

func normalizeTypedLinkTarget(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "[[") && strings.HasSuffix(s, "]]") {
		inner := strings.TrimSuffix(strings.TrimPrefix(s, "[["), "]]")
		if i := strings.Index(inner, "|"); i >= 0 {
			inner = inner[:i]
		}
		s = strings.TrimSpace(inner)
	}
	s = strings.TrimPrefix(s, "/")
	return s
}

// UniqueLinks de-dupes links by (target, relation) case-insensitively on target.
func UniqueLinks(linkList []Link) []Link {
	seen := make(map[string]struct{}, len(linkList))
	out := make([]Link, 0, len(linkList))
	for _, l := range linkList {
		k := strings.ToLower(l.Target) + "\x00" + l.Relation
		if _, ok := seen[k]; ok {
			continue
		}
		seen[k] = struct{}{}
		out = append(out, l)
	}
	return out
}

// Unique de-dupes a slice of targets case-insensitively while preserving order.
func Unique(targets []string) []string {
	seen := make(map[string]struct{}, len(targets))
	out := make([]string, 0, len(targets))
	for _, t := range targets {
		k := strings.ToLower(t)
		if _, ok := seen[k]; ok {
			continue
		}
		seen[k] = struct{}{}
		out = append(out, t)
	}
	return out
}

// wikiLinkFullRe captures the full match including optional label for replacement.
var wikiLinkFullRe = regexp.MustCompile(`\[\[([^\]|]+)(?:\|([^\]]+))?\]\]`)

// ResolveWikiLinksToMarkdown rewrites [[target|label]] wiki links in content
// to standard markdown links using permalinks: [label](publicURL/page/path).
// The resolver function maps a raw wiki-link target to its resolved file path,
// returning "" if no match is found. Unresolved links are left as-is.
func ResolveWikiLinksToMarkdown(content, publicURL string, resolver func(target string) string) string {
	if publicURL == "" {
		return content
	}
	return wikiLinkFullRe.ReplaceAllStringFunc(content, func(match string) string {
		sub := wikiLinkFullRe.FindStringSubmatch(match)
		if len(sub) < 2 {
			return match
		}
		target := strings.TrimSpace(sub[1])
		label := target
		if len(sub) >= 3 && sub[2] != "" {
			label = strings.TrimSpace(sub[2])
		}
		resolved := resolver(target)
		if resolved == "" {
			return match
		}
		segments := strings.Split(resolved, "/")
		for i, s := range segments {
			segments[i] = url.PathEscape(s)
		}
		encodedPath := strings.Join(segments, "/")
		return "[" + label + "](" + publicURL + "/page/" + encodedPath + ")"
	})
}

// TargetForms expands a file path into every syntactic form that could
// appear inside [[...]] to refer to it. The result is suitable for a
// `target IN (…)` query.
//
//	concepts/authentication.md → [
//	  concepts/authentication.md
//	  concepts/authentication
//	  authentication.md
//	  authentication
//	]
func TargetForms(path string) []string {
	p := strings.TrimPrefix(path, "/")
	if p == "" {
		return nil
	}
	forms := []string{p}
	stemPath := strings.TrimSuffix(p, ".md")
	if stemPath != p {
		forms = append(forms, stemPath)
	}
	base := p
	if i := strings.LastIndex(p, "/"); i >= 0 {
		base = p[i+1:]
	}
	if base != p {
		forms = append(forms, base)
		stem := strings.TrimSuffix(base, ".md")
		if stem != base {
			forms = append(forms, stem)
		}
	}
	return forms
}
