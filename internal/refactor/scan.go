package refactor

import (
	"net/url"
	"regexp"
	"sort"
	"strings"
)

// linkKind says which syntax a reference was written in. The kind decides
// how the target resolves and how a replacement is spelled.
type linkKind int

const (
	kindWiki     linkKind = iota // [[target|label]], ![[embed]]
	kindMarkdown                 // [label](target.md), ![alt](image.png)
)

// linkRef is one reference found in a page. Start and End bound only the
// path bytes, so a rewrite never touches the label, the #anchor, the
// separator (| or \|), or the surrounding brackets.
type linkRef struct {
	Kind  linkKind
	Start int
	End   int
	Path  string // the raw path bytes, content[Start:End]
	Line  int    // 1-based, for reports
}

// maskCode returns a copy of content in which YAML frontmatter, fenced code
// blocks and inline code spans are replaced by spaces (newlines kept), so
// byte offsets in the copy are offsets in the original. References inside
// masked regions are literal text and are never rewritten.
//
// Fences are recognised at any indentation, which masks a little more than
// CommonMark would (a fence inside a list item) and never less.
func maskCode(content []byte) []byte {
	out := make([]byte, len(content))
	copy(out, content)
	blank := func(from, to int) {
		for i := from; i < to && i < len(out); i++ {
			if out[i] != '\n' {
				out[i] = ' '
			}
		}
	}

	pos := 0
	if fmEnd := frontmatterEnd(content); fmEnd > 0 {
		blank(0, fmEnd)
		pos = fmEnd
	}

	var fenceChar byte
	fenceLen := 0
	inFence := false
	for pos < len(content) {
		end := pos
		for end < len(content) && content[end] != '\n' {
			end++
		}
		line := string(content[pos:end])
		trimmed := strings.TrimLeft(line, " \t")
		if inFence {
			blank(pos, end)
			if run := fenceRun(trimmed); run > 0 && trimmed[0] == fenceChar && run >= fenceLen &&
				strings.TrimSpace(trimmed[run:]) == "" {
				inFence = false
			}
		} else if run := fenceRun(trimmed); run > 0 && !(trimmed[0] == '`' && strings.ContainsRune(trimmed[run:], '`')) {
			inFence = true
			fenceChar = trimmed[0]
			fenceLen = run
			blank(pos, end)
		} else {
			maskInlineCode(out[pos:end])
		}
		pos = end + 1
	}
	return out
}

// frontmatterEnd returns the offset just past a leading --- ... --- block,
// or 0 when the page has none.
func frontmatterEnd(content []byte) int {
	s := string(content)
	if !strings.HasPrefix(s, "---\n") && !strings.HasPrefix(s, "---\r\n") {
		return 0
	}
	idx := strings.Index(s[3:], "\n---")
	if idx < 0 {
		return 0
	}
	end := 3 + idx + len("\n---")
	for end < len(s) && s[end] != '\n' {
		end++
	}
	return end
}

// fenceRun returns the length of a leading run of 3+ backticks or tildes.
func fenceRun(s string) int {
	if len(s) < 3 || (s[0] != '`' && s[0] != '~') {
		return 0
	}
	n := 0
	for n < len(s) && s[n] == s[0] {
		n++
	}
	if n < 3 {
		return 0
	}
	return n
}

// maskInlineCode blanks backtick code spans in one line, in place.
func maskInlineCode(line []byte) {
	i := 0
	for i < len(line) {
		if line[i] != '`' {
			i++
			continue
		}
		open := i
		for i < len(line) && line[i] == '`' {
			i++
		}
		n := i - open
		closeAt := -1
		for j := i; j < len(line); {
			if line[j] != '`' {
				j++
				continue
			}
			k := j
			for k < len(line) && line[k] == '`' {
				k++
			}
			if k-j == n {
				closeAt = k
				break
			}
			j = k
		}
		if closeAt < 0 {
			continue
		}
		for j := open; j < closeAt; j++ {
			line[j] = ' '
		}
		i = closeAt
	}
}

var (
	wikiRe     = regexp.MustCompile(`\[\[([^\]\n]+?)\]\]`)
	markdownRe = regexp.MustCompile(`\]\(([^()\s<>]+)(?:\s+"[^"\n]*")?\)`)
	schemeRe   = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9+.-]*:`)
)

// scanLinks returns every wiki and markdown reference outside code, in
// document order.
func scanLinks(content []byte) []linkRef {
	masked := maskCode(content)
	var refs []linkRef

	for _, m := range wikiRe.FindAllSubmatchIndex(masked, -1) {
		innerStart, innerEnd := m[2], m[3]
		inner := string(masked[innerStart:innerEnd])
		targetEnd := len(inner)
		if sep := strings.IndexByte(inner, '|'); sep >= 0 {
			targetEnd = sep
			// [[target\|label]] is how an aliased link is written inside a
			// table cell; the backslash belongs to the separator.
			if sep > 0 && inner[sep-1] == '\\' {
				targetEnd = sep - 1
			}
		}
		target := inner[:targetEnd]
		if h := strings.IndexByte(target, '#'); h >= 0 {
			target = target[:h]
		}
		lead := len(target) - len(strings.TrimLeft(target, " \t"))
		page := strings.TrimSpace(target)
		if page == "" {
			continue
		}
		start := innerStart + lead
		refs = append(refs, linkRef{Kind: kindWiki, Start: start, End: start + len(page), Path: page})
	}

	for _, m := range markdownRe.FindAllSubmatchIndex(masked, -1) {
		hrefStart, hrefEnd := m[2], m[3]
		href := string(masked[hrefStart:hrefEnd])
		if href == "" || href[0] == '#' || schemeRe.MatchString(href) || strings.HasPrefix(href, "//") ||
			strings.HasPrefix(href, "/s/") || strings.HasPrefix(href, "/api/") || strings.HasPrefix(href, "/raw/") {
			continue
		}
		page := href
		if i := strings.IndexAny(page, "#?"); i >= 0 {
			page = page[:i]
		}
		if page == "" {
			continue
		}
		refs = append(refs, linkRef{Kind: kindMarkdown, Start: hrefStart, End: hrefStart + len(page), Path: page})
	}

	sortRefs(refs)
	lineAt := newLineIndex(content)
	for i := range refs {
		refs[i].Line = lineAt(refs[i].Start)
	}
	return refs
}

func sortRefs(refs []linkRef) {
	sort.Slice(refs, func(i, j int) bool { return refs[i].Start < refs[j].Start })
}

func newLineIndex(content []byte) func(int) int {
	var starts []int
	starts = append(starts, 0)
	for i, b := range content {
		if b == '\n' {
			starts = append(starts, i+1)
		}
	}
	return func(off int) int {
		lo, hi := 0, len(starts)-1
		for lo < hi {
			mid := (lo + hi + 1) / 2
			if starts[mid] <= off {
				lo = mid
			} else {
				hi = mid - 1
			}
		}
		return lo + 1
	}
}

// decodeHref turns a markdown link path into a filesystem path.
func decodeHref(p string) string {
	if u, err := url.PathUnescape(p); err == nil {
		return u
	}
	return p
}

// encodeHref spells a filesystem path as a markdown link path, escaping
// only what a link destination cannot hold unescaped.
func encodeHref(p string) string {
	return (&url.URL{Path: p}).EscapedPath()
}
