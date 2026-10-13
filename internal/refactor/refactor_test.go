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
