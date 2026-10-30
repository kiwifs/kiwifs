package refactor

import (
	"net/url"
	"regexp"
	"sort"
	"strings"
	"unicode"

	"github.com/kiwifs/kiwifs/internal/markdown"
)

// linkKind says which syntax a reference was written in. The kind decides
// how the target resolves and how a replacement is spelled.
type linkKind int

const (
	kindWiki     linkKind = iota // [[target|label]], ![[embed]]
	kindMarkdown                 // [label](target.md), ![alt](image.png)
	kindAppSrc                   // ```kiwi-app src=apps/a.html: a literal path, never percent-encoded
)

// linkRef is one reference found in a page. Start and End bound only the
// path bytes, so a rewrite never touches the label, the #anchor, the
// separator (| or \|), or the surrounding brackets.
type linkRef struct {
	Kind  linkKind
	Start int
	End   int
	// Path is the raw path bytes, content[Start:End], except for kindAppSrc,
	// whose Start and End also take in the quotes (see Quote) so a rewrite
	// can add or change them.
	Path  string
	Quote byte
	Line  int // 1-based, for reports
	// Frag is the #fragment after the path (without "#"), and FragEnd the
	// offset just past it; FragEnd == End when there is none.
	Frag    string
	FragEnd int
	// Typed marks a reference held in a typed-link frontmatter field.
	Typed bool
	// Unsplicable marks a typed reference whose YAML spelling (a block or
	// escaped scalar) cannot be rewritten byte for byte; Start and End are -1.
	Unsplicable bool
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

	if fmEnd := frontmatterEnd(content); fmEnd > 0 {
		blank(0, fmEnd)
	}
	walkLines(content, func(start, end int, role lineRole) {
		if role == lineText {
			maskInlineCode(out[start:end])
		} else {
			blank(start, end)
		}
	})
	return out
}

type lineRole int

const (
	lineText      lineRole = iota
	lineFenceOpen          // the opening line of a fence
	lineFenced             // inside a fence, its closing line included
)

// walkLines visits every line after the frontmatter with its bounds and
// where it sits relative to fences.
func walkLines(content []byte, visit func(start, end int, role lineRole)) {
	var fenceChar byte
	fenceLen := 0
	inFence := false
	for pos := frontmatterEnd(content); pos < len(content); {
		end := pos
		for end < len(content) && content[end] != '\n' {
			end++
		}
		trimmed := strings.TrimLeft(string(content[pos:end]), " \t")
		run := fenceRun(trimmed)
		switch {
		case inFence:
			visit(pos, end, lineFenced)
			if run > 0 && trimmed[0] == fenceChar && run >= fenceLen && strings.TrimSpace(trimmed[run:]) == "" {
				inFence = false
			}
		case run > 0 && !(trimmed[0] == '`' && strings.ContainsRune(trimmed[run:], '`')):
			inFence, fenceChar, fenceLen = true, trimmed[0], run
			visit(pos, end, lineFenceOpen)
		default:
			visit(pos, end, lineText)
		}
		pos = end + 1
	}
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

// scanAll returns the references in the body (scanLinks) and in the
// typed-link frontmatter fields, in document order.
func scanAll(content []byte, typedFields []string) []linkRef {
	refs := scanTypedLinks(content, typedFields)
	if len(refs) == 0 {
		return scanLinks(content)
	}
	lineAt := newLineIndex(content)
	for i := range refs {
		if !refs[i].Unsplicable {
			refs[i].Line = lineAt(refs[i].Start)
		}
	}
	refs = append(refs, scanLinks(content)...)
	sort.SliceStable(refs, func(i, j int) bool {
		return refs[i].Line < refs[j].Line || refs[i].Line == refs[j].Line && refs[i].Start < refs[j].Start
	})
	return refs
}

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
		frag, hasFrag := "", false
		if h := strings.IndexByte(target, '#'); h >= 0 {
			frag, hasFrag = target[h+1:], true
			target = target[:h]
		}
		lead := len(target) - len(strings.TrimLeft(target, " \t"))
		page := strings.TrimSpace(target)
		if page == "" {
			continue
		}
		start := innerStart + lead
		ref := linkRef{Kind: kindWiki, Start: start, End: start + len(page), Path: page}
		ref.FragEnd = ref.End
		if hasFrag {
			ref.Frag = strings.TrimSpace(frag)
			ref.FragEnd = innerStart + targetEnd
		}
		refs = append(refs, ref)
	}

	for _, m := range markdownRe.FindAllSubmatchIndex(masked, -1) {
		hrefStart, hrefEnd := m[2], m[3]
		href := string(masked[hrefStart:hrefEnd])
		if href == "" || href[0] == '#' || schemeRe.MatchString(href) || strings.HasPrefix(href, "//") ||
			strings.HasPrefix(href, "/s/") || strings.HasPrefix(href, "/api/") || strings.HasPrefix(href, "/raw/") {
			continue
		}
		page := href
		ref := linkRef{Kind: kindMarkdown, Start: hrefStart}
		if i := strings.IndexAny(page, "#?"); i >= 0 {
			if page[i] == '#' {
				ref.Frag = decodeHref(page[i+1:])
				ref.FragEnd = hrefEnd
			}
			page = page[:i]
		}
		if page == "" {
			continue
		}
		ref.End, ref.Path = hrefStart+len(page), page
		if ref.FragEnd == 0 {
			ref.FragEnd = ref.End
		}
		refs = append(refs, ref)
	}

	refs = append(refs, scanAppSrc(content)...)

	sortRefs(refs)
	lineAt := newLineIndex(content)
	for i := range refs {
		refs[i].Line = lineAt(refs[i].Start)
	}
	return refs
}

// scanAppSrc finds the src= file on each ```kiwi-app opening line, reading
// the meta the way the UI does. maskCode blanks fence lines, so it scans the
// original content.
func scanAppSrc(content []byte) []linkRef {
	var refs []linkRef
	walkLines(content, func(start, end int, role lineRole) {
		if role != lineFenceOpen {
			return
		}
		line := strings.TrimRightFunc(string(content[start:end]), unicode.IsSpace)
		lang, meta := markdown.SplitFenceInfo(strings.TrimLeft(line, " \t"))
		if lang != "kiwi-app" {
			return
		}
		v, ok := markdown.FenceMetaValue(meta, "src")
		if !ok || v.Value == "" || v.Value[0] == '#' || schemeRe.MatchString(v.Value) || strings.HasPrefix(v.Value, "//") {
			return
		}
		at := start + len(line) - len(meta)
		refs = append(refs, linkRef{Kind: kindAppSrc, Start: at + v.Start, End: at + v.End, FragEnd: at + v.End, Path: v.Value, Quote: v.Quote})
	})
	return refs
}

// quoteAppSrc spells a src= value: in its original quote while that still
// fits, bare when nothing in it needs quoting, else in a quote it lacks.
func quoteAppSrc(p string, quote byte) (string, bool) {
	if quote != 0 && strings.IndexByte(p, quote) < 0 {
		return string(quote) + p + string(quote), true
	}
	if quote == 0 && !strings.ContainsAny(p, `"'`) && strings.IndexFunc(p, unicode.IsSpace) < 0 {
		return p, true
	}
	for _, q := range []string{`"`, `'`} {
		if !strings.Contains(p, q) {
			return q + p + q, true
		}
	}
	return p, false
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
