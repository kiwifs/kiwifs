package markdown

import (
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// CommonMark generic directives (https://talk.commonmark.org/t/generic-directives-plugins-syntax/444)
// are the syntax the web UI already parses via remark-directive. goldmark has
// no equivalent, so this file teaches the server the two forms KiwiFS uses:
//
//	:::claim{evidence=inferred confidence=0.6}
//	Body prose, parsed as normal markdown blocks.
//	:::
//
//	Inline: :claim[the assertion]{evidence=stated confidence=0.9}
//
// The point of parsing rather than pattern-matching the raw text is that a
// directive written inside a code fence is *not* a directive, and only a real
// block parser gets that right. `ExtractClaims` depends on it.
//
// The directive spec's leaf form (`::name[label]{attrs}` on its own line) is
// deliberately not implemented — nothing in KiwiFS uses it, and an unsupported
// form falls through to being plain text rather than being silently misread.

// KindContainerDirective is the AST kind for a ::: fenced directive.
var KindContainerDirective = ast.NewNodeKind("KiwiContainerDirective")

// KindTextDirective is the AST kind for an inline :name[label]{attrs}.
var KindTextDirective = ast.NewNodeKind("KiwiTextDirective")

// ContainerDirective is a `:::name{attrs}` block whose children are parsed as
// ordinary markdown.
// Attrs, not Attributes: ast.Node already declares an Attributes() method,
// and a field of that name silently stops the type satisfying ast.Node.
type ContainerDirective struct {
	ast.BaseBlock
	Name  string
	Attrs map[string]string
	// Offset is the byte offset of the opening `:::` in the source. The node's
	// own Lines() is empty because the children own the body lines, so the
	// position has to be captured while the opening line is still in hand.
	Offset int
}

func (n *ContainerDirective) Kind() ast.NodeKind { return KindContainerDirective }

func (n *ContainerDirective) Dump(source []byte, level int) {
	ast.DumpHelper(n, source, level, map[string]string{"Name": n.Name}, nil)
}

// TextDirective is an inline `:name[label]{attrs}`.
type TextDirective struct {
	ast.BaseInline
	Name  string
	Label string
	Attrs map[string]string
	// Offset is the byte offset of the leading `:` in the source. Inline nodes
	// have no Lines() at all — calling it panics — so this is the only way
	// back to a source position.
	Offset int
}

func (n *TextDirective) Kind() ast.NodeKind { return KindTextDirective }

func (n *TextDirective) Dump(source []byte, level int) {
	ast.DumpHelper(n, source, level, map[string]string{"Name": n.Name, "Label": n.Label}, nil)
}

// --- block parser ---

type containerDirectiveParser struct{}

// containerDirectiveParserPriority sits just above the fenced-code parser so
// a `:::` line is claimed before the paragraph parser can swallow it, and
// below nothing that would let it steal a line from a code fence — an open
// fence never consults other block parsers at all.
const containerDirectiveParserPriority = 799

func (p *containerDirectiveParser) Trigger() []byte { return []byte{':'} }

func (p *containerDirectiveParser) Open(_ ast.Node, reader text.Reader, _ parser.Context) (ast.Node, parser.State) {
	line, segment := reader.PeekLine()
	pos := pos1stNonSpace(line)
	// An indented line is a code block, not a directive.
	if pos >= 4 {
		return nil, parser.NoChildren
	}
	rest := line[pos:]
	marker := countLeading(rest, ':')
	if marker < 3 {
		return nil, parser.NoChildren
	}
	name, attrs, ok := parseDirectiveHead(rest[marker:])
	if !ok || name == "" {
		return nil, parser.NoChildren
	}
	start := segment.Start + pos
	reader.Advance(segment.Len() - 1)
	return &ContainerDirective{Name: name, Attrs: attrs, Offset: start}, parser.HasChildren
}

func (p *containerDirectiveParser) Continue(_ ast.Node, reader text.Reader, _ parser.Context) parser.State {
	line, segment := reader.PeekLine()
	pos := pos1stNonSpace(line)
	if pos < 4 && pos < len(line) {
		rest := strings.TrimRight(string(line[pos:]), " \t\r\n")
		if len(rest) >= 3 && strings.Trim(rest, ":") == "" {
			reader.Advance(segment.Len() - 1)
			return parser.Close
		}
	}
	return parser.Continue | parser.HasChildren
}

func (p *containerDirectiveParser) Close(_ ast.Node, _ text.Reader, _ parser.Context) {}

// CanInterruptParagraph lets `:::claim` directly follow a line of prose, which
// is how people actually write.
func (p *containerDirectiveParser) CanInterruptParagraph() bool { return true }

func (p *containerDirectiveParser) CanAcceptIndentedLine() bool { return false }

// --- inline parser ---

type textDirectiveParser struct{}

const textDirectiveParserPriority = 199

func (p *textDirectiveParser) Trigger() []byte { return []byte{':'} }

func (p *textDirectiveParser) Parse(_ ast.Node, block text.Reader, _ parser.Context) ast.Node {
	line, lineSeg := block.PeekLine()
	if len(line) < 2 || line[0] != ':' {
		return nil
	}
	// `::` and `:::` are the leaf and container forms; neither is ours, and
	// consuming them here would corrupt a container's opening line.
	if line[1] == ':' {
		return nil
	}

	i := 1
	nameStart := i
	for i < len(line) && isDirectiveNameByte(line[i]) {
		i++
	}
	name := string(line[nameStart:i])
	if name == "" {
		return nil
	}

	// A text directive without a label is indistinguishable from ordinary
	// prose containing a colon ("note: something"), so the label is required.
	if i >= len(line) || line[i] != '[' {
		return nil
	}
	label, next, ok := scanBracketed(line, i, '[', ']')
	if !ok {
		return nil
	}
	i = next

	attrs := map[string]string{}
	if i < len(line) && line[i] == '{' {
		raw, next, ok := scanBracketed(line, i, '{', '}')
		if !ok {
			return nil
		}
		attrs = parseDirectiveAttributes(raw)
		i = next
	}

	start := lineSeg.Start
	block.Advance(i)
	node := &TextDirective{Name: name, Label: label, Attrs: attrs, Offset: start}
	// The label renders as its literal text. Parsing it as inline markdown
	// would be closer to remark, but a claim's label is an assertion, not a
	// place for nested emphasis, and keeping it flat keeps the indexed text
	// identical to what a reader sees.
	node.AppendChild(node, ast.NewString([]byte(label)))
	return node
}

// --- shared scanning ---

func parseDirectiveHead(rest []byte) (name string, attrs map[string]string, ok bool) {
	s := strings.TrimRight(string(rest), " \t\r\n")
	i := 0
	for i < len(s) && isDirectiveNameByte(s[i]) {
		i++
	}
	name = s[:i]
	if name == "" {
		return "", nil, false
	}
	attrs = map[string]string{}
	remainder := strings.TrimSpace(s[i:])
	if remainder == "" {
		return name, attrs, true
	}
	if !strings.HasPrefix(remainder, "{") || !strings.HasSuffix(remainder, "}") {
		return "", nil, false
	}
	return name, parseDirectiveAttributes(remainder[1 : len(remainder)-1]), true
}

// parseDirectiveAttributes reads `key=value key="quoted value" bare` into a
// map. A bare key maps to "" — the directive spec's `.class`/`#id` shorthands
// are skipped rather than guessed at, since no KiwiFS directive uses them.
func parseDirectiveAttributes(s string) map[string]string {
	attrs := map[string]string{}
	i := 0
	for i < len(s) {
		for i < len(s) && isSpaceByte(s[i]) {
			i++
		}
		if i >= len(s) {
			break
		}
		if s[i] == '.' || s[i] == '#' {
			for i < len(s) && !isSpaceByte(s[i]) {
				i++
			}
			continue
		}
		keyStart := i
		for i < len(s) && !isSpaceByte(s[i]) && s[i] != '=' {
			i++
		}
		key := s[keyStart:i]
		if key == "" {
			i++
			continue
		}
		if i >= len(s) || s[i] != '=' {
			attrs[key] = ""
			continue
		}
		i++ // consume '='
		if i < len(s) && (s[i] == '"' || s[i] == '\'') {
			quote := s[i]
			i++
			valStart := i
			for i < len(s) && s[i] != quote {
				i++
			}
			attrs[key] = s[valStart:i]
			if i < len(s) {
				i++ // consume the closing quote
			}
			continue
		}
		valStart := i
		for i < len(s) && !isSpaceByte(s[i]) {
			i++
		}
		attrs[key] = s[valStart:i]
	}
	return attrs
}

// scanBracketed reads a balanced [..] or {..} run starting at start, returning
// the inner text and the index just past the closing bracket.
func scanBracketed(line []byte, start int, open, close byte) (string, int, bool) {
	if start >= len(line) || line[start] != open {
		return "", start, false
	}
	depth := 0
	for i := start; i < len(line); i++ {
		switch line[i] {
		case open:
			depth++
		case close:
			depth--
			if depth == 0 {
				return string(line[start+1 : i]), i + 1, true
			}
		case '\n':
			return "", start, false
		}
	}
	return "", start, false
}

func isDirectiveNameByte(b byte) bool {
	return b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= '0' && b <= '9' || b == '-' || b == '_'
}

func isSpaceByte(b byte) bool { return b == ' ' || b == '\t' }

func countLeading(b []byte, c byte) int {
	n := 0
	for n < len(b) && b[n] == c {
		n++
	}
	return n
}

func pos1stNonSpace(line []byte) int {
	for i, b := range line {
		if b != ' ' && b != '\t' {
			return i
		}
	}
	return len(line)
}

// --- extension wiring ---

type directivesExtension struct{}

// Directives is the goldmark extension adding container and text directives.
var Directives goldmark.Extender = &directivesExtension{}

func (e *directivesExtension) Extend(m goldmark.Markdown) {
	m.Parser().AddOptions(
		parser.WithBlockParsers(util.Prioritized(&containerDirectiveParser{}, containerDirectiveParserPriority)),
		parser.WithInlineParsers(util.Prioritized(&textDirectiveParser{}, textDirectiveParserPriority)),
	)
}
