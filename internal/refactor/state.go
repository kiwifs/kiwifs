package refactor

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// commentsDir holds one JSON array of comments per page, at
// <commentsDir>/<page path>.json (see internal/comments).
const commentsDir = ".kiwi/comments"

// renames maps every page whose path changes to where its data belongs.
func (p *planner) renames() map[string]string {
	out := make(map[string]string, len(p.moved)+len(p.merged))
	for from, to := range p.moved {
		out[from] = to
	}
	for from, to := range p.merged {
		out[from] = to
	}
	return out
}

// migrateSideFiles moves comment files with their pages and rewrites page
// paths inside personal-state documents (.me/*.json, and per-user state
// under .kiwi/users/*/state/). Neither is a page, so links never reach them,
// and a moved page would otherwise lose its comments, progress and notes.
func (p *planner) migrateSideFiles() error {
	if p.ws.Root == "" {
		return nil
	}
	renames := p.renames()
	if err := p.migrateComments(renames); err != nil {
		return err
	}
	return p.migrateState(renames)
}

func (p *planner) migrateComments(renames map[string]string) error {
	base := filepath.Join(p.ws.Root, filepath.FromSlash(commentsDir))
	existing := map[string]bool{}
	err := filepath.WalkDir(base, func(abs string, d fs.DirEntry, err error) error {
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				return filepath.SkipDir
			}
			return err
		}
		if !d.IsDir() && strings.HasSuffix(d.Name(), ".json") {
			rel, _ := filepath.Rel(base, abs)
			existing[strings.TrimSuffix(filepath.ToSlash(rel), ".json")] = true
		}
		return nil
	})
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("scan comments: %w", err)
	}

	// Group comment files by the page they will belong to. A page that
	// stays and receives comments (a merge target) keeps its own first.
	incoming := map[string][]string{}
	for page := range existing {
		if to, ok := renames[page]; ok {
			incoming[to] = append(incoming[to], page)
		}
	}
	targets := make([]string, 0, len(incoming))
	for t := range incoming {
		targets = append(targets, t)
	}
	sort.Strings(targets)

	for _, target := range targets {
		sources := incoming[target]
		sort.Strings(sources)
		var parts []string
		if _, leaving := renames[target]; existing[target] && !leaving {
			parts = append(parts, target)
		}
		parts = append(parts, sources...)

		var all []json.RawMessage
		for _, page := range parts {
			data, err := os.ReadFile(filepath.Join(base, filepath.FromSlash(page)+".json"))
			if err != nil {
				return fmt.Errorf("read comments for %s: %w", page, err)
			}
			rewritten, _, _, err := rewriteJSON(data, renames)
			if err != nil {
				return fmt.Errorf("comments for %s: %w", page, err)
			}
			var list []json.RawMessage
			if err := json.Unmarshal(rewritten, &list); err != nil {
				return fmt.Errorf("comments for %s: %w", page, err)
			}
			all = append(all, list...)
		}
		out, err := json.MarshalIndent(all, "", "  ")
		if err != nil {
			return err
		}
		for _, page := range sources {
			p.plan.Ops.Side = append(p.plan.Ops.Side, SideWrite{Path: commentsDir + "/" + page + ".json", Delete: true})
			p.plan.Comments = append(p.plan.Comments, PathChange{From: page, To: target})
		}
		p.plan.Ops.Side = append(p.plan.Ops.Side, SideWrite{Path: commentsDir + "/" + target + ".json", Content: out})
	}
	return nil
}

func (p *planner) migrateState(renames map[string]string) error {
	var docs []string
	for _, pattern := range []string{".me/*.json", ".kiwi/users/*/state/*.json"} {
		matches, err := filepath.Glob(filepath.Join(p.ws.Root, filepath.FromSlash(pattern)))
		if err != nil {
			return err
		}
		for _, m := range matches {
			rel, _ := filepath.Rel(p.ws.Root, m)
			docs = append(docs, filepath.ToSlash(rel))
		}
	}
	sort.Strings(docs)
	for _, doc := range docs {
		data, err := os.ReadFile(filepath.Join(p.ws.Root, filepath.FromSlash(doc)))
		if err != nil {
			return fmt.Errorf("read %s: %w", doc, err)
		}
		out, changes, conflicts, err := rewriteJSON(data, renames)
		if err != nil {
			// Not every file in .me/ has to be valid JSON for us to proceed;
			// one we cannot parse is one we cannot have broken either.
			continue
		}
		if changes == 0 {
			continue
		}
		p.plan.Ops.Side = append(p.plan.Ops.Side, SideWrite{Path: doc, Content: out})
		p.plan.State = append(p.plan.State, StateEdit{File: doc, Changes: changes, Conflicts: conflicts})
	}
	return nil
}

// jsonNode is a JSON value that remembers object key order, so a rewritten
// document differs from the original only where a path changed.
type jsonNode struct {
	kind  byte // '{', '[', or 0 for a scalar
	keys  []string
	vals  []*jsonNode
	items []*jsonNode
	raw   json.RawMessage
}

func parseJSON(dec *json.Decoder) (*jsonNode, error) {
	tok, err := dec.Token()
	if err != nil {
		return nil, err
	}
	switch t := tok.(type) {
	case json.Delim:
		switch t {
		case '{':
			n := &jsonNode{kind: '{'}
			for dec.More() {
				kt, err := dec.Token()
				if err != nil {
					return nil, err
				}
				key, ok := kt.(string)
				if !ok {
					return nil, fmt.Errorf("object key is not a string")
				}
				v, err := parseJSON(dec)
				if err != nil {
					return nil, err
				}
				n.keys = append(n.keys, key)
				n.vals = append(n.vals, v)
			}
			if _, err := dec.Token(); err != nil {
				return nil, err
			}
			return n, nil
		case '[':
			n := &jsonNode{kind: '['}
			for dec.More() {
				v, err := parseJSON(dec)
				if err != nil {
					return nil, err
				}
				n.items = append(n.items, v)
			}
			if _, err := dec.Token(); err != nil {
				return nil, err
			}
			return n, nil
		}
		return nil, fmt.Errorf("unexpected %v", t)
	default:
		raw, err := marshalNoEscape(t)
		if err != nil {
			return nil, err
		}
		return &jsonNode{raw: raw}, nil
	}
}

func marshalNoEscape(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

func (n *jsonNode) write(buf *bytes.Buffer) {
	switch n.kind {
	case '{':
		buf.WriteByte('{')
		for i, k := range n.keys {
			if i > 0 {
				buf.WriteByte(',')
			}
			kb, _ := marshalNoEscape(k)
			buf.Write(kb)
			buf.WriteByte(':')
			n.vals[i].write(buf)
		}
		buf.WriteByte('}')
	case '[':
		buf.WriteByte('[')
		for i, v := range n.items {
			if i > 0 {
				buf.WriteByte(',')
			}
			v.write(buf)
		}
		buf.WriteByte(']')
	default:
		buf.Write(n.raw)
	}
}

type jsonRewriter struct {
	renames   map[string]string
	changes   int
	conflicts []string
}

func (r *jsonRewriter) rename(s string) (string, bool) {
	if to, ok := r.renames[s]; ok {
		return to, true
	}
	if strings.HasPrefix(s, "/") {
		if to, ok := r.renames[s[1:]]; ok {
			return "/" + to, true
		}
	}
	return s, false
}

func (r *jsonRewriter) walk(n *jsonNode) {
	switch n.kind {
	case '{':
		renamed := make([]bool, len(n.keys))
		for i, k := range n.keys {
			if to, ok := r.rename(k); ok {
				n.keys[i] = to
				renamed[i] = true
				r.changes++
			}
			r.walk(n.vals[i])
		}
		// A merge can send two keys to one. The entry already under the
		// target key wins; otherwise the first one renamed into it does.
		first := map[string]int{}
		keep := make([]bool, len(n.keys))
		for i, k := range n.keys {
			j, seen := first[k]
			switch {
			case !seen:
				first[k] = i
				keep[i] = true
			case renamed[j] && !renamed[i]:
				keep[j], keep[i] = false, true
				first[k] = i
				r.conflicts = append(r.conflicts, fmt.Sprintf("%s: kept the existing entry, dropped the merged one", k))
			default:
				r.conflicts = append(r.conflicts, fmt.Sprintf("%s: kept the existing entry, dropped the merged one", k))
			}
		}
		var keys []string
		var vals []*jsonNode
		for i := range n.keys {
			if keep[i] {
				keys = append(keys, n.keys[i])
				vals = append(vals, n.vals[i])
			}
		}
		n.keys, n.vals = keys, vals
	case '[':
		for _, v := range n.items {
			r.walk(v)
		}
	default:
		if len(n.raw) == 0 || n.raw[0] != '"' {
			return
		}
		var s string
		if json.Unmarshal(n.raw, &s) != nil {
			return
		}
		if to, ok := r.rename(s); ok {
			n.raw, _ = marshalNoEscape(to)
			r.changes++
		}
	}
}

// rewriteJSON replaces every object key and string value that is a renamed
// page path, keeping key order and the document's compact or indented
// layout. It returns the input unchanged when nothing matched.
func rewriteJSON(data []byte, renames map[string]string) ([]byte, int, []string, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	root, err := parseJSON(dec)
	if err != nil {
		return nil, 0, nil, err
	}
	if _, err := dec.Token(); err != io.EOF {
		return nil, 0, nil, fmt.Errorf("trailing data after JSON value")
	}
	r := &jsonRewriter{renames: renames}
	r.walk(root)
	if r.changes == 0 {
		return data, 0, nil, nil
	}
	var buf bytes.Buffer
	root.write(&buf)
	out := buf.Bytes()
	if bytes.Contains(bytes.TrimSpace(data), []byte("\n")) {
		var ind bytes.Buffer
		if err := json.Indent(&ind, out, "", indentOf(data)); err == nil {
			out = ind.Bytes()
		}
	}
	if bytes.HasSuffix(data, []byte("\n")) {
		out = append(out, '\n')
	}
	return out, r.changes, r.conflicts, nil
}

// indentOf guesses the indent unit of a pretty-printed JSON document.
func indentOf(data []byte) string {
	for _, line := range strings.Split(string(data), "\n")[1:] {
		trimmed := strings.TrimLeft(line, " \t")
		if trimmed != "" && len(trimmed) < len(line) {
			return line[:len(line)-len(trimmed)]
		}
	}
	return "  "
}
