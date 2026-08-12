// Package brief assembles a token-budgeted "answer pack" from a knowledge
// base: the material most relevant to a question, cut to fit a context window,
// plus a manifest of everything that did not fit.
//
// It composes existing primitives — hybrid retrieval, section splitting, token
// counting — and adds no intelligence of its own. In particular it does not
// summarise. A summary is a lossy rewrite the caller cannot audit; a manifest
// of what was dropped is a fact the caller can act on by asking for a specific
// page. That distinction is the feature.
package brief

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/kiwifs/kiwifs/internal/hybrid"
	"github.com/kiwifs/kiwifs/internal/markdown"
	"github.com/kiwifs/kiwifs/internal/search"
	"github.com/kiwifs/kiwifs/internal/storage"
	"github.com/kiwifs/kiwifs/internal/tokenize"
	"github.com/kiwifs/kiwifs/internal/vectorstore"
)

// Defaults for an unspecified request.
const (
	DefaultBudgetTokens = 4000
	DefaultMaxPages     = 20
	maxCandidatePages   = 100
)

// Reasons a candidate did not make it into the pack, verbatim as they appear
// in the manifest.
const (
	ReasonBudgetExhausted = "budget exhausted"
	ReasonSectionsDropped = "page truncated to fit budget"
	ReasonUnreadable      = "page could not be read"
	ReasonEmpty           = "page has no content"
)

// Request describes one pack to assemble.
type Request struct {
	Query string
	// BudgetTokens is the hard ceiling on the assembled content. Zero uses
	// DefaultBudgetTokens; a negative value is treated as zero, which yields
	// an empty pack and a manifest listing every candidate.
	BudgetTokens int
	// MaxPages caps how many pages are considered. Zero uses DefaultMaxPages.
	MaxPages int
	// PathPrefix restricts retrieval to one subtree.
	PathPrefix string
	// Encoding names the BPE vocabulary used for counting. Empty uses
	// tokenize.DefaultEncoding.
	Encoding string
}

// Item is one included piece of content.
type Item struct {
	Path  string `json:"path"`
	Title string `json:"title,omitempty"`
	// Heading is empty when the whole page was included, and names the section
	// otherwise. A caller must be able to tell a whole page from a fragment.
	Heading string `json:"heading,omitempty"`
	Content string `json:"content"`
	Tokens  int    `json:"tokens"`
	// Score, FTSRank and SemanticRank carry the retrieval provenance through
	// to the pack, so a reader can weigh a semantic-only hit differently.
	Score        float64 `json:"score"`
	FTSRank      int     `json:"fts_rank"`
	SemanticRank int     `json:"semantic_rank"`
	// Partial is true when some of the page's sections were left out.
	Partial bool `json:"partial,omitempty"`
}

// Dropped is one thing that did not make it in. Tokens is what it would have
// cost, so the caller can decide whether a bigger budget is worth it.
type Dropped struct {
	Path    string  `json:"path"`
	Heading string  `json:"heading,omitempty"`
	Reason  string  `json:"reason"`
	Tokens  int     `json:"tokens"`
	Score   float64 `json:"score"`
}

// Pack is the assembled result.
type Pack struct {
	Query        string    `json:"query"`
	BudgetTokens int       `json:"budget_tokens"`
	UsedTokens   int       `json:"used_tokens"`
	Tokenizer    string    `json:"tokenizer"`
	Items        []Item    `json:"items"`
	Dropped      []Dropped `json:"dropped"`
	// Candidates is how many pages retrieval offered before budgeting.
	Candidates int `json:"candidates"`
}

// Assemble runs retrieval, then fills the budget in relevance order.
//
// A page that fits whole goes in whole. A page that does not is split into its
// heading sections, and the sections that best match the query go in until the
// budget runs out; the rest are named in the manifest. Nothing is rewritten.
func Assemble(
	ctx context.Context,
	searcher search.Searcher,
	vectors *vectorstore.Service,
	store storage.Storage,
	req Request,
) (*Pack, error) {
	query := strings.TrimSpace(req.Query)
	if query == "" {
		return nil, fmt.Errorf("query is required")
	}
	budget := req.BudgetTokens
	if budget == 0 {
		budget = DefaultBudgetTokens
	}
	if budget < 0 {
		budget = 0
	}
	maxPages := req.MaxPages
	if maxPages <= 0 {
		maxPages = DefaultMaxPages
	}
	if maxPages > maxCandidatePages {
		maxPages = maxCandidatePages
	}

	counter, cerr := tokenize.NewCounter(req.Encoding)
	if cerr != nil && req.Encoding != "" {
		// An explicitly requested encoding that does not exist is the caller's
		// mistake and worth an error; the implicit default silently degrades.
		return nil, fmt.Errorf("tokenizer %q: %w", req.Encoding, cerr)
	}

	results, err := hybrid.Search(ctx, searcher, vectors, query, hybrid.Options{
		TopK:       maxPages,
		PathPrefix: req.PathPrefix,
		Boost:      true,
	})
	if err != nil {
		return nil, err
	}

	pack := &Pack{
		Query:        query,
		BudgetTokens: budget,
		Tokenizer:    counter.Name(),
		Items:        []Item{},
		Dropped:      []Dropped{},
		Candidates:   len(results),
	}

	terms := queryTerms(query)
	remaining := budget

	for _, r := range results {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		raw, rerr := store.Read(ctx, r.Path)
		if rerr != nil {
			pack.Dropped = append(pack.Dropped, Dropped{
				Path: r.Path, Reason: ReasonUnreadable, Score: r.Score,
			})
			continue
		}
		body := strings.TrimSpace(markdown.BodyAfterFrontmatter(raw))
		if body == "" {
			pack.Dropped = append(pack.Dropped, Dropped{
				Path: r.Path, Reason: ReasonEmpty, Score: r.Score,
			})
			continue
		}
		title := pageTitle(raw, r.Path)
		cost := counter.Count(body)

		if cost <= remaining {
			pack.Items = append(pack.Items, Item{
				Path: r.Path, Title: title, Content: body, Tokens: cost,
				Score: r.Score, FTSRank: r.FTSRank, SemanticRank: r.SemanticRank,
			})
			remaining -= cost
			pack.UsedTokens += cost
			continue
		}

		// Too big whole. Fall back to sections, best-matching first.
		included, dropped, used := fitSections(body, terms, counter, remaining)
		if len(included) == 0 {
			pack.Dropped = append(pack.Dropped, Dropped{
				Path: r.Path, Reason: ReasonBudgetExhausted, Tokens: cost, Score: r.Score,
			})
			// Keep going rather than stopping at the first oversized page: a
			// later, smaller page may still fit, and dropping it silently
			// because of an earlier giant would be arbitrary.
			continue
		}
		for _, sec := range included {
			pack.Items = append(pack.Items, Item{
				Path: r.Path, Title: title, Heading: sec.heading, Content: sec.text,
				Tokens: sec.tokens, Score: r.Score, FTSRank: r.FTSRank,
				SemanticRank: r.SemanticRank, Partial: true,
			})
		}
		for _, sec := range dropped {
			pack.Dropped = append(pack.Dropped, Dropped{
				Path: r.Path, Heading: sec.heading, Reason: ReasonSectionsDropped,
				Tokens: sec.tokens, Score: r.Score,
			})
		}
		remaining -= used
		pack.UsedTokens += used
	}

	return pack, nil
}

type sectionCost struct {
	heading string
	text    string
	tokens  int
	order   int
	score   int
}

// fitSections picks sections that fit the remaining budget, preferring those
// whose text matches the query, and returns them in document order so the page
// still reads top to bottom.
func fitSections(body string, terms []string, counter tokenize.Counter, remaining int) (included, dropped []sectionCost, used int) {
	sections := markdown.SplitSections([]byte(body))
	if len(sections) == 0 {
		return nil, nil, 0
	}
	costs := make([]sectionCost, 0, len(sections))
	for i, s := range sections {
		text := strings.TrimSpace(strings.Repeat("#", s.Level) + " " + s.Heading + "\n\n" + s.Content)
		costs = append(costs, sectionCost{
			heading: s.Heading,
			text:    text,
			tokens:  counter.Count(text),
			order:   i,
			score:   termOverlap(text, terms),
		})
	}

	byRelevance := make([]sectionCost, len(costs))
	copy(byRelevance, costs)
	sort.SliceStable(byRelevance, func(i, j int) bool {
		if byRelevance[i].score != byRelevance[j].score {
			return byRelevance[i].score > byRelevance[j].score
		}
		return byRelevance[i].order < byRelevance[j].order
	})

	keep := make(map[int]bool, len(costs))
	for _, s := range byRelevance {
		if s.tokens <= remaining-used {
			keep[s.order] = true
			used += s.tokens
		}
	}
	for _, s := range costs {
		if keep[s.order] {
			included = append(included, s)
		} else {
			dropped = append(dropped, s)
		}
	}
	return included, dropped, used
}

// termOverlap counts how many distinct query terms appear in the text. Crude
// on purpose: this only breaks ties between sections of an already-relevant
// page, and anything cleverer would be a ranking model nobody asked for.
func termOverlap(text string, terms []string) int {
	if len(terms) == 0 {
		return 0
	}
	lower := strings.ToLower(text)
	n := 0
	for _, t := range terms {
		if strings.Contains(lower, t) {
			n++
		}
	}
	return n
}

func queryTerms(query string) []string {
	seen := map[string]bool{}
	var out []string
	for _, f := range strings.Fields(strings.ToLower(query)) {
		f = strings.Trim(f, `.,;:!?"'()[]{}`)
		if len(f) < 3 || seen[f] {
			continue
		}
		seen[f] = true
		out = append(out, f)
	}
	return out
}

func pageTitle(raw []byte, path string) string {
	if parsed, err := markdown.Parse(raw); err == nil && parsed != nil {
		if t, ok := parsed.Frontmatter["title"].(string); ok && strings.TrimSpace(t) != "" {
			return strings.TrimSpace(t)
		}
	}
	for _, h := range markdown.Headings(raw) {
		if h.Level == 1 {
			return h.Text
		}
	}
	base := path
	if i := strings.LastIndex(base, "/"); i >= 0 {
		base = base[i+1:]
	}
	return strings.TrimSuffix(base, ".md")
}
