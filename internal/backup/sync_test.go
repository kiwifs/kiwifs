package backup

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestPushRebasesOntoRemoteBeforePush(t *testing.T) {
	root := t.TempDir()
	remote := filepath.Join(root, "remote.git")
	seed := filepath.Join(root, "seed")
	work := filepath.Join(root, "work")
	other := filepath.Join(root, "other")

	runGit(t, root, "init", "--bare", remote)
	cloneAndConfigure(t, remote, seed)
	writeFile(t, seed, "initial.md", "initial\n")
	runGit(t, seed, "add", ".")
	runGit(t, seed, "commit", "-m", "initial")
	runGit(t, seed, "push", "origin", "HEAD:main")

	cloneAndConfigure(t, remote, work)
	cloneAndConfigure(t, remote, other)

	writeFile(t, other, "from-other.md", "other\n")
	runGit(t, other, "add", ".")
	runGit(t, other, "commit", "-m", "other change")
	runGit(t, other, "push", "origin", "main")

	writeFile(t, work, "from-kiwifs.md", "kiwifs\n")
	runGit(t, work, "add", ".")
	runGit(t, work, "commit", "-m", "kiwifs change")

	syncer, err := New(work, remote, "main", "", true)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if err := syncer.Push("main"); err != nil {
		t.Fatalf("Push: %v", err)
	}

	got := runGitOutput(t, work, "log", "--format=%s", "origin/main..HEAD")
	if !strings.Contains(got, "other change") || !strings.Contains(got, "kiwifs change") {
		t.Fatalf("local history does not contain both changes after rebase:\n%s", got)
	}
	remoteHead := strings.TrimSpace(runGitOutput(t, work, "ls-remote", "backup", "refs/heads/main"))
	localHead := strings.TrimSpace(runGitOutput(t, work, "rev-parse", "HEAD"))
	if !strings.HasPrefix(remoteHead, localHead) {
		t.Fatalf("remote HEAD mismatch: remote=%q local=%q", remoteHead, localHead)
	}
}

func TestPushRefusesRebaseWithDirtyWorktree(t *testing.T) {
	root := t.TempDir()
	remote := filepath.Join(root, "remote.git")
	seed := filepath.Join(root, "seed")
	work := filepath.Join(root, "work")
	other := filepath.Join(root, "other")

	runGit(t, root, "init", "--bare", remote)
	cloneAndConfigure(t, remote, seed)
	writeFile(t, seed, "initial.md", "initial\n")
	runGit(t, seed, "add", ".")
	runGit(t, seed, "commit", "-m", "initial")
	runGit(t, seed, "push", "origin", "HEAD:main")

	cloneAndConfigure(t, remote, work)
	cloneAndConfigure(t, remote, other)

	writeFile(t, other, "from-other.md", "other\n")
	runGit(t, other, "add", ".")
	runGit(t, other, "commit", "-m", "other change")
	runGit(t, other, "push", "origin", "main")

	writeFile(t, work, "initial.md", "edited but not committed\n")

	syncer, err := New(work, remote, "main", "", true)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	err = syncer.Push("main")
	if err == nil || !strings.Contains(err.Error(), "uncommitted changes") {
		t.Fatalf("expected dirty worktree error, got %v", err)
	}
}

// Every KiwiFS root carries untracked files (.gitattributes, .kiwi/state).
// They used to count as a dirty worktree, so only the first push succeeded.
func TestPushRebasesWithUntrackedFiles(t *testing.T) {
	root := t.TempDir()
	remote := filepath.Join(root, "remote.git")
	seed := filepath.Join(root, "seed")
	work := filepath.Join(root, "work")
	other := filepath.Join(root, "other")

	runGit(t, root, "init", "--bare", remote)
	cloneAndConfigure(t, remote, seed)
	writeFile(t, seed, "initial.md", "initial\n")
	runGit(t, seed, "add", ".")
	runGit(t, seed, "commit", "-m", "initial")
	runGit(t, seed, "push", "origin", "HEAD:main")

	cloneAndConfigure(t, remote, work)
	cloneAndConfigure(t, remote, other)

	writeFile(t, other, "from-other.md", "other\n")
	runGit(t, other, "add", ".")
	runGit(t, other, "commit", "-m", "other change")
	runGit(t, other, "push", "origin", "main")

	writeFile(t, work, ".gitattributes", "* -text\n")
	writeFile(t, work, filepath.Join(".kiwi", "state", "index.db"), "derived\n")
	writeFile(t, work, "from-kiwifs.md", "kiwifs\n")
	runGit(t, work, "add", "from-kiwifs.md")
	runGit(t, work, "commit", "-m", "kiwifs change")

	syncer, err := New(work, remote, "main", "", true)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if err := syncer.Push("main"); err != nil {
		t.Fatalf("Push with untracked files: %v", err)
	}
	if got := runGitOutput(t, work, "log", "--format=%s", "-2"); !strings.Contains(got, "other change") {
		t.Fatalf("not rebased onto remote:\n%s", got)
	}
	if _, err := os.Stat(filepath.Join(work, ".kiwi", "state", "index.db")); err != nil {
		t.Fatalf("untracked file lost: %v", err)
	}
}

func TestRebaseAbortsWhenUpstreamWouldOverwriteUntracked(t *testing.T) {
	root := t.TempDir()
	remote := filepath.Join(root, "remote.git")
	seed := filepath.Join(root, "seed")
	work := filepath.Join(root, "work")
	other := filepath.Join(root, "other")

	runGit(t, root, "init", "--bare", remote)
	cloneAndConfigure(t, remote, seed)
	writeFile(t, seed, "initial.md", "initial\n")
	runGit(t, seed, "add", ".")
	runGit(t, seed, "commit", "-m", "initial")
	runGit(t, seed, "push", "origin", "HEAD:main")

	cloneAndConfigure(t, remote, work)
	cloneAndConfigure(t, remote, other)

	writeFile(t, other, "notes.md", "theirs\n")
	runGit(t, other, "add", ".")
	runGit(t, other, "commit", "-m", "other adds notes.md")
	runGit(t, other, "push", "origin", "main")

	writeFile(t, work, "notes.md", "local untracked\n")
	writeFile(t, work, "mine.md", "mine\n")
	runGit(t, work, "add", "mine.md")
	runGit(t, work, "commit", "-m", "local change")

	syncer, err := New(work, remote, "main", "", true)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if err := syncer.Push("main"); err == nil {
		t.Fatal("expected the rebase to refuse overwriting an untracked file")
	}
	data, err := os.ReadFile(filepath.Join(work, "notes.md"))
	if err != nil || string(data) != "local untracked\n" {
		t.Fatalf("untracked file changed: %q, %v", data, err)
	}
	if _, statErr := os.Stat(filepath.Join(work, ".git", "rebase-merge")); statErr == nil {
		t.Fatal("rebase left in progress")
	}
}

func TestRebaseConflictAbortsCleanly(t *testing.T) {
	root := t.TempDir()
	remote := filepath.Join(root, "remote.git")
	seed := filepath.Join(root, "seed")
	work := filepath.Join(root, "work")
	other := filepath.Join(root, "other")

	runGit(t, root, "init", "--bare", remote)
	cloneAndConfigure(t, remote, seed)
	writeFile(t, seed, "shared.md", "original\n")
	runGit(t, seed, "add", ".")
	runGit(t, seed, "commit", "-m", "initial")
	runGit(t, seed, "push", "origin", "HEAD:main")

	cloneAndConfigure(t, remote, work)
	cloneAndConfigure(t, remote, other)

	writeFile(t, other, "shared.md", "other version\n")
	runGit(t, other, "add", ".")
	runGit(t, other, "commit", "-m", "other edits shared")
	runGit(t, other, "push", "origin", "main")

	writeFile(t, work, "shared.md", "work version\n")
	runGit(t, work, "add", ".")
	runGit(t, work, "commit", "-m", "work edits shared")

	syncer, err := New(work, remote, "main", "", true)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	err = syncer.Push("main")
	if err == nil {
		t.Fatal("expected rebase conflict error, got nil")
	}

	status := runGitOutput(t, work, "status", "--porcelain")
	if strings.TrimSpace(status) != "" {
		t.Fatalf("worktree should be clean after abort, got:\n%s", status)
	}
	rebaseDir := filepath.Join(work, ".git", "rebase-merge")
	if _, statErr := os.Stat(rebaseDir); statErr == nil {
		t.Fatal("rebase-merge directory still exists after abort")
	}
}

func cloneAndConfigure(t *testing.T, remote, dir string) {
	t.Helper()
	runGit(t, filepath.Dir(dir), "clone", remote, dir)
	runGit(t, dir, "config", "user.name", "KiwiFS Test")
	runGit(t, dir, "config", "user.email", "kiwifs-test@example.com")
	if runGitMaybe(dir, "rev-parse", "--verify", "origin/main") == nil {
		runGit(t, dir, "checkout", "-B", "main", "origin/main")
	} else {
		runGit(t, dir, "checkout", "-B", "main")
	}
}

func runGitMaybe(dir string, args ...string) error {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	return cmd.Run()
}

func writeFile(t *testing.T, dir, name, content string) {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func runGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	_ = runGitOutput(t, dir, args...)
}

func runGitOutput(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v in %s: %v\n%s", args, dir, err, out)
	}
	return string(out)
}
