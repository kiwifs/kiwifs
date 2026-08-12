package vectorstore

import (
	"context"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/text"
)

const (
	defaultMaxChunkSize = 1500
	defaultMinChunkSize = 200
)

// chunk splits text into overlapping windows of roughly `size` characters
// each, preferring paragraph boundaries. Overlap is the number of trailing
// chars from the previous chunk to prepend to the next — keeps context across
// splits so an embedding of the boundary doesn't lose the surrounding
// sentence.
//
// Deliberately simple: paragraph-aware char slicing, not a tokenizer. For the
// target use case (markdown notes, mostly <5KB each), that's enough.
func chunk(text string, size, overlap int) []string {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil
	}
	if len(text) <= size {
		return []string{text}
	}

	paragraphs := splitParagraphs(text)
	out := make([]string, 0)
	var buf strings.Builder
	for _, p := range paragraphs {
		// Paragraph alone is larger than size → fall back to window split.
		if len(p) > size {
			if buf.Len() > 0 {
				out = append(out, buf.String())
				buf.Reset()
			}
			out = append(out, slidingWindow(p, size, overlap)...)
			continue
		}
		if buf.Len()+len(p)+2 > size && buf.Len() > 0 {
			out = append(out, buf.String())
			// Tail of previous chunk as overlap context for the next.
			tail := ""
			if overlap > 0 && buf.Len() > overlap {
				prev := buf.String()
				tail = prev[len(prev)-overlap:]
			}
			buf.Reset()
			if tail != "" {
				buf.WriteString(tail)
				buf.WriteString("\n\n")
			}
		}
		if buf.Len() > 0 {
			buf.WriteString("\n\n")
		}
		buf.WriteString(p)
	}
	if buf.Len() > 0 {
		out = append(out, buf.String())
	}
	return out
}

func splitParagraphs(text string) []string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	raw := strings.Split(text, "\n\n")
	out := make([]string, 0, len(raw))
	for _, p := range raw {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func slidingWindow(text string, size, overlap int) []string {
	if size <= 0 {
		return []string{text}
	}
	step := size - overlap
	if step <= 0 {
		step = size
	}
	runes := []rune(text)
	out := make([]string, 0)
	for start := 0; start < len(runes); start += step {
		end := start + size
		if end > len(runes) {
			end = len(runes)
		}
		out = append(out, strings.TrimSpace(string(runes[start:end])))
		if end == len(runes) {
			break
		}
	}
	return out
}

type headingSection struct {
	level    int
	heading  string
	body     strings.Builder
	ancestry []string // parent heading hierarchy
}

// docContext carries the document-level facts a context template renders
// against, plus the compiled builder. A nil *docContext means "default
// template, no page metadata" — exactly the shape chunkMarkdown had before
// context enrichment landed.
type docContext struct {
	ctx         context.Context
	path        string
	title       string
	frontmatter map[string]any
	builder     *contextBuilder
}

// prefix builds the context string prepended to one section's body.
func (d *docContext) prefix(ancestry []string, body string) string {
	parts := headingParts(ancestry)
	cc := ChunkContext{
		HeadingPath: parts,
		Headings:    strings.Join(parts, " > "),
	}
	builder := defaultContextBuilder
	var ctx context.Context
	if d != nil {
		cc.Path = d.path
		cc.Title = d.title
		cc.Frontmatter = d.frontmatter
		if d.builder != nil {
			builder = d.builder
		}
		ctx = d.ctx
	}
	return builder.prefix(ctx, cc, body)
}

// chunkMarkdown splits markdown text on headings (level ≤ 3), prefixing each
// chunk with its heading hierarchy for embedding context. Falls back to the
// paragraph-aware chunk() for sections that exceed maxSize.
func chunkMarkdown(content string, maxSize, minSize int) []string {
	return chunkMarkdownWithContext(content, maxSize, minSize, nil)
}

// chunkMarkdownWithContext is chunkMarkdown with page metadata available to
// the configured context template.
func chunkMarkdownWithContext(content string, maxSize, minSize int, dc *docContext) []string {
	if maxSize <= 0 {
		maxSize = defaultMaxChunkSize
	}
	if minSize <= 0 {
		minSize = defaultMinChunkSize
	}

	src := []byte(content)
	md := goldmark.New()
	reader := text.NewReader(src)
	doc := md.Parser().Parse(reader)

	var sections []headingSection
	var current *headingSection
	ancestry := make([]string, 0, 4) // heading[0]=h1, heading[1]=h2, etc.

	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}

		if h, ok := n.(*ast.Heading); ok && h.Level <= 3 {
			if current != nil {
				sections = append(sections, *current)
			}

			headingText := string(n.Text(src))

			// Update ancestry: trim to this level, then set
			if h.Level <= len(ancestry) {
				ancestry = ancestry[:h.Level-1]
			}
			for len(ancestry) < h.Level-1 {
				ancestry = append(ancestry, "")
			}
			ancestry = append(ancestry, headingText)

			ancCopy := make([]string, len(ancestry))
			copy(ancCopy, ancestry)

			current = &headingSection{
				level:    h.Level,
				heading:  headingText,
				ancestry: ancCopy,
			}
			return ast.WalkSkipChildren, nil
		}

		if n.Type() == ast.TypeBlock && n.Kind() != ast.KindDocument {
			text := strings.TrimSpace(string(extractNodeText(n, src)))
			if text == "" {
				return ast.WalkSkipChildren, nil
			}
			if current == nil {
				current = &headingSection{}
			}
			if current.body.Len() > 0 {
				current.body.WriteString("\n\n")
			}
			current.body.WriteString(text)
			return ast.WalkSkipChildren, nil
		}

		return ast.WalkContinue, nil
	})

	if current != nil {
		sections = append(sections, *current)
	}

	if len(sections) == 0 {
		return chunk(content, maxSize, 0)
	}

	// Build chunks from sections, merging small ones with the next section
	var out []string
	for i := 0; i < len(sections); i++ {
		s := sections[i]
		body := s.body.String()
		prefix := dc.prefix(s.ancestry, body)
		text := prefix + body

		// Merge undersized sections with the next one
		for len(text) < minSize && i+1 < len(sections) {
			i++
			next := sections[i]
			nextBody := next.body.String()
			nextPrefix := dc.prefix(next.ancestry, nextBody)
			text += "\n\n" + nextPrefix + nextBody
		}

		text = strings.TrimSpace(text)
		if text == "" {
			continue
		}

		if len(text) > maxSize {
			out = append(out, chunk(text, maxSize, 0)...)
		} else {
			out = append(out, text)
		}
	}
	return out
}

// headingParts drops the empty placeholder levels the ancestry tracker
// inserts when a document skips a heading level (an h3 under an h1).
func headingParts(ancestry []string) []string {
	var parts []string
	for _, h := range ancestry {
		if h != "" {
			parts = append(parts, h)
		}
	}
	return parts
}

func extractNodeText(n ast.Node, src []byte) []byte {
	var buf []byte
	lines := n.Lines()
	for i := 0; i < lines.Len(); i++ {
		seg := lines.At(i)
		buf = append(buf, seg.Value(src)...)
	}
	if len(buf) > 0 {
		return buf
	}
	// For container blocks, walk children
	for child := n.FirstChild(); child != nil; child = child.NextSibling() {
		buf = append(buf, extractNodeText(child, src)...)
	}
	return buf
}
