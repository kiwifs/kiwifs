package spaces

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/kiwifs/kiwifs/internal/config"
)

func gitCmd(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v in %s: %v\n%s", args, dir, err, out)
	}
	return strings.TrimSpace(string(out))
}

func bareRemote(t *testing.T) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "remote.git")
	gitCmd(t, filepath.Dir(dir), "init", "--bare", "-b", "main", dir)
	return dir
}

// gitSpaceRoot returns a directory holding a git repo on branch main with
// one commit, so the syncer has something to push right away.
func gitSpaceRoot(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	gitCmd(t, dir, "init", "-b", "main")
	gitCmd(t, dir, "config", "user.email", "test@example.com")
	gitCmd(t, dir, "config", "user.name", "test")
	if err := os.WriteFile(filepath.Join(dir, "seed.md"), []byte("# seed\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-m", "seed")
	return dir
}

func gitSpaceCfg() *config.Config {
	return &config.Config{
		Versioning: config.VersioningConfig{Strategy: "git"},
		Search:     config.SearchConfig{Engine: "grep"},
	}
}

func remoteHead(t *testing.T, remote string) string {
	t.Helper()
	cmd := exec.Command("git", "--git-dir", remote, "rev-parse", "--verify", "--quiet", "refs/heads/main")
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func remoteRefs(t *testing.T, remote string) string {
	t.Helper()
	return gitCmd(t, filepath.Dir(remote), "--git-dir", remote, "for-each-ref")
}

func waitForRemoteHead(t *testing.T, remote, want string) {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		if got := remoteHead(t, remote); got != "" && (want == "" || got == want) {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("remote %s never reached head %q (now %q)", remote, want, remoteHead(t, remote))
}

func backupStatus(t *testing.T, h http.Handler, space string) map[string]any {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/"+space+"/backup/status", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("%s backup status: %d %s", space, rec.Code, rec.Body.String())
	}
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestSpaceBackupPushesToItsOwnRemote(t *testing.T) {
	primaryRemote := bareRemote(t)
	alphaRemote := bareRemote(t)
	base := gitSpaceCfg()
	base.Backup = config.BackupConfig{Remote: primaryRemote}

	m := NewManager(nil)
	alphaRoot := gitSpaceRoot(t)
	alphaCfg := SubConfig(base, alphaRoot, &config.BackupConfig{Remote: alphaRemote})
	if err := m.AddSpace("alpha", alphaRoot, alphaCfg); err != nil {
		t.Fatalf("AddSpace(alpha): %v", err)
	}
	betaRoot := gitSpaceRoot(t)
	if err := m.AddSpace("beta", betaRoot, SubConfig(base, betaRoot, nil)); err != nil {
		t.Fatalf("AddSpace(beta): %v", err)
	}
	closed := false
	defer func() {
		if !closed {
			m.Close()
		}
	}()

	waitForRemoteHead(t, alphaRemote, gitCmd(t, alphaRoot, "rev-parse", "HEAD"))

	h := m.Handler()
	if st := backupStatus(t, h, "alpha"); st["enabled"] != true {
		t.Fatalf("alpha status = %v, want enabled", st)
	}
	if st := backupStatus(t, h, "beta"); st["enabled"] != false {
		t.Fatalf("beta status = %v, want disabled (no remote of its own)", st)
	}

	alpha, _ := m.GetSpace("alpha")
	if _, err := alpha.Stack.Pipeline.Write(context.Background(), "notes/new.md", []byte("# new\n"), "test"); err != nil {
		t.Fatalf("write: %v", err)
	}
	want := gitCmd(t, alphaRoot, "rev-parse", "HEAD")

	// Close makes a final push, so the write lands without waiting for the ticker.
	if err := m.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	closed = true
	if got := remoteHead(t, alphaRemote); got != want {
		t.Fatalf("alpha remote head = %q, want %q after final push", got, want)
	}
	if refs := remoteRefs(t, primaryRemote); refs != "" {
		t.Fatalf("primary remote received pushes from spaces:\n%s", refs)
	}
}

func TestRemoveSpaceFlushesAndStopsBackup(t *testing.T) {
	remote := bareRemote(t)
	root := gitSpaceRoot(t)
	m := NewManager(nil)
	defer m.Close()
	if err := m.AddSpace("gamma", root, SubConfig(gitSpaceCfg(), root, &config.BackupConfig{Remote: remote})); err != nil {
		t.Fatalf("AddSpace: %v", err)
	}
	waitForRemoteHead(t, remote, "")

	sp, _ := m.GetSpace("gamma")
	if _, err := sp.Stack.Pipeline.Write(context.Background(), "late.md", []byte("late\n"), "test"); err != nil {
		t.Fatalf("write: %v", err)
	}
	want := gitCmd(t, root, "rev-parse", "HEAD")

	if err := m.RemoveSpace("gamma"); err != nil {
		t.Fatalf("RemoveSpace: %v", err)
	}
	if got := remoteHead(t, remote); got != want {
		t.Fatalf("remote head = %q, want %q (final push on remove)", got, want)
	}
}

func TestSpaceBackupSkipsRootWithoutOwnRepo(t *testing.T) {
	remote := bareRemote(t)
	parent := gitSpaceRoot(t)
	root := filepath.Join(parent, ".spaces", "nested")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	cfg := minimalCfg()
	cfg.Backup = config.BackupConfig{Remote: remote}

	m := NewManager(nil)
	defer m.Close()
	if err := m.AddSpace("nested", root, cfg); err != nil {
		t.Fatalf("AddSpace: %v", err)
	}
	sp, _ := m.GetSpace("nested")
	if sp.backup != nil {
		t.Fatal("backup started for a space without its own .git; it would push the enclosing repo")
	}
	if st := backupStatus(t, m.Handler(), "nested"); st["enabled"] != false {
		t.Fatalf("status = %v, want disabled", st)
	}
	if refs := remoteRefs(t, remote); refs != "" {
		t.Fatalf("remote received a push:\n%s", refs)
	}
}

func writeSpaceConfig(t *testing.T, root, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(root, ".kiwi"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".kiwi", "config.toml"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestSubConfigBackupResolution(t *testing.T) {
	base := minimalCfg()
	base.Backup = config.BackupConfig{Remote: "git@example.com:primary.git", Interval: "1m"}
	t.Setenv("KIWI_BACKUP_REMOTE", "git@example.com:from-env.git")
	t.Setenv("SPACE_REMOTE", "git@example.com:space.git")

	t.Run("not inherited from primary", func(t *testing.T) {
		sub := SubConfig(base, t.TempDir(), nil)
		if sub.Backup.Remote != "" {
			t.Fatalf("space inherited primary or env remote %q", sub.Backup.Remote)
		}
		if base.Backup.Remote != "git@example.com:primary.git" {
			t.Fatalf("base config mutated: %q", base.Backup.Remote)
		}
	})

	t.Run("own config.toml, env refs expanded, KIWI_BACKUP_* ignored", func(t *testing.T) {
		root := t.TempDir()
		writeSpaceConfig(t, root, "[backup]\nremote = \"${SPACE_REMOTE}\"\nbranch = \"kb\"\ninterval = \"10m\"\n")
		sub := SubConfig(base, root, nil)
		if sub.Backup.Remote != "git@example.com:space.git" || sub.Backup.Branch != "kb" || sub.Backup.Interval != "10m" {
			t.Fatalf("Backup = %+v", sub.Backup)
		}
	})

	t.Run("override wins over own config.toml", func(t *testing.T) {
		root := t.TempDir()
		writeSpaceConfig(t, root, "[backup]\nremote = \"git@example.com:file.git\"\n")
		sub := SubConfig(base, root, &config.BackupConfig{Remote: "git@example.com:override.git"})
		if sub.Backup.Remote != "git@example.com:override.git" {
			t.Fatalf("Remote = %q", sub.Backup.Remote)
		}
	})

	t.Run("malformed config.toml disables backup", func(t *testing.T) {
		root := t.TempDir()
		writeSpaceConfig(t, root, "[backup\nremote = ")
		if sub := SubConfig(base, root, nil); sub.Backup.Remote != "" {
			t.Fatalf("Remote = %q", sub.Backup.Remote)
		}
	})
}

func TestLookupBackup(t *testing.T) {
	primary := t.TempDir()
	dynRoot := filepath.Join(primary, ".spaces", "dyn")
	writeSpaceConfig(t, dynRoot, "[backup]\nremote = \"git@example.com:dyn.git\"\n")
	writeSpaceConfig(t, primary, "")
	if err := os.WriteFile(filepath.Join(primary, ".kiwi", "spaces.json"),
		[]byte(`[{"name":"dyn","root":"`+dynRoot+`"}]`), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{Spaces: []config.SpaceConfig{
		{Name: "agent-a", Root: "spaces/agent-a", Backup: &config.BackupConfig{Remote: "git@example.com:a.git"}},
	}}

	root, b, err := LookupBackup(primary, cfg, "agent-a")
	if err != nil || root != filepath.Join(primary, "spaces", "agent-a") || b.Remote != "git@example.com:a.git" {
		t.Fatalf("agent-a: root=%q backup=%+v err=%v", root, b, err)
	}
	root, b, err = LookupBackup(primary, cfg, "dyn")
	if err != nil || root != dynRoot || b.Remote != "git@example.com:dyn.git" {
		t.Fatalf("dyn: root=%q backup=%+v err=%v", root, b, err)
	}
	if _, _, err := LookupBackup(primary, cfg, "missing"); err == nil {
		t.Fatal("expected an error for an unknown space")
	}
}
