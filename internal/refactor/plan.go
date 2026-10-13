package refactor

import (
	"context"
	"crypto/sha1"
	"crypto/sha256"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"github.com/kiwifs/kiwifs/internal/links"
	"github.com/kiwifs/kiwifs/internal/storage"
)

// Workspace is what a plan reads: pages through Store, and the comment and
// personal-state files under Root that are keyed by page path.
type Workspace struct {
	Root  string
	Store storage.Storage
}

// PathChange is one path that changes, for reports.
type PathChange struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// LinkEdit is one rewritten reference. Old and New are the path text only;
// labels, anchors and brackets are untouched.
type LinkEdit struct {
	Line int    `json:"line"`
	Old  string `json:"old"`
	New  string `json:"new"`
}

// FileEdit lists the references rewritten in one page. Path is where the
// page lives after the refactor; From is set when the page moves.
type FileEdit struct {
	Path  string     `json:"path"`
	From  string     `json:"from,omitempty"`
	Links []LinkEdit `json:"links"`
}

// StateEdit summarizes the changes to one personal-state file.
type StateEdit struct {
	File      string   `json:"file"`
	Changes   int      `json:"changes"`
	Conflicts []string `json:"conflicts,omitempty"`
}

// Stats counts what the plan looked at.
type Stats struct {
	Pages     int `json:"pages"`
	Links     int `json:"links"`
	Rewritten int `json:"rewritten"`
	// Unresolved counts references that already pointed nowhere. They are
	// left exactly as written.
	Unresolved int `json:"unresolved"`
}

// Plan is a complete, unapplied restructuring. Errors non-empty means the
// plan must not be applied; Ops is then empty.
type Plan struct {
	Digest      string       `json:"digest"`
	Moves       []PathChange `json:"moves"`
	Merges      []PathChange `json:"merges"`
	Edits       []FileEdit   `json:"edits"`
	Comments    []PathChange `json:"comments,omitempty"`
	State       []StateEdit  `json:"state,omitempty"`
	RemovedDirs []string     `json:"removed_dirs,omitempty"`
	Errors      []string     `json:"errors,omitempty"`
	Stats       Stats        `json:"stats"`

	Ops Ops `json:"-"`
}

// Ops is everything applying the plan does, fully materialized.
type Ops struct {
	// Writes are pages and assets written through storage, so they are
	// committed and reindexed. Source is the path read at plan time (the old
	// path for a move) and SourceETag its content hash then; apply refuses to
	// run if that file changed since.
	Writes []FileWrite
	// Deletes are pages and assets removed through storage.
	Deletes []FileDelete
	// Side are comment and personal-state files, relative to Root. They are
	// not pages: no commit, no index.
	Side []SideWrite
	// Dirs are folders to remove after the moves, deepest first.
	Dirs []string
}

type FileWrite struct {
	Path       string
	Content    []byte
	Source     string
	SourceETag string
}

type FileDelete struct {
	Path string
	ETag string
}

type SideWrite struct {
	Path    string
	Content []byte
	Delete  bool
}

// ETag is the git blob hash of content. It matches pipeline.ETag, which is
// what apply compares against.
func ETag(content []byte) string {
	h := sha1.New()
	fmt.Fprintf(h, "blob %d\x00", len(content))
	h.Write(content)
	return fmt.Sprintf("%x", h.Sum(nil))
}

type planner struct {
	ws      Workspace
	plan    *Plan
	files   []string
	exists  map[string]bool
	moved   map[string]string // old path → new path
	merged  map[string]string // merged-away path → the page it went into, after moves
	pre     *links.PathIndex
	post    *links.PathIndex
	content map[string][]byte
}

func (p *planner) errorf(format string, args ...any) {
	p.plan.Errors = append(p.plan.Errors, fmt.Sprintf(format, args...))
}

// final is where a page's references should point after the refactor.
func (p *planner) final(path string) string {
	if to, ok := p.moved[path]; ok {
		return to
	}
	if to, ok := p.merged[path]; ok {
		return to
	}
	return path
}

// BuildPlan computes the restructuring m describes, without writing.
func BuildPlan(ctx context.Context, ws Workspace, m *Manifest) (*Plan, error) {
	files, err := listFiles(ctx, ws.Store)
	if err != nil {
		return nil, err
	}
	p := &planner{
		ws:      ws,
		plan:    &Plan{Moves: []PathChange{}, Merges: []PathChange{}, Edits: []FileEdit{}},
		files:   files,
		exists:  make(map[string]bool, len(files)),
		moved:   map[string]string{},
		merged:  map[string]string{},
		content: map[string][]byte{},
	}
	for _, f := range files {
		p.exists[f] = true
	}

	p.expandMoves(m.Moves)
	p.expandMerges(m.Merges)
	postFiles := p.checkDestinations()
	if len(p.plan.Errors) > 0 {
		return p.plan, nil
	}

	p.pre = links.BuildPathIndex(files)
	p.post = links.BuildPathIndex(postFiles)
	if err := p.rewritePages(ctx); err != nil {
		return nil, err
	}
	if len(p.plan.Errors) > 0 {
		p.plan.Ops = Ops{}
		return p.plan, nil
	}
	if err := p.migrateSideFiles(); err != nil {
		return nil, err
	}
	if m.DeleteEmptyDirs {
		p.planEmptyDirs(postFiles)
	}
	if len(p.plan.Errors) > 0 {
		p.plan.Ops = Ops{}
		return p.plan, nil
	}
	p.plan.Digest = p.digest()
	return p.plan, nil
}

// listFiles returns every non-hidden file in the workspace, sorted.
func listFiles(ctx context.Context, store storage.Storage) ([]string, error) {
	var out []string
	err := storage.WalkAll(ctx, store, "/", func(e storage.Entry) error {
		out = append(out, strings.TrimPrefix(e.Path, "/"))
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("list workspace: %w", err)
	}
	sort.Strings(out)
	return out, nil
}

func joinDir(dir, rest string) string {
	if dir == "" {
		return rest
	}
	return dir + "/" + rest
}

func (p *planner) addMove(from, to string) {
	if from == to {
		return
	}
	if prev, ok := p.moved[from]; ok && prev != to {
		p.errorf("%s is moved twice (to %s and %s)", from, prev, to)
		return
	}
	p.moved[from] = to
}

func (p *planner) expandMoves(moves []Move) {
	for _, mv := range moves {
		from, _, err := cleanPath(mv.From)
		if err != nil || from == "" {
			p.errorf("move from %q: invalid path", mv.From)
			continue
		}
		to, toDir, err := cleanPath(mv.To)
		if err != nil {
			p.errorf("move to %q: %v", mv.To, err)
			continue
		}
		switch {
		case strings.ContainsAny(from, "*?["):
			if !toDir {
				p.errorf("move %s: a glob needs a destination folder ending in /", from)
				continue
			}
			n := 0
			for _, f := range p.files {
				if ok, _ := path.Match(from, f); ok {
					p.addMove(f, joinDir(to, path.Base(f)))
					n++
				}
			}
			if n == 0 {
				p.errorf("move %s: no file matches", from)
			}
		case p.exists[from]:
			dest := to
			if toDir || to == "" {
				dest = joinDir(to, path.Base(from))
			}
			p.addMove(from, dest)
		default:
			prefix := from + "/"
			n := 0
			for _, f := range p.files {
				if strings.HasPrefix(f, prefix) {
					p.addMove(f, joinDir(to, strings.TrimPrefix(f, prefix)))
					n++
				}
			}
			if n == 0 {
				p.errorf("move %s: no such file or folder", from)
			}
		}
	}
}

func (p *planner) expandMerges(merges []Merge) {
	for _, mg := range merges {
		from, _, err := cleanPath(mg.From)
		if err != nil || from == "" || !p.exists[from] {
			p.errorf("merge from %q: no such file", mg.From)
			continue
		}
		into, _, err := cleanPath(mg.Into)
		if err != nil || into == "" {
			p.errorf("merge into %q: invalid path", mg.Into)
			continue
		}
		if _, ok := p.moved[from]; ok {
			p.errorf("%s is both moved and merged", from)
			continue
		}
		if to, ok := p.moved[into]; ok {
			into = to
		}
		if into == from {
			p.errorf("%s is merged into itself", from)
			continue
		}
		p.merged[from] = into
	}
}

// checkDestinations builds the file list after the refactor and rejects
// collisions, including ones that differ only by case.
func (p *planner) checkDestinations() []string {
	post := map[string]string{} // path → why it exists
	for _, f := range p.files {
		if _, ok := p.moved[f]; ok {
			continue
		}
		if _, ok := p.merged[f]; ok {
			continue
		}
		post[f] = "existing file"
	}
	froms := make([]string, 0, len(p.moved))
	for from := range p.moved {
		froms = append(froms, from)
	}
	sort.Strings(froms)
	for _, from := range froms {
		to := p.moved[from]
		if why, ok := post[to]; ok {
			p.errorf("%s cannot move to %s: destination is taken (%s)", from, to, why)
			continue
		}
		post[to] = "moved from " + from
	}
	byLower := map[string]string{}
	out := make([]string, 0, len(post))
	for f := range post {
		out = append(out, f)
	}
	sort.Strings(out)
	for _, f := range out {
		l := strings.ToLower(f)
		if other, ok := byLower[l]; ok {
			p.errorf("%s and %s differ only by case", other, f)
		}
		byLower[l] = f
	}
	for from, into := range p.merged {
		if _, ok := post[into]; !ok {
			p.errorf("merge %s into %s: target does not exist after the moves", from, into)
		}
	}
	for _, from := range froms {
		p.plan.Moves = append(p.plan.Moves, PathChange{From: from, To: p.moved[from]})
	}
	mfroms := make([]string, 0, len(p.merged))
	for from := range p.merged {
		mfroms = append(mfroms, from)
	}
	sort.Strings(mfroms)
	for _, from := range mfroms {
		p.plan.Merges = append(p.plan.Merges, PathChange{From: from, To: p.merged[from]})
	}
	return out
}

func isMarkdown(p string) bool {
	return strings.HasSuffix(strings.ToLower(p), ".md")
}

func dirOf(p string) string {
	if i := strings.LastIndex(p, "/"); i >= 0 {
		return p[:i]
	}
	return ""
}

func cleanRel(p string) string {
	var out []string
	for _, seg := range strings.Split(p, "/") {
		switch seg {
		case "", ".":
		case "..":
			if len(out) > 0 {
				out = out[:len(out)-1]
			}
		default:
			out = append(out, seg)
		}
	}
	return strings.Join(out, "/")
}

// relPath spells target relative to the folder fromDir.
func relPath(fromDir, target string) string {
	var fp []string
	if fromDir != "" {
		fp = strings.Split(fromDir, "/")
	}
	tp := strings.Split(target, "/")
	i := 0
	for i < len(fp) && i < len(tp)-1 && fp[i] == tp[i] {
		i++
	}
	parts := make([]string, 0, len(fp)-i+len(tp)-i)
	for j := i; j < len(fp); j++ {
		parts = append(parts, "..")
	}
	parts = append(parts, tp[i:]...)
	return strings.Join(parts, "/")
}

// resolve finds the file a reference points to, the way the reader does.
func resolve(idx *links.PathIndex, kind linkKind, ref, from string) string {
	if kind == kindWiki {
		return idx.ResolveLink(ref, from)
	}
	p := decodeHref(ref)
	switch {
	case strings.HasPrefix(p, "/page/"):
		return idx.LookupExact(strings.TrimPrefix(p, "/page/"))
	case strings.HasPrefix(p, "/"):
		return idx.LookupExact(strings.TrimLeft(p, "/"))
	default:
		return idx.LookupExact(cleanRel(joinDir(dirOf(from), p)))
	}
}

func trimMD(p string) string {
	if isMarkdown(p) {
		return p[:len(p)-3]
	}
	return p
}

// respell writes a reference to target in the same style as the original,
// as short as the original was, falling back to the full path.
func (p *planner) respell(r linkRef, oldTarget, target, from string) (string, bool) {
	ok := func(c string) bool { return resolve(p.post, r.Kind, c, from) == target }
	orig := r.Path

	if r.Kind == kindMarkdown {
		dec := decodeHref(orig)
		var c string
		switch {
		case strings.HasPrefix(dec, "/page/"):
			c = "/page/" + target
		case strings.HasPrefix(dec, "/"):
			c = "/" + target
		default:
			c = relPath(dirOf(from), target)
			if strings.HasPrefix(dec, "./") && !strings.HasPrefix(c, "../") {
				c = "./" + c
			}
		}
		c = encodeHref(c)
		return c, ok(c)
	}

	spell := func(c string) string {
		if !isMarkdown(orig) {
			return trimMD(c)
		}
		return c
	}
	switch {
	case strings.HasPrefix(orig, "./") || strings.HasPrefix(orig, "../"):
		c := relPath(dirOf(from), target)
		if !strings.HasPrefix(c, "../") {
			c = "./" + c
		}
		c = spell(c)
		return c, ok(c)
	case strings.HasPrefix(orig, "/"):
		c := "/" + spell(target)
		return c, ok(c)
	}
	// A bare name stays bare while it is unambiguous; a partial path stays
	// relative to the page's folder while the target is still inside it.
	// Anything else becomes the full path: suffix guesses like "sorting/x"
	// read poorly and break as soon as another folder gains the same name.
	wasFull := strings.EqualFold(trimMD(orig), trimMD(oldTarget))
	if !wasFull {
		var c string
		if !strings.Contains(orig, "/") {
			c = spell(target[strings.LastIndex(target, "/")+1:])
		} else if dir := dirOf(from); dir == "" || strings.HasPrefix(target, dir+"/") {
			c = spell(strings.TrimPrefix(target, dir+"/"))
		}
		if c != "" && ok(c) {
			return c, true
		}
	}
	c := spell(target)
	return c, ok(c)
}

type splice struct {
	start, end int
	text       string
}

func applySplices(content []byte, edits []splice) []byte {
	sort.Slice(edits, func(i, j int) bool { return edits[i].start > edits[j].start })
	out := append([]byte(nil), content...)
	for _, e := range edits {
		out = append(out[:e.start], append([]byte(e.text), out[e.end:]...)...)
	}
	return out
}

func (p *planner) read(ctx context.Context, f string) ([]byte, error) {
	if c, ok := p.content[f]; ok {
		return c, nil
	}
	c, err := p.ws.Store.Read(ctx, f)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", f, err)
	}
	p.content[f] = c
	return c, nil
}

// rewritePages respells every reference whose target moves, plans the page
// writes and deletes, then checks the result: each reference that resolved
// before must resolve to the same page (after moves and merges) afterwards.
func (p *planner) rewritePages(ctx context.Context) error {
	for _, f := range p.files {
		if _, ok := p.merged[f]; ok {
			c, err := p.read(ctx, f)
			if err != nil {
				return err
			}
			p.plan.Ops.Deletes = append(p.plan.Ops.Deletes, FileDelete{Path: f, ETag: ETag(c)})
			continue
		}
		to, moving := p.moved[f]
		if !isMarkdown(f) {
			if moving {
				c, err := p.read(ctx, f)
				if err != nil {
					return err
				}
				p.plan.Ops.Writes = append(p.plan.Ops.Writes, FileWrite{Path: to, Content: c, Source: f, SourceETag: ETag(c)})
				p.plan.Ops.Deletes = append(p.plan.Ops.Deletes, FileDelete{Path: f, ETag: ETag(c)})
			}
			continue
		}

		p.plan.Stats.Pages++
		content, err := p.read(ctx, f)
		if err != nil {
			return err
		}
		from := p.final(f)
		refs := scanLinks(content)
		expected := make([]string, len(refs))
		var edits []splice
		var report []LinkEdit
		for i, r := range refs {
			p.plan.Stats.Links++
			before := resolve(p.pre, r.Kind, r.Path, f)
			if before == "" {
				p.plan.Stats.Unresolved++
				continue
			}
			want := p.final(before)
			expected[i] = want
			if resolve(p.post, r.Kind, r.Path, from) == want {
				continue
			}
			text, ok := p.respell(r, before, want, from)
			if !ok {
				p.errorf("%s:%d: no way to write a link to %s from %s", f, r.Line, want, from)
				continue
			}
			edits = append(edits, splice{start: r.Start, end: r.End, text: text})
			report = append(report, LinkEdit{Line: r.Line, Old: r.Path, New: text})
		}
		updated := content
		if len(edits) > 0 {
			updated = applySplices(content, edits)
			p.plan.Stats.Rewritten += len(edits)
		}

		after := scanLinks(updated)
		if len(after) != len(refs) {
			p.errorf("%s: rewriting changed the number of links (%d → %d)", f, len(refs), len(after))
		} else {
			for i, r := range after {
				if expected[i] == "" {
					continue
				}
				if got := resolve(p.post, r.Kind, r.Path, from); got != expected[i] {
					p.errorf("%s:%d: %q would point to %q instead of %q", f, r.Line, r.Path, got, expected[i])
				}
			}
		}

		switch {
		case moving:
			p.plan.Ops.Writes = append(p.plan.Ops.Writes, FileWrite{Path: to, Content: updated, Source: f, SourceETag: ETag(content)})
			p.plan.Ops.Deletes = append(p.plan.Ops.Deletes, FileDelete{Path: f, ETag: ETag(content)})
		case len(edits) > 0:
			p.plan.Ops.Writes = append(p.plan.Ops.Writes, FileWrite{Path: f, Content: updated, Source: f, SourceETag: ETag(content)})
		}
		if len(report) > 0 {
			fe := FileEdit{Path: from, Links: report}
			if moving {
				fe.From = f
			}
			p.plan.Edits = append(p.plan.Edits, fe)
		}
	}
	return nil
}

// planEmptyDirs removes the folders that held moved or merged files and
// have nothing left in them.
func (p *planner) planEmptyDirs(postFiles []string) {
	occupied := map[string]bool{}
	for _, f := range postFiles {
		for d := dirOf(f); d != ""; d = dirOf(d) {
			occupied[d] = true
		}
	}
	candidates := map[string]bool{}
	for from := range p.moved {
		for d := dirOf(from); d != ""; d = dirOf(d) {
			candidates[d] = true
		}
	}
	for from := range p.merged {
		for d := dirOf(from); d != ""; d = dirOf(d) {
			candidates[d] = true
		}
	}
	var dirs []string
	for d := range candidates {
		if occupied[d] || !p.onlyJunkLeft(d, candidates) {
			continue
		}
		dirs = append(dirs, d)
	}
	sort.Slice(dirs, func(i, j int) bool {
		if a, b := strings.Count(dirs[i], "/"), strings.Count(dirs[j], "/"); a != b {
			return a > b
		}
		return dirs[i] < dirs[j]
	})
	p.plan.RemovedDirs = dirs
	p.plan.Ops.Dirs = dirs
}

// onlyJunkLeft reports whether a folder holds nothing but files the
// workspace never shows (.DS_Store) and folders that are also going away.
// Any other hidden file means someone keeps data there, so the folder stays.
func (p *planner) onlyJunkLeft(d string, going map[string]bool) bool {
	entries, err := os.ReadDir(filepath.Join(p.ws.Root, filepath.FromSlash(d)))
	if err != nil {
		return false
	}
	for _, e := range entries {
		name := e.Name()
		switch {
		case name == ".DS_Store":
		case e.IsDir() && going[d+"/"+name]:
		case !strings.HasPrefix(name, ".") && p.exists[d+"/"+name]:
			// A visible file; occupancy already says whether it stays.
		default:
			return false
		}
	}
	return true
}

func (p *planner) digest() string {
	h := sha256.New()
	for _, w := range p.plan.Ops.Writes {
		fmt.Fprintf(h, "W %s %s %s %s\n", w.Path, ETag(w.Content), w.Source, w.SourceETag)
	}
	for _, d := range p.plan.Ops.Deletes {
		fmt.Fprintf(h, "D %s %s\n", d.Path, d.ETag)
	}
	for _, s := range p.plan.Ops.Side {
		fmt.Fprintf(h, "S %s %t %s\n", s.Path, s.Delete, ETag(s.Content))
	}
	for _, d := range p.plan.Ops.Dirs {
		fmt.Fprintf(h, "R %s\n", d)
	}
	return fmt.Sprintf("%x", h.Sum(nil))[:16]
}
