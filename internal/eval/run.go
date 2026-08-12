package eval

import (
	"context"
	"fmt"
	"sort"
	"strings"
)

// DefaultTopK is the cutoff used when a caller does not specify one.
const DefaultTopK = 5

// Engine is one retrieval strategy under test. Rank returns up to topK
// distinct paths in descending relevance order.
//
// exclude is a list of path prefixes that must be dropped *before* ranking, so
// that the K slots are filled by the next-best eligible documents. Removing
// them afterwards would leave short lists and understate every metric — which
// is precisely the leave-one-topic-out setup this package exists for.
type Engine interface {
	Name() string
	Rank(ctx context.Context, question string, topK int, exclude []string) ([]string, error)
}

// Options tune a run.
type Options struct {
	// TopK is the rank cutoff for every metric. Zero means DefaultTopK.
	TopK int
	// ExcludePrefixes hides a subtree from retrieval — the held-out set.
	// It is a list, not a single prefix: material about one topic also lives
	// under sources/ and experiments/, and excluding only the obvious path
	// leaks the answer.
	ExcludePrefixes []string
}

// Request is a transport-independent evaluation request. Both the REST
// handler and the MCP backend resolve one of these, so the rule about which
// combinations are legal lives in one place.
type Request struct {
	// Set names a golden set under <root>/.kiwi/eval/.
	Set string
	// Queries supplies topics inline. Mutually exclusive with Set.
	Queries []Query
	Options Options
}

// Resolve turns a Request into the queries to run. Every error it returns is
// caused by the caller's input, so transports can map them to 400 without
// inspecting them.
func Resolve(root string, req Request) ([]Query, error) {
	set := strings.TrimSpace(req.Set)
	switch {
	case set != "" && len(req.Queries) > 0:
		return nil, fmt.Errorf("set and queries are mutually exclusive")
	case set != "":
		return LoadSet(root, set)
	case len(req.Queries) > 0:
		return req.Queries, nil
	default:
		return nil, fmt.Errorf("queries or set is required")
	}
}

// QueryReport is one topic's outcome across every engine.
type QueryReport struct {
	ID       string                `json:"id,omitempty"`
	Question string                `json:"question"`
	Relevant []string              `json:"relevant"`
	Scores   map[string]QueryScore `json:"scores"`
}

// SkippedQuery records a topic that could not be scored, and why. A skipped
// query is excluded from the averages; reporting it is what stops a run from
// looking like a clean 1.0 over two surviving queries.
type SkippedQuery struct {
	ID       string `json:"id,omitempty"`
	Question string `json:"question"`
	Reason   string `json:"reason"`
}

// Report is the full result of a run.
type Report struct {
	TopK            int                `json:"top_k"`
	ExcludePrefixes []string           `json:"exclude_prefix,omitempty"`
	EngineOrder     []string           `json:"engine_order"`
	Engines         map[string]Metrics `json:"engines"`
	Queries         []QueryReport      `json:"queries"`
	Skipped         []SkippedQuery     `json:"skipped,omitempty"`
	Errors          int                `json:"errors"`
}

// Metrics for a named engine, or the zero value if it did not run.
func (r *Report) Metrics(engine string) Metrics {
	if r == nil {
		return Metrics{}
	}
	return r.Engines[engine]
}

// Run evaluates every query against every engine.
//
// Queries whose entire relevant set falls inside ExcludePrefixes are skipped:
// the answer has been hidden, so no engine can be expected to find it and
// scoring it would only drag every engine down by the same constant.
func Run(ctx context.Context, queries []Query, engines []Engine, opts Options) (*Report, error) {
	topK := opts.TopK
	if topK <= 0 {
		topK = DefaultTopK
	}
	exclude := normalizePrefixes(opts.ExcludePrefixes)

	rep := &Report{
		TopK:            topK,
		ExcludePrefixes: exclude,
		Engines:         make(map[string]Metrics, len(engines)),
		Queries:         []QueryReport{},
	}
	for _, e := range engines {
		rep.EngineOrder = append(rep.EngineOrder, e.Name())
	}

	scored := make(map[string][]QueryScore, len(engines))
	for _, q := range queries {
		if strings.TrimSpace(q.Question) == "" {
			rep.Skipped = append(rep.Skipped, SkippedQuery{ID: q.ID, Question: q.Question, Reason: "empty question"})
			continue
		}
		relevant := pruneRelevant(q.Relevant, exclude)
		if len(relevant) == 0 {
			reason := "no relevant documents"
			if len(exclude) > 0 && len(q.RelevantPaths()) > 0 {
				reason = "every relevant document is excluded"
			}
			rep.Skipped = append(rep.Skipped, SkippedQuery{ID: q.ID, Question: q.Question, Reason: reason})
			continue
		}

		qr := QueryReport{
			ID:       q.ID,
			Question: q.Question,
			Relevant: sortedKeys(relevant),
			Scores:   make(map[string]QueryScore, len(engines)),
		}
		for _, e := range engines {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			ranked, err := e.Rank(ctx, q.Question, topK, exclude)
			score := Score(ranked, relevant, topK)
			if err != nil {
				// A failed query counts as a miss, not as an absent query:
				// shrinking the denominator would reward a broken engine.
				score.Error = err.Error()
				rep.Errors++
			}
			qr.Scores[e.Name()] = score
			scored[e.Name()] = append(scored[e.Name()], score)
		}
		rep.Queries = append(rep.Queries, qr)
	}

	for _, e := range engines {
		rep.Engines[e.Name()] = aggregate(scored[e.Name()])
	}
	return rep, nil
}

// Excluded reports whether path sits under any of the prefixes.
func Excluded(path string, prefixes []string) bool {
	for _, p := range prefixes {
		if strings.HasPrefix(path, p) {
			return true
		}
	}
	return false
}

func normalizePrefixes(prefixes []string) []string {
	var out []string
	seen := make(map[string]bool, len(prefixes))
	for _, p := range prefixes {
		p = strings.TrimSpace(p)
		p = strings.TrimPrefix(p, "/")
		if p == "" || seen[p] {
			continue
		}
		seen[p] = true
		out = append(out, p)
	}
	return out
}

func pruneRelevant(relevant map[string]int, exclude []string) map[string]int {
	out := make(map[string]int, len(relevant))
	for path, grade := range relevant {
		if grade <= 0 || Excluded(path, exclude) {
			continue
		}
		out[path] = grade
	}
	return out
}

func sortedKeys(m map[string]int) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
