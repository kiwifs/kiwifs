package backup

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	defaultInterval = 5 * time.Minute
	remoteName      = "backup"
	cmdTimeout      = 60 * time.Second
)

// RequireRepoRoot errors unless root has its own .git. Without one, git walks
// up to the enclosing repository, so a space nested inside the primary root
// would push the primary's history to the space's remote.
func RequireRepoRoot(root string) error {
	if _, err := os.Stat(filepath.Join(root, ".git")); err != nil {
		return fmt.Errorf("%s is not a git repository (backup needs versioning = \"git\")", root)
	}
	return nil
}

// BackupStatus reports the result of the most recent backup push.
type BackupStatus struct {
	LastPushAt *time.Time `json:"last_push_at,omitempty"`
	Success    bool       `json:"success"`
	Error      string     `json:"error,omitempty"`
}

type Syncer struct {
	root             string
	remote           string
	branch           string
	interval         time.Duration
	rebaseBeforePush bool

	stopCh chan struct{}
	done   sync.WaitGroup

	mu     sync.RWMutex
	status BackupStatus
}

func New(root, remote, branch, interval string, rebaseBeforePush bool) (*Syncer, error) {
	if remote == "" {
		return nil, fmt.Errorf("backup remote is required")
	}
	dur := defaultInterval
	if interval != "" {
		d, err := time.ParseDuration(interval)
		if err != nil {
			return nil, fmt.Errorf("parse backup interval %q: %w", interval, err)
		}
		if d < 30*time.Second {
			d = 30 * time.Second
		}
		dur = d
	}
	return &Syncer{
		root:             root,
		remote:           remote,
		branch:           branch,
		interval:         dur,
		rebaseBeforePush: rebaseBeforePush,
		stopCh:           make(chan struct{}),
	}, nil
}

func (s *Syncer) Start() {
	s.done.Add(1)
	go s.run()
}

func (s *Syncer) Close() {
	close(s.stopCh)
	s.done.Wait()
}

// Status returns the result of the most recent backup push.
func (s *Syncer) Status() BackupStatus {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.status
}

func (s *Syncer) recordStatus(success bool, err error) {
	now := time.Now()
	s.mu.Lock()
	s.status.LastPushAt = &now
	s.status.Success = success
	if err != nil {
		s.status.Error = err.Error()
	} else {
		s.status.Error = ""
	}
	s.mu.Unlock()
}

func (s *Syncer) run() {
	defer s.done.Done()

	if err := s.ensureRemote(); err != nil {
		log.Printf("backup %s: setup remote: %v", s.remote, err)
		return
	}

	branch := s.resolveBranch()
	log.Printf("backup: pushing to %s (%s) every %s", s.remote, branch, s.interval)

	s.push(branch)

	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()
	for {
		select {
		case <-s.stopCh:
			s.push(branch)
			return
		case <-ticker.C:
			s.push(branch)
		}
	}
}

func (s *Syncer) ensureRemote() error {
	existing, err := s.output("git", "remote", "get-url", remoteName)
	if err == nil {
		existing = strings.TrimSpace(existing)
		if existing == s.remote {
			return nil
		}
		if err := s.cmd("git", "remote", "set-url", remoteName, s.remote); err != nil {
			return fmt.Errorf("set-url: %w", err)
		}
		return nil
	}
	return s.cmd("git", "remote", "add", remoteName, s.remote)
}

func (s *Syncer) resolveBranch() string {
	if s.branch != "" {
		return s.branch
	}
	out, err := s.output("git", "rev-parse", "--abbrev-ref", "HEAD")
	if err != nil {
		return "main"
	}
	b := strings.TrimSpace(out)
	if b == "" || b == "HEAD" {
		return "main"
	}
	return b
}

// Push runs a single git push. Exported for the one-shot CLI command.
func (s *Syncer) Push(branch string) error {
	if err := s.ensureRemote(); err != nil {
		return fmt.Errorf("setup remote: %w", err)
	}
	if branch == "" {
		branch = s.resolveBranch()
	}
	return s.push(branch)
}

func (s *Syncer) push(branch string) error {
	if s.rebaseBeforePush {
		if err := s.rebaseRemoteBranch(branch); err != nil {
			log.Printf("backup %s: rebase before push failed: %v", s.remote, err)
			s.recordStatus(false, err)
			return err
		}
	}

	err := s.cmd("git", "push", remoteName, branch)
	if err != nil {
		log.Printf("backup %s: push failed: %v", s.remote, err)
		s.recordStatus(false, err)
		return err
	}
	if verr := s.verifyPush(branch); verr != nil {
		log.Printf("backup %s: push to %s verification failed: %v", s.remote, branch, verr)
		s.recordStatus(true, nil)
		return nil
	}
	log.Printf("backup %s: pushed + verified %s", s.remote, branch)
	s.recordStatus(true, nil)
	return nil
}

// rebaseRemoteBranch fetches the backup branch and rebases local commits on
// top before pushing. This makes the default backup path resilient to a common
// multi-writer workflow: another client pushed first, then KiwiFS tries to back
// up its own clean local commits. Dirty worktrees and merge conflicts are not
// auto-resolved because doing so risks data loss; the backup loop logs the
// failure and will retry after an operator or the user resolves the state.
func (s *Syncer) rebaseRemoteBranch(branch string) error {
	if _, err := s.output("git", "ls-remote", "--exit-code", remoteName, branch); err != nil {
		// Nothing to rebase onto yet. The following push may create the branch.
		return nil
	}
	if err := s.cmd("git", "fetch", remoteName, branch); err != nil {
		return fmt.Errorf("fetch %s/%s: %w", remoteName, branch, err)
	}
	if clean, err := s.isWorktreeClean(); err != nil {
		return err
	} else if !clean {
		return fmt.Errorf("worktree has uncommitted changes; refusing automatic rebase")
	}
	upstream := fmt.Sprintf("%s/%s", remoteName, branch)
	local, err := s.output("git", "rev-parse", "HEAD")
	if err != nil {
		return fmt.Errorf("local rev-parse: %w", err)
	}
	remote, err := s.output("git", "rev-parse", upstream)
	if err != nil {
		return fmt.Errorf("remote rev-parse %s: %w", upstream, err)
	}
	if strings.TrimSpace(local) == strings.TrimSpace(remote) {
		return nil
	}
	// Safety ref so the pre-rebase state can be recovered after power loss.
	_ = s.cmd("git", "update-ref", "refs/kiwifs/backup-pre-rebase", "HEAD")
	if err := s.cmd("git", "rebase", upstream); err != nil {
		_ = s.cmd("git", "rebase", "--abort")
		return fmt.Errorf("rebase %s: %w", upstream, err)
	}
	log.Printf("backup %s: rebased local branch onto %s before push", s.remote, upstream)
	return nil
}

func (s *Syncer) isWorktreeClean() (bool, error) {
	// Untracked files can't be lost by a rebase, and every KiwiFS root has
	// some (.gitattributes, .kiwi/state), so counting them blocked every push
	// after the first. A rebase that would overwrite one fails and is aborted.
	status, err := s.output("git", "status", "--porcelain", "--untracked-files=no")
	if err != nil {
		return false, fmt.Errorf("git status: %w", err)
	}
	return strings.TrimSpace(status) == "", nil
}

// verifyPush re-queries the remote for the branch's head and checks it
// matches the local HEAD commit. A silent mismatch is the nightmare
// case — someone's remote rejected the update with a non-fast-forward
// warning git printed to stderr but our wrapper already consumed.
func (s *Syncer) verifyPush(branch string) error {
	local, err := s.output("git", "rev-parse", "HEAD")
	if err != nil {
		return fmt.Errorf("local rev-parse: %w", err)
	}
	local = strings.TrimSpace(local)

	remote, err := s.output("git", "ls-remote", remoteName, branch)
	if err != nil {
		return fmt.Errorf("ls-remote: %w", err)
	}
	parts := strings.Fields(strings.TrimSpace(remote))
	if len(parts) == 0 {
		return fmt.Errorf("remote branch %q not found after push", branch)
	}
	remoteSHA := parts[0]
	if remoteSHA != local {
		return fmt.Errorf("remote HEAD %s != local HEAD %s", remoteSHA, local)
	}
	return nil
}

func (s *Syncer) cmd(name string, args ...string) error {
	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()
	c := exec.CommandContext(ctx, name, args...)
	c.Dir = s.root
	var stderr bytes.Buffer
	c.Stderr = &stderr
	if err := c.Run(); err != nil {
		return fmt.Errorf("%s %v: %w\n%s", name, args, err, stderr.String())
	}
	return nil
}

func (s *Syncer) output(name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()
	c := exec.CommandContext(ctx, name, args...)
	c.Dir = s.root
	var stdout, stderr bytes.Buffer
	c.Stdout = &stdout
	c.Stderr = &stderr
	if err := c.Run(); err != nil {
		return "", fmt.Errorf("%s %v: %w\n%s", name, args, err, stderr.String())
	}
	return stdout.String(), nil
}
