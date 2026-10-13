package pipeline

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/kiwifs/kiwifs/internal/refactor"
	"github.com/kiwifs/kiwifs/internal/search"
	"github.com/kiwifs/kiwifs/internal/storage"
	"github.com/kiwifs/kiwifs/internal/versioning"
)

func refactorFixture(t *testing.T) (*Pipeline, string) {
	t.Helper()
	dir := t.TempDir()
	files := map[string]string{
		"old/_index.md":     "[[old/page|Page]]\n",
		"old/page.md":       "# Page\n",
		"index.md":          "[[old/page|Page]] [[old/_index|Old]]\n",
		".me/progress.json": `{"old/page.md":{"done":true}}`,
	}
	for p, c := range files {
		abs := filepath.Join(dir, filepath.FromSlash(p))
		if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(abs, []byte(c), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	store, err := storage.NewLocal(dir)
	if err != nil {
		t.Fatal(err)
	}
	return New(store, versioning.NewNoop(), search.NewGrep(dir), nil, nil, nil, dir), dir
}

func buildRefactor(t *testing.T, p *Pipeline, dir, manifest string) *refactor.Plan {
	t.Helper()
	m, err := refactor.ParseManifest([]byte(manifest))
	if err != nil {
		t.Fatal(err)
	}
	plan, err := refactor.BuildPlan(context.Background(), refactor.Workspace{Root: dir, Store: p.Store}, m)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Errors) > 0 {
		t.Fatalf("plan errors: %v", plan.Errors)
	}
	return plan
}

func readFile(t *testing.T, dir, p string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(p)))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestApplyRefactorMovesRelinksAndMigratesState(t *testing.T) {
	p, dir := refactorFixture(t)
	plan := buildRefactor(t, p, dir, "moves:\n  - from: old\n    to: new/\ndelete_empty_dirs: true\n")
	if refactor.ETag([]byte("x")) != ETag([]byte("x")) {
		t.Fatal("refactor.ETag and pipeline.ETag disagree")
	}

	res, err := p.ApplyRefactor(context.Background(), plan, "test")
	if err != nil {
		t.Fatal(err)
	}
	if res.Written != 3 || res.Deleted != 2 || res.Dirs != 1 {
		t.Fatalf("result = %+v", res)
	}
	if got := readFile(t, dir, "index.md"); got != "[[new/page|Page]] [[new/_index|Old]]\n" {
		t.Fatalf("index.md = %q", got)
	}
	if got := readFile(t, dir, "new/_index.md"); got != "[[new/page|Page]]\n" {
		t.Fatalf("new/_index.md = %q", got)
	}
	if got := readFile(t, dir, ".me/progress.json"); got != `{"new/page.md":{"done":true}}` {
		t.Fatalf("progress = %q", got)
	}
	if _, err := os.Stat(filepath.Join(dir, "old")); !os.IsNotExist(err) {
		t.Fatalf("old folder still there: %v", err)
	}
}

func TestApplyRefactorRefusesAStalePlan(t *testing.T) {
	p, dir := refactorFixture(t)
	plan := buildRefactor(t, p, dir, "moves:\n  - from: old/page.md\n    to: new/page.md\n")
	if err := os.WriteFile(filepath.Join(dir, "index.md"), []byte("edited meanwhile\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := p.ApplyRefactor(context.Background(), plan, "test")
	if !errors.Is(err, ErrPlanStale) {
		t.Fatalf("err = %v, want ErrPlanStale", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "old/page.md")); err != nil {
		t.Fatal("a stale plan must not move anything")
	}
}

type failingStore struct {
	storage.Storage
	failOn string
}

func (s failingStore) Write(ctx context.Context, path string, content []byte) error {
	if path == s.failOn {
		return errors.New("disk full")
	}
	return s.Storage.Write(ctx, path, content)
}

func TestApplyRefactorRestoresPagesWhenAWriteFails(t *testing.T) {
	p, dir := refactorFixture(t)
	plan := buildRefactor(t, p, dir, "moves:\n  - from: old/page.md\n    to: new/page.md\n")
	before := readFile(t, dir, "index.md")
	p.Store = failingStore{Storage: p.Store, failOn: "old/_index.md"}

	if _, err := p.ApplyRefactor(context.Background(), plan, "test"); err == nil {
		t.Fatal("expected the failing write to abort the refactor")
	}
	if got := readFile(t, dir, "index.md"); got != before {
		t.Fatalf("index.md not restored: %q", got)
	}
	if _, err := os.Stat(filepath.Join(dir, "new/page.md")); !os.IsNotExist(err) {
		t.Fatal("new/page.md should have been rolled back")
	}
	if _, err := os.Stat(filepath.Join(dir, "old/page.md")); err != nil {
		t.Fatal("old/page.md must still exist")
	}
}
