package refactor

import (
	"context"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/bmatcuk/doublestar/v4"
	"github.com/kiwifs/kiwifs/internal/links"
	"github.com/kiwifs/kiwifs/internal/markdown"
	"github.com/kiwifs/kiwifs/internal/storage"
)

// Workspace is what a plan reads: pages through Store, and the comment and
// personal-state files under Root that are keyed by page path.
type Workspace struct {
	Root  string
	Store storage.Storage
	// TypedFields are the frontmatter keys whose values are page references
	// ([links] typed_fields). Nil means links.DefaultTypedLinkFields.
	TypedFields []string
}

func (ws Workspace) typedFields() []string {
	if ws.TypedFields == nil {
		return links.DefaultTypedLinkFields()
	}
	return ws.TypedFields
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
	Digest string       `json:"digest"`
	Moves  []PathChange `json:"moves"`
	Merges []PathChange `json:"merges"`
	Edits  []FileEdit   `json:"edits"`
	// ContentEdits lists the pages whose content the manifest's edits
	// change, and how.
	ContentEdits []ContentEdit `json:"content_edits,omitempty"`
	Comments     []PathChange  `json:"comments,omitempty"`
	State        []StateEdit   `json:"state,omitempty"`
	RemovedDirs  []string      `json:"removed_dirs,omitempty"`
	Errors       []string      `json:"errors,omitempty"`
	// Base is HEAD when the plan was built (informational: drift is
	// detected per file by ETag, not by HEAD). ManifestHash identifies the
	// request. Neither is part of the digest.
	Base         string `json:"base,omitempty"`
	ManifestHash string `json:"manifest_hash,omitempty"`
	// Client names the tool that asked (an MCP client, the web UI).
	Client string `json:"client,omitempty"`
	// Reverts is the commit a revert plan undoes.
	Reverts string `json:"reverts,omitempty"`
	// Now is the clock the manifest's expressions saw. Pass it back as the
	// manifest's now to apply exactly this plan.
	Now *time.Time `json:"now,omitempty"`
	// Approval says whether an agent needs a human's go-ahead to apply.
	Approval *Approval `json:"approval,omitempty"`
	// Integrity is the link health the plan leaves behind.
	Integrity *Integrity `json:"integrity,omitempty"`
	// Splits lists the pages split and the pages they become.
	Splits []SplitView `json:"splits,omitempty"`
	// PlanOnly says why the plan, though valid, may not be applied yet
	// (an unconfirmed split).
	PlanOnly []string `json:"plan_only,omitempty"`
	// Rejected names the pages behind errors that are about one page only
	// (a failed validation, an edit that cannot apply). A caller may drop
	// those pages and plan again; any error not listed here is global.
	Rejected []PathError `json:"rejected,omitempty"`
	// Conflicts explains, by code, the destinations that cannot be used.
	// Each one is also in Errors.
	Conflicts []Conflict `json:"conflicts,omitempty"`
	// Warnings do not block the plan but deserve a look before applying.
	Warnings []string `json:"warnings,omitempty"`
	Stats    Stats    `json:"stats"`

	Ops Ops `json:"-"`
}

// PathError is an error that concerns one page.
type PathError struct {
	Path  string `json:"path"`
	Error string `json:"error"`
}

// Reject records an error about one page, in Errors and in Rejected.
func (p *Plan) Reject(path, msg string) {
	p.Errors = append(p.Errors, msg)
	p.Rejected = append(p.Rejected, PathError{Path: path, Error: msg})
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
	// Prior is Source's content at plan time, for diffs. Edited marks a
	// page whose content the manifest's edits changed (not just links),
	// which is validated like any content write.
	Prior  []byte
	Edited bool
}

type FileDelete struct {
	Path string
	ETag string
}

type SideWrite struct {
	Path    string
	Content []byte
	Delete  bool
	// Precondition, when set, is what the file must hold right before the
	// write (a revert puts back what a restructuring replaced only if
	// nothing has touched it since).
	Precondition *SideImage
}

// SideImage is a comment or personal-state file's state at one moment.
type SideImage struct {
	Existed bool   `json:"existed"`
	Content []byte `json:"content,omitempty"`
}

// ETag is the git blob hash of content. It matches pipeline.ETag, which is
// what apply compares against.
func ETag(content []byte) string {
	h := sha1.New()
	fmt.Fprintf(h, "blob %d\x00", len(content))
	h.Write(content)
	return fmt.Sprintf("%x", h.Sum(nil))
}

// Options adjust how a plan is built. The zero value is what every caller
// that restructures content wants.
type Options struct {
	// LeaveLinks moves files without respelling any reference to them. It
	// exists for the legacy rename endpoints' update_links=false; the plan
	// still carries ETags, side-file migration and a single commit.
	LeaveLinks bool
	// Actor is who will apply the plan. Claims held by anyone else block
	// moving or merging the claimed page and warn when only its links change.
	Actor string
	// Claims maps a page path to the actor holding an active claim on it.
	Claims map[string]string
	// Client is recorded on the plan and in the commit trailers.
	Client string
	// Select resolves an edit's select.query. Without it, query selection
	// is an error.
	Select SelectFunc
	// Now is the clock expressions see when the manifest pins none.
	// Zero means the current time.
	Now time.Time
	// Policy is the workspace's standing rules ([refactor] in config).
	Policy Policy
	// RequireApproval makes applying a plan over the policy's limits
	// need a human: Approved (the user said yes in the agent's client) or
	// an approval recorded for the digest. Set for agent callers.
	RequireApproval bool
	Approved        bool
	// FieldOwners, when set, names the managers other than manager who own
	// frontmatter keys an edit would change; such pages are rejected unless
	// the edit forces.
	FieldOwners func(path string, before, after []byte, manager string) []string
}

type planner struct {
	ws      Workspace
	opts    Options
	plan    *Plan
	files   []string
	exists  map[string]bool
	moved   map[string]string // old path → new path
	merged  map[string]string // merged-away path → the page it went into, after moves
	pre     *links.PathIndex
	post    *links.PathIndex
	content map[string][]byte
	// edited is a page's content after the manifest's edits, before
	// relinking; editNotes says what changed.
	edited    map[string][]byte
	editNotes map[string][]string
	// steps are the manifest's compiled edits; envs caches expression
	// environments; now is the clock expressions see.
	steps []*editStep
	envs  map[string]map[string]any
	now   time.Time
	// relinked maps a path that no longer exists to where its file went
	// (manifest relinks); the pre-change index still knows the old path.
	relinked map[string]string
	// created maps a page a split creates to the page it comes from;
	// splitPages are their contents before relinking.
	created    map[string]string
	splitPages []splitSection
	// sections maps a page being split to its heading anchors (anchorKey)
	// and the new page each section becomes.
	sections map[string]map[string]string
	// Link tallies for the integrity report.
	inboundBefore   map[string]int
	inboundAfter    map[string]int
	unresolvedAfter int
	partial         bool // some pages were not read
}

func (p *planner) errorf(format string, args ...any) {
	p.plan.Errors = append(p.plan.Errors, fmt.Sprintf(format, args...))
}

// final is where a page's references should point after the refactor.
// sectionTarget is the page a page#heading reference reaches after its
// section was split out of target, or "".
func (p *planner) sectionTarget(target string, r linkRef) string {
	if r.Frag == "" || p.sections == nil {
		return ""
	}
	return p.sections[target][anchorKey(r.Frag)]
}

func (p *planner) final(path string) string {
	if to, ok := p.moved[path]; ok {
		return to
	}
	if to, ok := p.relinked[path]; ok {
		return to
	}
	if to, ok := p.merged[path]; ok {
		return to
	}
	return path
}

// BuildPlan computes the restructuring m describes, without writing.
func BuildPlan(ctx context.Context, ws Workspace, m *Manifest) (*Plan, error) {
	return BuildPlanWith(ctx, ws, m, Options{})
}

// BuildPlanWith is BuildPlan with options.
func BuildPlanWith(ctx context.Context, ws Workspace, m *Manifest, opts Options) (*Plan, error) {
	files, err := listFiles(ctx, ws.Store)
	if err != nil {
		return nil, err
	}
	p := &planner{
		ws:      ws,
		opts:    opts,
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
	if err := p.expandRelinks(m.Relinks); err != nil {
		return nil, err
	}
	preFiles := files
	if len(p.relinked) > 0 {
		preFiles = append(append([]string(nil), files...), sortedMapKeys(p.relinked)...)
	}
	p.pre = links.BuildPathIndex(preFiles)
	switch {
	case m.Now != nil:
		p.now = m.Now.UTC()
	case !opts.Now.IsZero():
		p.now = opts.Now.UTC()
	default:
		p.now = time.Now().UTC().Truncate(time.Second)
	}
	if usesExpressions(m) {
		now := p.now
		p.plan.Now = &now
	}

	p.expandMoves(m.Moves)
	if err := p.selectEdits(ctx, m); err != nil {
		return nil, err
	}
	p.expandMerges(m.Merges)
	p.created = map[string]string{}
	if p.edited == nil {
		p.edited = map[string][]byte{}
		p.editNotes = map[string][]string{}
	}
	if err := p.expandSplits(ctx, m.Split); err != nil {
		return nil, err
	}
	postFiles := p.checkDestinations()
	p.checkClaims()
	if err := p.planEdits(ctx, m); err != nil {
		return nil, err
	}
	if len(p.plan.Errors) > 0 {
		p.plan.Ops = Ops{}
		return p.plan, nil
	}

	p.post = links.BuildPathIndex(postFiles)
	if err := p.rewritePages(ctx); err != nil {
		return nil, err
	}
	if len(p.plan.Errors) > 0 {
		p.plan.Ops = Ops{}
		return p.plan, nil
	}
	p.dropOverwrittenDeletes()
	p.enforcePolicy()
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
	p.warnClaimedEdits()
	if fm := strings.TrimPrefix(opts.Policy.FolderMap, "/"); fm != "" {
		if content, err := ws.Store.Read(ctx, fm); err == nil {
			p.warnUnmappedFolders(ParseFolderMap(content))
		} else {
			p.plan.Warnings = append(p.plan.Warnings, fmt.Sprintf("folder map %s is missing", fm))
		}
	}
	if len(p.plan.Errors) > 0 {
		p.plan.Ops = Ops{}
		return p.plan, nil
	}
	p.plan.Approval = p.approval()
	p.plan.Integrity = p.integrity(!p.partial && !opts.LeaveLinks)
	p.plan.Digest = p.digest()
	p.plan.ManifestHash = manifestHash(m)
	p.plan.Client = opts.Client
	return p.plan, nil
}

// expandRelinks records, for each relink, the old paths that should now
// resolve to existing files. The old path must be gone and the new one
// present: a relink never moves anything.
func (p *planner) expandRelinks(relinks []Move) error {
	if len(relinks) == 0 {
		return nil
	}
	p.relinked = map[string]string{}
	for _, r := range relinks {
		from, _, err := cleanPath(r.From)
		if err != nil || from == "" {
			p.errorf("relink from %q: invalid path", r.From)
			continue
		}
		to, _, err := cleanPath(r.To)
		if err != nil || to == "" {
			p.errorf("relink to %q: invalid path", r.To)
			continue
		}
		switch {
		case p.exists[from]:
			p.errorf("relink %s: it still exists; use a move instead", from)
		case p.exists[to]:
			p.relinked[from] = to
		default:
			prefix := to + "/"
			n := 0
			for _, f := range p.files {
				if strings.HasPrefix(f, prefix) {
					old := joinDir(from, strings.TrimPrefix(f, prefix))
					if !p.exists[old] {
						p.relinked[old] = f
						n++
					}
				}
			}
			if n == 0 {
				p.errorf("relink %s → %s: %s does not exist", from, to, to)
			}
		}
	}
	return nil
}

func sortedMapKeys(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func usesExpressions(m *Manifest) bool {
	for _, e := range m.Edits {
		if e.When != "" || e.MoveTo != "" || len(e.Compute) > 0 {
			return true
		}
	}
	return false
}

func manifestHash(m *Manifest) string {
	data, _ := json.Marshal(m)
	return fmt.Sprintf("%x", sha256.Sum256(data))[:16]
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
		if mv.FromRegex != "" {
			if mv.From != "" {
				p.errorf("move %q: give from or from_regex, not both", mv.From)
				continue
			}
			p.expandRegexMove(mv)
			continue
		}
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
		case strings.ContainsAny(from, "*?[{"):
			if !toDir {
				p.errorf("move %s: a glob needs a destination folder ending in /", from)
				continue
			}
			if !doublestar.ValidatePattern(from) {
				p.errorf("move %s: invalid glob", from)
				continue
			}
			// Each match keeps its path below the glob's fixed prefix, so
			// notes/**/*.md → archive/ keeps subfolders instead of
			// flattening them into collisions.
			base, _ := doublestar.SplitPattern(from)
			if base == "." {
				base = ""
			}
			n := 0
			for _, f := range p.files {
				if ok, _ := doublestar.Match(from, f); ok {
					rel := f
					if base != "" {
						rel = strings.TrimPrefix(f, base+"/")
					}
					p.addMove(f, joinDir(to, rel))
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
			p.checkFolderMove(from, to)
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

// regexMaxLen bounds a from_regex. Go's RE2 engine is linear-time, so the
// limit only keeps manifests readable and compile cost trivial.
const regexMaxLen = 1024

func (p *planner) expandRegexMove(mv Move) {
	if len(mv.FromRegex) > regexMaxLen {
		p.errorf("move from_regex: longer than %d bytes", regexMaxLen)
		return
	}
	re, err := regexp.Compile(`^(?:` + mv.FromRegex + `)$`)
	if err != nil {
		p.errorf("move from_regex %q: %v", mv.FromRegex, err)
		return
	}
	n := 0
	for _, f := range p.files {
		m := re.FindStringSubmatchIndex(f)
		if m == nil {
			continue
		}
		n++
		expanded := string(re.ExpandString(nil, mv.To, f, m))
		to, toDir, err := cleanPath(expanded)
		if err != nil {
			p.errorf("move %s: destination %q: %v", f, expanded, err)
			continue
		}
		if toDir || to == "" {
			to = joinDir(to, path.Base(f))
		}
		p.addMove(f, to)
	}
	if n == 0 {
		p.errorf("move from_regex %q: no file matches", mv.FromRegex)
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
	p, _ := resolveFirm(idx, kind, ref, from)
	return p
}

// resolveFirm is resolve plus whether the match is firm (see
// links.PathIndex.ResolveLinkFirm). Markdown links and kiwi-app src= name a
// path outright, so they are always firm.
func resolveFirm(idx *links.PathIndex, kind linkKind, ref, from string) (string, bool) {
	var p string
	switch kind {
	case kindWiki:
		return idx.ResolveLinkFirm(ref, from)
	case kindAppSrc:
		if target, ok := markdown.ResolveAppSrc(from, ref); ok && target != "" {
			p = idx.LookupExact(target)
		}
	default:
		p = resolveMarkdown(idx, ref, from)
	}
	return p, p != ""
}

func resolveMarkdown(idx *links.PathIndex, ref, from string) string {
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

	if r.Kind == kindAppSrc {
		c := relPath(dirOf(from), target)
		switch {
		case strings.HasPrefix(orig, "/"):
			c = "/" + target
		case strings.HasPrefix(orig, "./") && !strings.HasPrefix(c, "../"):
			c = "./" + c
		}
		if !ok(c) {
			return c, false
		}
		return quoteAppSrc(c, r.Quote)
	}

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
	// A bare name stays bare while it is unambiguous (or the target sits next
	// to the linking page, which wins every tie); a partial path stays
	// relative to the page's folder while the target is still inside it.
	// Anything else becomes the full path: a bare name that only resolves by
	// tie-break, or a suffix guess like "sorting/x", breaks as soon as
	// another folder gains the same name.
	wasFull := strings.EqualFold(trimMD(orig), trimMD(oldTarget))
	if !wasFull {
		var c string
		if !strings.Contains(orig, "/") {
			if p.post.BasenameMatches(target) == 1 || dirOf(target) == dirOf(from) {
				c = spell(target[strings.LastIndex(target, "/")+1:])
			}
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
	p.inboundBefore = map[string]int{}
	p.inboundAfter = map[string]int{}
	for _, f := range p.files {
		if _, ok := p.merged[f]; ok {
			c, err := p.read(ctx, f)
			if err != nil {
				return err
			}
			p.plan.Ops.Deletes = append(p.plan.Ops.Deletes, FileDelete{Path: f, ETag: ETag(c)})
			if isMarkdown(f) {
				for _, r := range scanAll(c, p.ws.typedFields()) {
					if t := resolve(p.pre, r.Kind, r.Path, f); t != "" && t != f {
						p.inboundBefore[t]++
					}
				}
			}
			continue
		}
		to, moving := p.moved[f]
		if !isMarkdown(f) {
			if moving {
				c, err := p.read(ctx, f)
				if err != nil {
					return err
				}
				p.plan.Ops.Writes = append(p.plan.Ops.Writes, FileWrite{Path: to, Content: c, Source: f, SourceETag: ETag(c), Prior: c})
				p.plan.Ops.Deletes = append(p.plan.Ops.Deletes, FileDelete{Path: f, ETag: ETag(c)})
			}
			continue
		}

		_, isEdited := p.edited[f]
		if !moving && !isEdited && len(p.moved) == 0 && len(p.merged) == 0 && len(p.relinked) == 0 && len(p.sections) == 0 {
			// Nothing moves, so no link can change: only edited pages
			// need reading.
			p.partial = true
			continue
		}
		p.plan.Stats.Pages++
		disk, err := p.read(ctx, f)
		if err != nil {
			return err
		}
		content, edited := disk, false
		if e, ok := p.edited[f]; ok {
			content, edited = e, true
		}
		if p.opts.LeaveLinks {
			switch {
			case moving:
				p.plan.Ops.Writes = append(p.plan.Ops.Writes, FileWrite{Path: to, Content: content, Source: f, SourceETag: ETag(disk), Prior: disk, Edited: edited})
				p.plan.Ops.Deletes = append(p.plan.Ops.Deletes, FileDelete{Path: f, ETag: ETag(disk)})
			case edited:
				p.plan.Ops.Writes = append(p.plan.Ops.Writes, FileWrite{Path: f, Content: content, Source: f, SourceETag: ETag(disk), Prior: disk, Edited: true})
			}
			p.noteContentEdit(f, to, moving)
			continue
		}
		from := p.final(f)
		res := p.relink(f, from, content)
		updated := res.updated
		edits := res.report
		written := moving || len(edits) > 0 || edited
		p.tally(res, from, written)

		switch {
		case moving:
			p.plan.Ops.Writes = append(p.plan.Ops.Writes, FileWrite{Path: to, Content: updated, Source: f, SourceETag: ETag(disk), Prior: disk, Edited: edited})
			p.plan.Ops.Deletes = append(p.plan.Ops.Deletes, FileDelete{Path: f, ETag: ETag(disk)})
		case len(edits) > 0 || edited:
			p.plan.Ops.Writes = append(p.plan.Ops.Writes, FileWrite{Path: f, Content: updated, Source: f, SourceETag: ETag(disk), Prior: disk, Edited: edited})
		}
		p.noteContentEdit(f, to, moving)
		if len(edits) > 0 {
			fe := FileEdit{Path: from, Links: edits}
			if moving {
				fe.From = f
			}
			p.plan.Edits = append(p.plan.Edits, fe)
		}
	}
	p.writeSplitPages()
	return nil
}

// relinked is what relinking one page's content produced.
type relinked struct {
	updated []byte
	report  []LinkEdit
	// targets are where the page's links point afterwards ("" for a link
	// that points nowhere), for the integrity tallies.
	targets []string
}

// relink respells every reference in content so it keeps reaching the
// same page after the restructuring, and checks that it does. src is
// where the content was written (references resolve from there, against
// the workspace before); dst is where it lives afterwards. A reference to
// a section of a page being split (page#heading) follows the section to
// its new page.
func (p *planner) relink(src, dst string, content []byte) relinked {
	refs := scanAll(content, p.ws.typedFields())
	expected := make([]string, len(refs))
	var edits []splice
	var report []LinkEdit
	for i, r := range refs {
		p.plan.Stats.Links++
		before, wasFirm := resolveFirm(p.pre, r.Kind, r.Path, src)
		if before == "" {
			p.plan.Stats.Unresolved++
			continue
		}
		if before != src {
			p.inboundBefore[before]++
		}
		want := p.final(before)
		section := p.sectionTarget(before, r)
		if section != "" {
			want = section
		}
		expected[i] = want
		// A link that still lands on the right page is left alone, unless
		// it named the page outright before and now only finds it by a
		// suffix or tie-break guess.
		if got, firm := resolveFirm(p.post, r.Kind, r.Path, dst); section == "" && got == want && (firm || !wasFirm) {
			continue
		}
		if r.Unsplicable {
			p.errorf("%s:%d: frontmatter reference %q to %s is written in a YAML style that cannot be rewritten in place; quote it plainly or edit it first", src, r.Line, r.Path, before)
			continue
		}
		text, ok := p.respell(r, before, want, dst)
		if !ok {
			p.errorf("%s:%d: no way to write a link to %s from %s", src, r.Line, want, dst)
			continue
		}
		end := r.End
		if section != "" {
			// The section is a page now: the fragment goes with it.
			end = r.FragEnd
		}
		edits = append(edits, splice{start: r.Start, end: end, text: text})
		old := r.Path
		if section != "" && r.Frag != "" {
			old += "#" + r.Frag
		}
		report = append(report, LinkEdit{Line: r.Line, Old: old, New: text})
	}
	updated := content
	if len(edits) > 0 {
		updated = applySplices(content, edits)
		p.plan.Stats.Rewritten += len(edits)
	}

	after := scanAll(updated, p.ws.typedFields())
	out := relinked{updated: updated, report: report}
	for _, r := range after {
		if r.Unsplicable {
			continue
		}
		out.targets = append(out.targets, resolve(p.post, r.Kind, r.Path, dst))
	}
	if len(after) != len(refs) {
		p.errorf("%s: rewriting changed the number of links (%d → %d)", src, len(refs), len(after))
		return out
	}
	for i, r := range after {
		if expected[i] == "" {
			continue
		}
		if got := resolve(p.post, r.Kind, r.Path, dst); got != expected[i] {
			p.errorf("%s:%d: %q would point to %q instead of %q", src, r.Line, r.Path, got, expected[i])
		}
	}
	return out
}

// tally counts a relinked page's links for the integrity report.
func (p *planner) tally(res relinked, dst string, written bool) {
	for _, got := range res.targets {
		switch {
		case got == "":
			if written {
				p.unresolvedAfter++
			}
		case got != dst:
			p.inboundAfter[got]++
		}
	}
}

// dropOverwrittenDeletes removes the delete of a moved-away source that
// another move writes into (a swap, or a chain a→b→c): the write replaces
// it, and deleting it after the writes would destroy the incoming page.
func (p *planner) dropOverwrittenDeletes() {
	written := make(map[string]bool, len(p.plan.Ops.Writes))
	for _, w := range p.plan.Ops.Writes {
		written[w.Path] = true
	}
	kept := p.plan.Ops.Deletes[:0]
	for _, d := range p.plan.Ops.Deletes {
		if !written[d.Path] {
			kept = append(kept, d)
		}
	}
	p.plan.Ops.Deletes = kept
}

func (p *planner) noteContentEdit(f, to string, moving bool) {
	notes, ok := p.editNotes[f]
	if !ok {
		return
	}
	ce := ContentEdit{Path: f, Changes: notes}
	if moving {
		ce.Path, ce.From = to, f
	}
	p.plan.ContentEdits = append(p.plan.ContentEdits, ce)
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

// claimedByOther returns who else holds path, or "".
func (p *planner) claimedByOther(path string) string {
	if holder, ok := p.opts.Claims[path]; ok && holder != p.opts.Actor {
		return holder
	}
	return ""
}

// checkClaims refuses to move or merge a page someone else has claimed:
// their next write would land at a path that no longer exists.
func (p *planner) checkClaims() {
	if len(p.opts.Claims) == 0 {
		return
	}
	for _, mv := range p.plan.Moves {
		if who := p.claimedByOther(mv.From); who != "" {
			p.errorf("%s is claimed by %s; release the claim or wait for it to expire", mv.From, who)
		}
	}
	for _, mg := range p.plan.Merges {
		if who := p.claimedByOther(mg.From); who != "" {
			p.errorf("%s is claimed by %s; release the claim or wait for it to expire", mg.From, who)
		}
	}
}

// warnClaimedEdits flags claimed pages whose links the plan rewrites. The
// holder's next If-Match write fails and re-reads, so nothing is lost, but
// they should know.
func (p *planner) warnClaimedEdits() {
	if len(p.opts.Claims) == 0 {
		return
	}
	for _, e := range p.plan.Edits {
		if e.From != "" {
			continue
		}
		if who := p.claimedByOther(e.Path); who != "" {
			p.plan.Warnings = append(p.plan.Warnings, fmt.Sprintf("%s is claimed by %s; its links will change under them", e.Path, who))
		}
	}
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
		if pre := s.Precondition; pre != nil {
			fmt.Fprintf(h, "P %t %s\n", pre.Existed, ETag(pre.Content))
		}
	}
	for _, d := range p.plan.Ops.Dirs {
		fmt.Fprintf(h, "R %s\n", d)
	}
	return fmt.Sprintf("%x", h.Sum(nil))[:16]
}

// LinkResolver resolves pages' links against one snapshot of the
// workspace's file list, the way plans do.
type LinkResolver struct {
	idx   *links.PathIndex
	typed []string
}

// NewLinkResolver lists the workspace once.
func NewLinkResolver(ctx context.Context, ws Workspace) (*LinkResolver, error) {
	files, err := listFiles(ctx, ws.Store)
	if err != nil {
		return nil, err
	}
	return &LinkResolver{idx: links.BuildPathIndex(files), typed: ws.typedFields()}, nil
}

// OutLinks lists the paths the page at path (with content) links to, each
// once, in order; links that point nowhere are left out.
func (r *LinkResolver) OutLinks(path string, content []byte) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, ref := range scanAll(content, r.typed) {
		if ref.Unsplicable {
			continue
		}
		if t := resolve(r.idx, ref.Kind, ref.Path, path); t != "" && !seen[t] {
			seen[t] = true
			out = append(out, t)
		}
	}
	return out
}
