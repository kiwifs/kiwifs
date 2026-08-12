package markdown

import (
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/yuin/goldmark"
	meta "github.com/yuin/goldmark-meta"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
)

// ClaimDirective is the directive name that marks a claim.
//
// Naming note: `.kiwi/state/claims.db` and `internal/claims` are the task
// *leasing* system and have nothing to do with this. Everything here is
// "provenance" — the table, the queries, the docs — so the two never get
// confused at a call site.
const ClaimDirective = "claim"

// Claim is one authored assertion with its provenance metadata.
type Claim struct {
	Index      int               `json:"index"` // 0-based position among claims on the page
	Scope      string            `json:"scope"` // "block" | "inline"
	Line       int               `json:"line"`
	Text       string            `json:"text"`
	Evidence   string            `json:"evidence"`
	Confidence *float64          `json:"confidence"`
	Source     string            `json:"source"`
	Attributes map[string]string `json:"attributes,omitempty"`
}

const (
	claimScopeBlock  = "block"
	claimScopeInline = "inline"
)

// Record is the JSON payload stored in the provenance table and queried by
// `FROM CLAIMS`.
//
// Two rules matter here and are load-bearing for the DQL side:
//
//   - `confidence` is a number or null, never the string "0.6". SQLite orders
//     NULL < numeric < TEXT, so one string sentinel makes `confidence < 0.7`
//     silently match rows it should not. This is Phase 0 finding #2.
//   - `source` is null when absent, not "". The whole point of the feature is
//     the query "claims with no supporting source", which is `source IS NULL`.
//
// Unrecognised attributes are carried through as top-level strings so a
// workspace can add its own without a schema change.
func (c Claim) Record() map[string]any {
	rec := make(map[string]any, len(c.Attributes)+5)
	for k, v := range c.Attributes {
		rec[k] = v
	}
	rec["text"] = c.Text
	rec["scope"] = c.Scope
	rec["evidence"] = nilIfEmpty(c.Evidence)
	rec["source"] = nilIfEmpty(c.Source)
	if c.Confidence != nil {
		rec["confidence"] = *c.Confidence
	} else {
		rec["confidence"] = nil
	}
	return rec
}

func nilIfEmpty(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

// ExtractClaims returns every `claim` directive on the page, in document order.
//
// A claim whose `confidence` attribute is not a number is reported in the
// returned error and indexed with a null confidence — dropping the claim
// entirely would hide it from exactly the audit query it exists to answer,
// and keeping the raw string would corrupt every numeric comparison. Callers
// should log the error and index what came back, as the kiwi-data path does.
func ExtractClaims(content []byte) ([]Claim, error) {
	md := goldmark.New(
		goldmark.WithExtensions(meta.Meta, Directives),
	)
	ctx := parser.NewContext()
	doc := md.Parser().Parse(text.NewReader(content), parser.WithContext(ctx))

	var claims []Claim
	var errs []error
	idx := 0

	err := ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		var (
			name  string
			attrs map[string]string
			claim Claim
		)
		switch node := n.(type) {
		case *ContainerDirective:
			name, attrs = node.Name, node.Attrs
			claim = Claim{Scope: claimScopeBlock, Line: offsetLine(content, node.Offset), Text: nodeText(content, node)}
		case *TextDirective:
			name, attrs = node.Name, node.Attrs
			claim = Claim{Scope: claimScopeInline, Line: offsetLine(content, node.Offset), Text: node.Label}
		default:
			return ast.WalkContinue, nil
		}
		if name != ClaimDirective {
			return ast.WalkContinue, nil
		}

		claim.Index = idx
		idx++
		claim.Evidence = strings.TrimSpace(attrs["evidence"])
		claim.Source = strings.TrimSpace(attrs["source"])
		claim.Text = strings.TrimSpace(claim.Text)

		if raw, ok := attrs["confidence"]; ok && strings.TrimSpace(raw) != "" {
			v, cerr := strconv.ParseFloat(strings.TrimSpace(raw), 64)
			if cerr != nil {
				errs = append(errs, fmt.Errorf("claim %d: confidence %q is not a number", claim.Index, raw))
			} else {
				claim.Confidence = &v
			}
		}

		// Only the leftovers ride along; the typed fields are set above and
		// must not be shadowed by their own raw string form.
		if extra := copyExcept(attrs, "evidence", "source", "confidence"); len(extra) > 0 {
			claim.Attributes = extra
		}

		claims = append(claims, claim)
		return ast.WalkContinue, nil
	})
	if err != nil {
		return nil, err
	}
	return claims, errors.Join(errs...)
}

func copyExcept(m map[string]string, skip ...string) map[string]string {
	out := make(map[string]string, len(m))
	for k, v := range m {
		drop := false
		for _, s := range skip {
			if k == s {
				drop = true
				break
			}
		}
		if !drop {
			out[k] = v
		}
	}
	return out
}

// offsetLine converts a byte offset into a 1-based source line. The directive
// nodes record their own offset because neither can report one otherwise: a
// container's Lines() is empty (its children hold the body), and calling
// Lines() on an inline node panics outright.
func offsetLine(source []byte, offset int) int {
	if offset < 0 {
		return 0
	}
	line := 1
	for i := 0; i < offset && i < len(source); i++ {
		if source[i] == '\n' {
			line++
		}
	}
	return line
}

// nodeText flattens a subtree to its visible text. goldmark exposes segments
// per leaf node, so this walks rather than trusting a single Lines() range —
// a container's Lines() covers the raw source including nested markup.
func nodeText(source []byte, n ast.Node) string {
	var sb strings.Builder
	_ = ast.Walk(n, func(child ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch t := child.(type) {
		case *ast.Text:
			sb.Write(t.Segment.Value(source))
			if t.SoftLineBreak() || t.HardLineBreak() {
				sb.WriteByte(' ')
			}
		case *ast.String:
			sb.Write(t.Value)
		case *ast.CodeSpan:
			// Handled by its child Text nodes.
			return ast.WalkContinue, nil
		case *ast.FencedCodeBlock, *ast.CodeBlock:
			lines := child.Lines()
			for i := 0; i < lines.Len(); i++ {
				seg := lines.At(i)
				sb.Write(seg.Value(source))
			}
			return ast.WalkSkipChildren, nil
		}
		return ast.WalkContinue, nil
	})
	return strings.Join(strings.Fields(sb.String()), " ")
}
