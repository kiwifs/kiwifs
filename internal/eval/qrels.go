// Package eval measures retrieval quality against a hand-labelled golden set.
//
// Golden sets live in <root>/.kiwi/eval/ as a pair of files sharing a base
// name: <name>.qrels holds the relevance judgements and <name>.topics holds
// the query text. The qrels file is TREC format, so ranx, trec_eval, pytrec_eval
// and friends read it with no converter — that interoperability is the whole
// reason for not inventing a format here.
package eval

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// EvalDir is the golden-set directory, relative to the knowledge root.
const EvalDir = ".kiwi/eval"

// Query is one evaluation topic: a question plus the relevance judgements for
// it. Relevance is graded (TREC convention): 0 means judged non-relevant, a
// positive integer means relevant, and higher is better. Grades feed nDCG;
// Hit Rate, MRR and Precision@K only care about grade > 0.
type Query struct {
	ID       string         `json:"id"`
	Question string         `json:"question"`
	Relevant map[string]int `json:"relevant"`
}

// RelevantPaths returns the paths judged relevant (grade > 0), sorted for
// deterministic output.
func (q Query) RelevantPaths() []string {
	paths := make([]string, 0, len(q.Relevant))
	for p, grade := range q.Relevant {
		if grade > 0 {
			paths = append(paths, p)
		}
	}
	sort.Strings(paths)
	return paths
}

// ParseQrels reads TREC qrels. Both the canonical four-column form
//
//	query_id iteration doc_id relevance
//
// and the three-column short form
//
//	query_id doc_id relevance
//
// are accepted; the iteration column is ignored, as trec_eval ignores it.
// Blank lines and lines starting with '#' are skipped. Columns are separated by
// any run of whitespace, which means document ids may not contain spaces —
// that is a TREC constraint, not ours, and knowledge paths never do.
//
// A later judgement for the same (query, doc) pair overwrites an earlier one.
func ParseQrels(r io.Reader) (map[string]map[string]int, error) {
	out := make(map[string]map[string]int)
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	line := 0
	for sc.Scan() {
		line++
		text := strings.TrimSpace(sc.Text())
		if text == "" || strings.HasPrefix(text, "#") {
			continue
		}
		fields := strings.Fields(text)
		var qid, docID, rel string
		switch len(fields) {
		case 3:
			qid, docID, rel = fields[0], fields[1], fields[2]
		case 4:
			qid, docID, rel = fields[0], fields[2], fields[3]
		default:
			return nil, fmt.Errorf("qrels line %d: expected 3 or 4 fields, got %d", line, len(fields))
		}
		grade, err := strconv.Atoi(rel)
		if err != nil {
			return nil, fmt.Errorf("qrels line %d: relevance %q is not an integer", line, rel)
		}
		if grade < 0 {
			// trec_eval treats negative grades as non-relevant rather than
			// rejecting them; do the same so third-party files load.
			grade = 0
		}
		if out[qid] == nil {
			out[qid] = make(map[string]int)
		}
		out[qid][docID] = grade
	}
	if err := sc.Err(); err != nil {
		return nil, fmt.Errorf("read qrels: %w", err)
	}
	return out, nil
}

// ParseTopics reads the query-text sidecar: one query per line, the id and the
// question separated by a tab (preferred) or by the first run of spaces.
// Question text may contain anything but a newline.
func ParseTopics(r io.Reader) (map[string]string, error) {
	out := make(map[string]string)
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	line := 0
	for sc.Scan() {
		line++
		text := strings.TrimSpace(sc.Text())
		if text == "" || strings.HasPrefix(text, "#") {
			continue
		}
		id, question, ok := strings.Cut(text, "\t")
		if !ok {
			id, question, ok = strings.Cut(text, " ")
			if !ok {
				return nil, fmt.Errorf("topics line %d: no question text after id %q", line, text)
			}
		}
		id = strings.TrimSpace(id)
		question = strings.TrimSpace(question)
		if id == "" || question == "" {
			return nil, fmt.Errorf("topics line %d: empty id or question", line)
		}
		out[id] = question
	}
	if err := sc.Err(); err != nil {
		return nil, fmt.Errorf("read topics: %w", err)
	}
	return out, nil
}

// LoadSet reads the golden set <root>/.kiwi/eval/<name>.{qrels,topics} and
// returns its queries sorted by id.
//
// A qrels entry with no matching topic is an error rather than a silent skip:
// a golden set that quietly evaluates fewer queries than it declares produces
// a number that looks fine and means nothing.
func LoadSet(root, name string) ([]Query, error) {
	if strings.TrimSpace(name) == "" {
		return nil, fmt.Errorf("eval set name is required")
	}
	if strings.ContainsAny(name, `/\`) || name == "." || name == ".." {
		return nil, fmt.Errorf("invalid eval set name %q", name)
	}
	dir := filepath.Join(root, filepath.FromSlash(EvalDir))
	qrelsPath := filepath.Join(dir, name+".qrels")
	topicsPath := filepath.Join(dir, name+".topics")

	qf, err := os.Open(qrelsPath)
	if err != nil {
		return nil, fmt.Errorf("open qrels: %w", err)
	}
	defer qf.Close()
	judgements, err := ParseQrels(qf)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", qrelsPath, err)
	}

	tf, err := os.Open(topicsPath)
	if err != nil {
		return nil, fmt.Errorf("open topics: %w", err)
	}
	defer tf.Close()
	topics, err := ParseTopics(tf)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", topicsPath, err)
	}

	ids := make([]string, 0, len(judgements))
	for id := range judgements {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	queries := make([]Query, 0, len(ids))
	for _, id := range ids {
		question, ok := topics[id]
		if !ok {
			return nil, fmt.Errorf("%s: query %q has judgements but no topic in %s", qrelsPath, id, topicsPath)
		}
		queries = append(queries, Query{ID: id, Question: question, Relevant: judgements[id]})
	}
	if len(queries) == 0 {
		return nil, fmt.Errorf("%s: no queries", qrelsPath)
	}
	return queries, nil
}

// ListSets returns the names of the golden sets under <root>/.kiwi/eval,
// sorted. A missing directory is not an error — it just means none exist.
func ListSets(root string) ([]string, error) {
	dir := filepath.Join(root, filepath.FromSlash(EvalDir))
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var names []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if name, ok := strings.CutSuffix(e.Name(), ".qrels"); ok {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	return names, nil
}
