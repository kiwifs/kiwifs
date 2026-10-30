package refactor

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kiwifs/kiwifs/internal/storage"
)

func writeTree(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	for p, c := range files {
		abs := filepath.Join(dir, filepath.FromSlash(p))
		if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(abs, []byte(c), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func plan(t *testing.T, dir, manifest string) *Plan {
	t.Helper()
	m, err := ParseManifest([]byte(manifest))
	if err != nil {
		t.Fatal(err)
	}
	store, err := storage.NewLocal(dir)
	if err != nil {
		t.Fatal(err)
	}
	p, err := BuildPlan(context.Background(), Workspace{Root: dir, Store: store}, m)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func written(t *testing.T, p *Plan, path string) string {
	t.Helper()
	for _, w := range p.Ops.Writes {
		if w.Path == path {
			return string(w.Content)
		}
	}
	t.Fatalf("plan does not write %s; writes: %v", path, writePaths(p))
	return ""
}

func writePaths(p *Plan) []string {
	var out []string
	for _, w := range p.Ops.Writes {
		out = append(out, w.Path)
	}
	return out
}

func requireNoErrors(t *testing.T, p *Plan) {
	t.Helper()
	if len(p.Errors) > 0 {
		t.Fatalf("plan errors:\n%s", strings.Join(p.Errors, "\n"))
	}
}

func TestScanSkipsFrontmatterAndCode(t *testing.T) {
	content := "---\ncompanies: [[google, 2]]\n---\n" +
		"Read [[real]] first.\n\n" +
		"```widget:live\nvar grid = [[a]];\n```\n\n" +
		"  ~~~\n  [[indented-fence]]\n  ~~~\n\n" +
		"Inline `[[code]]` is text.\n\n" +
		"| Problem |\n|---|\n| [[table/page\\|Label]] |\n\n" +
		"See [the doc](../docs/guide.md#setup) and [site](https://example.com/x.md).\n"
	var got []string
	for _, r := range scanLinks([]byte(content)) {
		got = append(got, r.Path)
	}
	want := []string{"real", "table/page", "../docs/guide.md"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("refs = %v, want %v", got, want)
	}
}

func TestMoveRewritesEveryLinkForm(t *testing.T) {
	dir := writeTree(t, map[string]string{
		"a/x.md": "# X\n",
		"c/page.md": "Full [[a/x|X]].\n" +
			"| Row |\n|---|\n| [[a/x\\|X]] |\n" +
			"Relative [[../a/x]].\n" +
			"Markdown [x](../a/x.md#h).\n" +
			"Bare [[x]] stays unique.\n" +
			"Anchor [[a/x#Heading|X]].\n" +
			"Code `[[a/x]]` is left alone.\n",
	})
	p := plan(t, dir, "moves:\n  - from: a/x.md\n    to: z/q/x.md\n")
	requireNoErrors(t, p)
	got := written(t, p, "c/page.md")
	want := "Full [[z/q/x|X]].\n" +
		"| Row |\n|---|\n| [[z/q/x\\|X]] |\n" +
		"Relative [[../z/q/x]].\n" +
		"Markdown [x](../z/q/x.md#h).\n" +
		"Bare [[x]] stays unique.\n" +
		"Anchor [[z/q/x#Heading|X]].\n" +
		"Code `[[a/x]]` is left alone.\n"
	if got != want {
		t.Fatalf("got:\n%s\nwant:\n%s", got, want)
	}
	if written(t, p, "z/q/x.md") != "# X\n" {
		t.Fatal("moved page content changed")
	}
	if len(p.Ops.Deletes) != 1 || p.Ops.Deletes[0].Path != "a/x.md" {
		t.Fatalf("deletes = %+v", p.Ops.Deletes)
	}
}

func TestBareNameIsQualifiedWhenTheMoveMakesItAmbiguous(t *testing.T) {
	dir := writeTree(t, map[string]string{
		"a/x.md":       "target\n",
		"deep/er/x.md": "other\n",
		"c/page.md":    "[[x]]\n",
	})
	p := plan(t, dir, "moves:\n  - from: a/x.md\n    to: deep/zz/yy/x.md\n")
	requireNoErrors(t, p)
	if got := written(t, p, "c/page.md"); got != "[[deep/zz/yy/x]]\n" {
		t.Fatalf("got %q", got)
	}
}

func TestPartialPathStaysFolderRelativeOnlyInsideTheFolder(t *testing.T) {
	dir := writeTree(t, map[string]string{
		"ch/_index.md": "[[old/a]] and [[old/b]]\n",
		"ch/old/a.md":  "a\n",
		"ch/old/b.md":  "b\n",
	})
	p := plan(t, dir, "moves:\n  - from: ch/old/a.md\n    to: ch/new/a.md\n  - from: ch/old/b.md\n    to: other/b.md\n")
	requireNoErrors(t, p)
	if got := written(t, p, "ch/_index.md"); got != "[[new/a]] and [[other/b]]\n" {
		t.Fatalf("got %q", got)
	}
}

func TestMovedPageRelativeLinksAreRecomputed(t *testing.T) {
	dir := writeTree(t, map[string]string{
		"a/p.md":   "[[./sib]] and [s](sib.md) and [[a/sib]]\n",
		"a/sib.md": "sib\n",
	})
	p := plan(t, dir, "moves:\n  - from: a/p.md\n    to: b/p.md\n")
	requireNoErrors(t, p)
	if got := written(t, p, "b/p.md"); got != "[[../a/sib]] and [s](../a/sib.md) and [[a/sib]]\n" {
		t.Fatalf("got %q", got)
	}
}

func TestFolderMoveKeepsInternalLinksAndRemovesEmptyFolder(t *testing.T) {
	dir := writeTree(t, map[string]string{
		"ch/old/_index.md": "[[ch/old/one|One]] [o](one.md)\n",
		"ch/old/one.md":    "[[_index]]\n",
		"ch/_index.md":     "[[ch/old/_index|Old]] [[ch/old/one|One]]\n",
	})
	p := plan(t, dir, "moves:\n  - from: ch/old\n    to: new/sec/\ndelete_empty_dirs: true\n")
	requireNoErrors(t, p)
	if got := written(t, p, "new/sec/_index.md"); got != "[[new/sec/one|One]] [o](one.md)\n" {
		t.Fatalf("index got %q", got)
	}
	if got := written(t, p, "ch/_index.md"); got != "[[new/sec/_index|Old]] [[new/sec/one|One]]\n" {
		t.Fatalf("parent got %q", got)
	}
	if strings.Join(p.RemovedDirs, ",") != "ch/old" {
		t.Fatalf("removed dirs = %v", p.RemovedDirs)
	}
}

func TestMergeRetargetsLinksCommentsAndState(t *testing.T) {
	dir := writeTree(t, map[string]string{
		"a/one.md":                     "keep\n",
		"b/one.md":                     "drop\n",
		"c/page.md":                    "[[a/one|A]] [[b/one|B]]\n",
		".me/progress.json":            `{"a/one.md":{"done":true},"b/one.md":{"done":false},"c/page.md":{"done":true}}` + "\n",
		".me/reviews.json":             "{\n  \"perDay\": 8,\n  \"items\": {\n    \"b/one.md\": {\n      \"box\": 2\n    }\n  }\n}\n",
		".kiwi/comments/a/one.md.json": `[{"id":"1","path":"a/one.md","body":"keep"}]`,
		".kiwi/comments/b/one.md.json": `[{"id":"2","path":"b/one.md","body":"moved"}]`,
	})
	p := plan(t, dir, "merges:\n  - from: b/one.md\n    into: a/one.md\n")
	requireNoErrors(t, p)
	if got := written(t, p, "c/page.md"); got != "[[a/one|A]] [[a/one|B]]\n" {
		t.Fatalf("page got %q", got)
	}
	if len(p.Ops.Deletes) != 1 || p.Ops.Deletes[0].Path != "b/one.md" {
		t.Fatalf("deletes = %+v", p.Ops.Deletes)
	}

	side := map[string]SideWrite{}
	for _, s := range p.Ops.Side {
		side[s.Path] = s
	}
	if got := string(side[".me/progress.json"].Content); got != `{"a/one.md":{"done":true},"c/page.md":{"done":true}}`+"\n" {
		t.Fatalf("progress got %s", got)
	}
	if got := string(side[".me/reviews.json"].Content); got != "{\n  \"perDay\": 8,\n  \"items\": {\n    \"a/one.md\": {\n      \"box\": 2\n    }\n  }\n}\n" {
		t.Fatalf("reviews got %s", got)
	}
	if !side[".kiwi/comments/b/one.md.json"].Delete {
		t.Fatal("old comment file not deleted")
	}
	merged := string(side[".kiwi/comments/a/one.md.json"].Content)
	if !strings.Contains(merged, `"body": "keep"`) || !strings.Contains(merged, `"body": "moved"`) ||
		strings.Contains(merged, `"b/one.md"`) {
		t.Fatalf("merged comments = %s", merged)
	}
	var conflicts []string
	for _, s := range p.State {
		conflicts = append(conflicts, s.Conflicts...)
	}
	if len(conflicts) != 1 || !strings.HasPrefix(conflicts[0], "a/one.md") {
		t.Fatalf("conflicts = %v", conflicts)
	}
}

func TestMergeIntoAPageThatAlsoMoves(t *testing.T) {
	dir := writeTree(t, map[string]string{
		"old/sort.md":   "a\n",
		"heaps/sort.md": "b\n",
		"x.md":          "[[old/sort|S1]] [[heaps/sort|S2]]\n",
	})
	p := plan(t, dir, "moves:\n  - from: heaps/sort.md\n    to: sorting/sort.md\nmerges:\n  - from: old/sort.md\n    into: heaps/sort.md\n")
	requireNoErrors(t, p)
	if got := written(t, p, "x.md"); got != "[[sorting/sort|S1]] [[sorting/sort|S2]]\n" {
		t.Fatalf("got %q", got)
	}
}

func TestPlanRejectsCollisions(t *testing.T) {
	dir := writeTree(t, map[string]string{"a.md": "a\n", "b.md": "b\n", "B2.md": "c\n"})
	p := plan(t, dir, "moves:\n  - from: a.md\n    to: b.md\n  - from: B2.md\n    to: A.md\n")
	if len(p.Errors) == 0 {
		t.Fatal("expected errors")
	}
	if len(p.Ops.Writes) != 0 || p.Digest != "" {
		t.Fatal("a plan with errors must not carry operations")
	}
}

func TestGlobMoveAndUnknownKeys(t *testing.T) {
	dir := writeTree(t, map[string]string{"n/a-sort.md": "1\n", "n/b-sort.md": "2\n", "n/c.md": "3\n"})
	p := plan(t, dir, "moves:\n  - from: n/*-sort.md\n    to: s/\n")
	requireNoErrors(t, p)
	if len(p.Moves) != 2 || p.Moves[0].To != "s/a-sort.md" {
		t.Fatalf("moves = %+v", p.Moves)
	}
	if _, err := ParseManifest([]byte("moves:\n  - form: a\n    to: b\n")); err == nil {
		t.Fatal("expected unknown-key error")
	}
}

func TestBrokenLinksAreLeftAlone(t *testing.T) {
	dir := writeTree(t, map[string]string{"a.md": "x\n", "p.md": "[[nowhere]] [[a]]\n"})
	p := plan(t, dir, "moves:\n  - from: a.md\n    to: d/a.md\n")
	requireNoErrors(t, p)
	for _, w := range p.Ops.Writes {
		if w.Path == "p.md" {
			t.Fatalf("p.md rewritten to %q; [[a]] still resolves and [[nowhere]] never did", w.Content)
		}
	}
	if p.Stats.Unresolved != 1 {
		t.Fatalf("unresolved = %d", p.Stats.Unresolved)
	}
}

func TestFrontmatterTypedLinksFollowAMove(t *testing.T) {
	dir := writeTree(t, map[string]string{
		"old/x.md": "# X\n",
		"y.md":     "# Y\n",
		"note.md": "---\ntitle: Tïtle\n" +
			"supersedes: [[old/x]]\n" +
			"contradicts: \"[[old/x|the x]]\"\n" +
			"superseded_by:\n  - 'old/x.md'\n  - y\n" +
			"related: [[old/x]]\n" +
			"---\nBody [[old/x]]\n",
	})
	p := plan(t, dir, "moves: [{from: old/x.md, to: new/x.md}]")
	requireNoErrors(t, p)
	want := "---\ntitle: Tïtle\n" +
		"supersedes: [[new/x]]\n" +
		"contradicts: \"[[new/x|the x]]\"\n" +
		"superseded_by:\n  - 'new/x.md'\n  - y\n" +
		"related: [[old/x]]\n" + // not a typed field: frontmatter text, left alone
		"---\nBody [[new/x]]\n"
	if got := written(t, p, "note.md"); got != want {
		t.Fatalf("note.md =\n%s\nwant\n%s", got, want)
	}
}

func TestUnsplicableTypedLinkBlocksTheMove(t *testing.T) {
	dir := writeTree(t, map[string]string{
		"x.md":    "# X\n",
		"note.md": "---\nsupersedes: >\n  x\n---\n",
	})
	p := plan(t, dir, "moves: [{from: x.md, to: z.md}]")
	if len(p.Errors) == 0 || !strings.Contains(p.Errors[0], "cannot be rewritten") {
		t.Fatalf("errors = %v", p.Errors)
	}
}

func TestDoubleStarGlobKeepsSubfolders(t *testing.T) {
	dir := writeTree(t, map[string]string{
		"notes/a/x.md":   "# x\n",
		"notes/a/b/y.md": "# y\n[[x]]\n",
		"notes/z.txt":    "z\n",
		"index.md":       "[[notes/a/b/y]]\n",
	})
	p := plan(t, dir, "moves: [{from: 'notes/**/*.md', to: archive/}]")
	requireNoErrors(t, p)
	got := map[string]string{}
	for _, mv := range p.Moves {
		got[mv.From] = mv.To
	}
	if len(got) != 2 || got["notes/a/x.md"] != "archive/a/x.md" || got["notes/a/b/y.md"] != "archive/a/b/y.md" {
		t.Fatalf("moves = %v", got)
	}
	if s := written(t, p, "index.md"); s != "[[archive/a/b/y]]\n" {
		t.Fatalf("index.md = %q", s)
	}
}

func TestRegexMoveExpandsCaptures(t *testing.T) {
	dir := writeTree(t, map[string]string{
		"journal/2026-03-01-standup.md": "# s\n",
		"journal/2026-04-02-retro.md":   "# r\n",
		"journal/readme.md":             "[[2026-03-01-standup]]\n",
	})
	p := plan(t, dir, `moves: [{from_regex: 'journal/(?P<y>\d{4})-(\d{2})-.*\.md', to: 'journal/${y}/$2/'}]`)
	requireNoErrors(t, p)
	got := map[string]string{}
	for _, mv := range p.Moves {
		got[mv.From] = mv.To
	}
	if got["journal/2026-03-01-standup.md"] != "journal/2026/03/2026-03-01-standup.md" ||
		got["journal/2026-04-02-retro.md"] != "journal/2026/04/2026-04-02-retro.md" || len(got) != 2 {
		t.Fatalf("moves = %v", got)
	}

	bad := plan(t, dir, `moves: [{from_regex: 'journal/(.*)\.md', to: '../$1.md'}]`)
	if len(bad.Errors) == 0 {
		t.Fatal("a capture that escapes the workspace must be rejected")
	}
	both := plan(t, dir, `moves: [{from: journal/readme.md, from_regex: x, to: y.md}]`)
	if len(both.Errors) == 0 {
		t.Fatal("from and from_regex together must be rejected")
	}
}

func TestConflictCodes(t *testing.T) {
	dir := writeTree(t, map[string]string{
		"a.md":        "a\n",
		"b.md":        "b\n",
		"café.md":     "c\n", // NFC
		"docs/x.md":   "x\n",
		"file.md":     "f\n",
		"folder/y.md": "y\n",
	})
	cases := []struct {
		manifest string
		code     ConflictCode
	}{
		{"moves: [{from: a.md, to: b.md}]", ConflictExists},
		{"moves: [{from: a.md, to: c.md}, {from: b.md, to: c.md}]", ConflictManyToOne},
		{"moves: [{from: a.md, to: B.md}]", ConflictCaseOrNormalization},
		{"moves: [{from: a.md, to: \"café.md\"}]", ConflictCaseOrNormalization}, // NFD
		{"moves: [{from: a.md, to: \"x\\ty.md\"}]", ConflictForbiddenChars},
		{"moves: [{from: a.md, to: \"trailing./a.md\"}]", ConflictTrailingDotOrSpace},
		{"moves: [{from: a.md, to: " + strings.Repeat("n", 256) + ".md}]", ConflictTooLong},
		{"moves: [{from: docs, to: docs/inner}]", ConflictDirCycle},
		{"moves: [{from: a.md, to: file.md/a.md}]", ConflictParentIsFile},
		{"moves: [{from: a.md, to: folder}]", ConflictIsFolder},
	}
	for _, tc := range cases {
		p := plan(t, dir, tc.manifest)
		found := false
		for _, c := range p.Conflicts {
			found = found || c.Code == tc.code
		}
		if !found || len(p.Errors) == 0 || len(p.Ops.Writes) != 0 {
			t.Errorf("%s: want conflict %s, got %+v / %v", tc.manifest, tc.code, p.Conflicts, p.Errors)
		}
	}
}

func TestSwapIsNotAConflict(t *testing.T) {
	dir := writeTree(t, map[string]string{"a.md": "a\n", "b.md": "b\n", "i.md": "[[a]] [[b]]\n"})
	p := plan(t, dir, "moves: [{from: a.md, to: b.md}, {from: b.md, to: a.md}]")
	requireNoErrors(t, p)
	if got := written(t, p, "i.md"); got != "[[b]] [[a]]\n" {
		t.Fatalf("i.md = %q", got)
	}
}

// Obsidian's "links not updating after rename" came from a stale index.
// The planner reads every page from disk, so a page no index has seen yet
// (written a moment ago, or by another tool) is still relinked.
func TestPlanReadsDiskNotTheIndex(t *testing.T) {
	dir := writeTree(t, map[string]string{"x.md": "# X\n"})
	if err := os.WriteFile(filepath.Join(dir, "fresh.md"), []byte("[x](x.md)\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	p := plan(t, dir, "moves: [{from: x.md, to: y/x.md}]")
	requireNoErrors(t, p)
	if got := written(t, p, "fresh.md"); got != "[x](y/x.md)\n" {
		t.Fatalf("fresh.md = %q", got)
	}
}

// Logseq's merge bugs dropped references that carried a fragment. A merge
// retargets heading links and embeds, keeping the fragment and label.
func TestMergeKeepsAnchorsLabelsAndEmbeds(t *testing.T) {
	dir := writeTree(t, map[string]string{
		"faq/dup.md":  "# Dup\n",
		"faq/keep.md": "# Keep\n",
		"page.md":     "[[faq/dup#Install|how]] ![[faq/dup]] [md](faq/dup.md#install)\n",
	})
	p := plan(t, dir, "merges: [{from: faq/dup.md, into: faq/keep.md}]")
	requireNoErrors(t, p)
	if got := written(t, p, "page.md"); got != "[[faq/keep#Install|how]] ![[faq/keep]] [md](faq/keep.md#install)\n" {
		t.Fatalf("page.md = %q", got)
	}
}

func planWith(t *testing.T, dir, manifest string, opts Options) *Plan {
	t.Helper()
	m, err := ParseManifest([]byte(manifest))
	if err != nil {
		t.Fatal(err)
	}
	store, err := storage.NewLocal(dir)
	if err != nil {
		t.Fatal(err)
	}
	p, err := BuildPlanWith(context.Background(), Workspace{Root: dir, Store: store}, m, opts)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestEditsKeepYAMLAndSelectByGlob(t *testing.T) {
	dir := writeTree(t, map[string]string{
		"notes/a.md": "---\n# owner: docs\ntitle:  A   # aligned\ntags: [wip, ml]\nstatus: draft\n---\nBody about Acme Corp and `Acme Corp`.\n",
		"notes/b.md": "---\ntags:\n  - ml\n---\nB\n",
		"other.md":   "---\nstatus: draft\n---\nO\n",
	})
	p := plan(t, dir, `edits:
  - select: {glob: "notes/**"}
    set: {status: archived, priority: 2}
    add_tags: [archived]
    remove_tags: [wip]
    replace: [{find: "Acme Corp", with: "Acme"}]
`)
	requireNoErrors(t, p)
	want := "---\n# owner: docs\ntitle:  A   # aligned\ntags: [ml, archived]\nstatus: archived\npriority: 2\n---\nBody about Acme and `Acme Corp`.\n"
	if got := written(t, p, "notes/a.md"); got != want {
		t.Fatalf("notes/a.md =\n%s\nwant\n%s", got, want)
	}
	if got := written(t, p, "notes/b.md"); got != "---\ntags:\n  - ml\n  - archived\npriority: 2\nstatus: archived\n---\nB\n" {
		t.Fatalf("notes/b.md = %q", got)
	}
	for _, w := range p.Ops.Writes {
		if w.Path == "other.md" {
			t.Fatal("other.md is not selected")
		}
	}
	if len(p.ContentEdits) != 2 || len(p.FileDiffs()) != 2 || !strings.Contains(p.FileDiffs()[0].Diff, "+status: archived") {
		t.Fatalf("content edits = %+v diffs = %+v", p.ContentEdits, p.FileDiffs())
	}
}

func TestEditSelectionSeesThePreMoveSnapshot(t *testing.T) {
	dir := writeTree(t, map[string]string{
		"drafts/x.md": "---\nstatus: draft\n---\nX\n",
		"index.md":    "[[drafts/x]]\n",
	})
	p := plan(t, dir, `moves: [{from: drafts/, to: archive/}]
edits: [{select: {glob: "drafts/*.md"}, set: {status: archived}}]`)
	requireNoErrors(t, p)
	if got := written(t, p, "archive/x.md"); got != "---\nstatus: archived\n---\nX\n" {
		t.Fatalf("archive/x.md = %q", got)
	}
	if got := written(t, p, "index.md"); got != "[[archive/x]]\n" {
		t.Fatalf("index.md = %q", got)
	}
	if len(p.ContentEdits) != 1 || p.ContentEdits[0].From != "drafts/x.md" || p.ContentEdits[0].Path != "archive/x.md" {
		t.Fatalf("content edits = %+v", p.ContentEdits)
	}
}

func TestSelectByQueryIntersectsAndIgnoresMissingPages(t *testing.T) {
	dir := writeTree(t, map[string]string{
		"a.md": "---\nstatus: draft\n---\n",
		"b.md": "---\nstatus: draft\n---\n",
	})
	var asked string
	opts := Options{Select: func(_ context.Context, q string) ([]string, error) {
		asked = q
		// The index still lists a deleted page: it must be ignored.
		return []string{"a.md", "b.md", "gone.md"}, nil
	}}
	p := planWith(t, dir, `edits: [{select: {query: 'status = "draft"', paths: [b.md]}, set: {status: done}}]`, opts)
	requireNoErrors(t, p)
	if asked != `status = "draft"` || len(p.Ops.Writes) != 1 || p.Ops.Writes[0].Path != "b.md" {
		t.Fatalf("asked %q, writes %v", asked, writePaths(p))
	}
	noSelect := plan(t, dir, `edits: [{select: {query: 'x = 1'}, set: {y: 1}}]`)
	if len(noSelect.Errors) == 0 {
		t.Fatal("a query without a selector must be an error")
	}
	empty := plan(t, dir, `edits: [{select: {}, set: {y: 1}}]`)
	if len(empty.Errors) == 0 {
		t.Fatal("an empty selection must be an error")
	}
}

func TestRenameTagsMergesAndWarns(t *testing.T) {
	dir := writeTree(t, map[string]string{
		"a.md": "---\ntags: [ML, python]\n---\nUses #ml and #mlops; `#ml` in code; see page#ml.\n",
		"b.md": "---\ntags: [machine-learning, ml]\n---\n",
		"c.md": "---\ntags: machine-learning\n---\n",
	})
	p := plan(t, dir, "rename_tags: [{from: ml, to: machine-learning}]")
	requireNoErrors(t, p)
	if got := written(t, p, "a.md"); got != "---\ntags: [machine-learning, python]\n---\nUses #machine-learning and #mlops; `#ml` in code; see page#ml.\n" {
		t.Fatalf("a.md = %q", got)
	}
	if got := written(t, p, "b.md"); got != "---\ntags: [machine-learning]\n---\n" {
		t.Fatalf("b.md = %q", got)
	}
	if len(p.Warnings) != 1 || !strings.Contains(p.Warnings[0], `"machine-learning" already exists on 2 pages`) {
		t.Fatalf("warnings = %v", p.Warnings)
	}
}

func TestRegexReplaceSkipsCode(t *testing.T) {
	dir := writeTree(t, map[string]string{
		"a.md": "v1.2 and v3.4\n```\nv5.6\n```\n",
	})
	p := plan(t, dir, `edits: [{select: {paths: [a.md]}, replace: [{find: 'v(\d+)\.(\d+)', with: 'version $1.$2', regex: true}]}]`)
	requireNoErrors(t, p)
	if got := written(t, p, "a.md"); got != "version 1.2 and version 3.4\n```\nv5.6\n```\n" {
		t.Fatalf("a.md = %q", got)
	}
}

func TestPolicyProtectScopeAndFolderMap(t *testing.T) {
	dir := writeTree(t, map[string]string{
		"docs/a.md":        "# A\n",
		"docs/b.md":        "[[a]]\n",
		"legal/terms.md":   "[[docs/a]]\n",
		"_meta/folders.md": "---\nfolders: [docs, archive]\n---\n",
	})
	pol := Policy{Protect: []string{"legal/**"}}
	p := planWith(t, dir, "moves: [{from: docs/a.md, to: archive/a.md}]", Options{Policy: pol})
	if len(p.Rejected) != 1 || p.Rejected[0].Path != "legal/terms.md" || len(p.Ops.Writes) != 0 {
		t.Fatalf("relinking a protected page must be refused: %+v", p.Rejected)
	}
	p = planWith(t, dir, "moves: [{from: docs/b.md, to: elsewhere/b.md}]", Options{Policy: Policy{Scope: "docs"}})
	if len(p.Errors) == 0 || !strings.Contains(p.Errors[0], "outside the refactor scope docs/") {
		t.Fatalf("errors = %v", p.Errors)
	}
	p = planWith(t, dir, "moves: [{from: docs/b.md, to: misc/b.md}]", Options{Policy: Policy{FolderMap: "_meta/folders.md"}})
	requireNoErrors(t, p)
	if len(p.Warnings) != 1 || !strings.Contains(p.Warnings[0], "misc/ is not in the folder map") {
		t.Fatalf("warnings = %v", p.Warnings)
	}
	if got := ParseFolderMap([]byte("# Map\n- `projects/` — active work\n- archive\n* [[people]]\nnot a bullet\n")); strings.Join(got, ",") != "projects,archive,people" {
		t.Fatalf("bullets = %v", got)
	}
}

func TestApprovalAndIntegrity(t *testing.T) {
	dir := writeTree(t, map[string]string{
		"faq/dup.md":       "# Dup\nSee [[only-from-dup]].\n",
		"faq/keep.md":      "# Keep\n",
		"only-from-dup.md": "# Lonely\n",
		"index.md":         "[[faq/dup]] [[nowhere]]\n",
	})
	p := planWith(t, dir, "merges: [{from: faq/dup.md, into: faq/keep.md}]", Options{Policy: Policy{ApprovalFiles: 1}})
	requireNoErrors(t, p)
	if p.Approval == nil || !p.Approval.Required || !strings.Contains(p.Approval.Reason, "files (limit 1)") {
		t.Fatalf("approval = %+v", p.Approval)
	}
	if p.Integrity == nil || !p.Integrity.Complete || p.Integrity.Unresolved != 1 ||
		len(p.Integrity.Orphaned) != 1 || p.Integrity.Orphaned[0] != "only-from-dup.md" {
		t.Fatalf("integrity = %+v", p.Integrity)
	}
}

func TestRelinksRepairAMoveMadeOutsideTheEngine(t *testing.T) {
	// guides/ was renamed to handbook/ by a shell mv: the files are there,
	// every reference still says guides/.
	dir := writeTree(t, map[string]string{
		"handbook/setup.md":   "# Setup\n[next](install.md)\n",
		"handbook/install.md": "# Install\n",
		"index.md":            "[[guides/setup]] and [md](guides/install.md) and [[nowhere]]\n",
	})
	p := plan(t, dir, "relinks: [{from: guides, to: handbook}]")
	requireNoErrors(t, p)
	if got := written(t, p, "index.md"); got != "[[handbook/setup]] and [md](handbook/install.md) and [[nowhere]]\n" {
		t.Fatalf("index.md = %q", got)
	}
	if len(p.Moves) != 0 || len(p.Ops.Deletes) != 0 {
		t.Fatalf("a relink must not move anything: %+v", p.Ops)
	}
	stillThere := plan(t, dir, "relinks: [{from: index.md, to: handbook/setup.md}]")
	if len(stillThere.Errors) == 0 {
		t.Fatal("relinking from a path that exists must be refused")
	}
}

func TestSplitPageByHeadings(t *testing.T) {
	dir := writeTree(t, map[string]string{
		"guides/big.md": "---\ntitle: Big\n---\n# Big guide\n\nIntro, see [install](#install) and [up](../index.md).\n\n" +
			"## Install\n\nRun it.\n\n### On Linux\n\nUse apt. Back to [usage](#usage).\n\n" +
			"## Usage\n\n```\n## not a heading\n```\nSee [[guides/big#Install|install]].\n",
		"index.md": "[[guides/big]] [[guides/big#Usage]] [u](guides/big.md#usage) [i](guides/big.md#nope)\n",
	})
	p := plan(t, dir, "split: [{from: guides/big.md}]")
	requireNoErrors(t, p)
	if len(p.PlanOnly) != 1 || len(p.Splits) != 1 || strings.Join(p.Splits[0].Pages, ",") != "guides/big/install.md,guides/big/usage.md" {
		t.Fatalf("plan only = %v, splits = %+v", p.PlanOnly, p.Splits)
	}
	if got := written(t, p, "guides/big.md"); got != "---\ntitle: Big\n---\n# Big guide\n\nIntro, see [install](big/install.md) and [up](../index.md).\n\n"+
		"- [[guides/big/install|Install]]\n- [[guides/big/usage|Usage]]\n" {
		t.Fatalf("index page =\n%s", got)
	}
	if got := written(t, p, "guides/big/install.md"); got != "# Install\n\nRun it.\n\n## On Linux\n\nUse apt. Back to [usage](usage.md).\n\n" {
		t.Fatalf("install =\n%q", got)
	}
	if got := written(t, p, "guides/big/usage.md"); got != "# Usage\n\n```\n## not a heading\n```\nSee [[guides/big/install|install]].\n" {
		t.Fatalf("usage =\n%q", got)
	}
	if got := written(t, p, "index.md"); got != "[[guides/big]] [[guides/big/usage]] [u](guides/big/usage.md) [i](guides/big.md#nope)\n" {
		t.Fatalf("index.md = %q", got)
	}
	confirmed := plan(t, dir, "split: [{from: guides/big.md, confirm: true}]")
	requireNoErrors(t, confirmed)
	if len(confirmed.PlanOnly) != 0 || confirmed.Digest == "" {
		t.Fatalf("confirmed split = %+v", confirmed.PlanOnly)
	}
}

func TestKiwiAppSrcFollowsMoves(t *testing.T) {
	dir := writeTree(t, map[string]string{
		"guides/queue.md": "# Queue\n\n" +
			"```kiwi-app id=lease src=apps/lease.html\nLoading…\n```\n\n" +
			"```kiwi-app src=\"apps/lease.html\" chrome=full\n```\n\n" +
			"````markdown\n```kiwi-app src=apps/lease.html\n```\n````\n",
		"guides/apps/lease.html": "<div class=\"k-app\"></div>\n",
	})

	p := plan(t, dir, "moves:\n  - from: guides/queue.md\n    to: archive/queue.md\n")
	requireNoErrors(t, p)
	got := written(t, p, "archive/queue.md")
	for _, want := range []string{
		"```kiwi-app id=lease src=../guides/apps/lease.html\n",
		"```kiwi-app src=\"../guides/apps/lease.html\" chrome=full\n",
		// An example inside another fence is text, not an app.
		"````markdown\n```kiwi-app src=apps/lease.html\n```\n````\n",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("missing %q in:\n%s", want, got)
		}
	}

	p = plan(t, dir, "moves:\n  - from: guides/apps/lease.html\n    to: guides/apps/leases.html\n")
	requireNoErrors(t, p)
	if got := written(t, p, "guides/queue.md"); !strings.Contains(got, "src=apps/leases.html") {
		t.Fatalf("src= not rewritten after the app file moved:\n%s", got)
	}
}
