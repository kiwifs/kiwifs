package pipeline

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/kiwifs/kiwifs/internal/events"
	"github.com/kiwifs/kiwifs/internal/refactor"
	"github.com/kiwifs/kiwifs/internal/storage"
)

// ErrPlanStale is returned by ApplyRefactor when a file the plan read has
// changed since. Nothing has been written; build the plan again.
var ErrPlanStale = errors.New("plan is stale: a file changed since it was planned")

// RefactorResult reports what ApplyRefactor changed.
type RefactorResult struct {
	Written int `json:"written"`
	Deleted int `json:"deleted"`
	Side    int `json:"side_files"`
	Dirs    int `json:"removed_dirs"`
}

type fileSnapshot struct {
	path    string
	content []byte
	existed bool
}

// ApplyRefactor carries out a plan from refactor.BuildPlan as one change:
// every page write and delete lands in a single commit, and if any storage
// operation fails, the pages already touched are restored.
func (p *Pipeline) ApplyRefactor(ctx context.Context, plan *refactor.Plan, actor string) (RefactorResult, error) {
	if plan == nil || len(plan.Errors) > 0 {
		return RefactorResult{}, fmt.Errorf("plan has errors; nothing applied")
	}
	ops := plan.Ops
	actor = coalesce(actor)

	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	if err := ctx.Err(); err != nil {
		return RefactorResult{}, err
	}

	for _, w := range ops.Writes {
		cur, err := p.Store.Read(ctx, w.Source)
		if err != nil || ETag(cur) != w.SourceETag {
			return RefactorResult{}, fmt.Errorf("%w (%s)", ErrPlanStale, w.Source)
		}
	}
	for _, d := range ops.Deletes {
		cur, err := p.Store.Read(ctx, d.Path)
		if err != nil || ETag(cur) != d.ETag {
			return RefactorResult{}, fmt.Errorf("%w (%s)", ErrPlanStale, d.Path)
		}
	}

	var snaps []fileSnapshot
	snapshot := func(path string) {
		c, err := p.Store.Read(ctx, path)
		snaps = append(snaps, fileSnapshot{path: path, content: c, existed: err == nil})
	}
	restore := func() {
		for i := len(snaps) - 1; i >= 0; i-- {
			s := snaps[i]
			p.markInflight(s.path)
			var err error
			if s.existed {
				err = p.Store.Write(ctx, s.path, s.content)
			} else {
				err = p.Store.Delete(ctx, s.path)
			}
			if err != nil {
				log.Printf("pipeline: ApplyRefactor rollback %s: %v", s.path, err)
			}
		}
	}

	var paths []string
	for _, w := range ops.Writes {
		snapshot(w.Path)
		p.markInflightEtag(w.Path, ETag(w.Content))
		if err := p.Store.Write(ctx, w.Path, w.Content); err != nil {
			restore()
			return RefactorResult{}, fmt.Errorf("write %s: %w", w.Path, err)
		}
		paths = append(paths, w.Path)
	}
	for _, d := range ops.Deletes {
		snapshot(d.Path)
		p.markInflight(d.Path)
		p.tryPreDelete(d.Path)
		if err := p.Store.Delete(ctx, d.Path); err != nil {
			restore()
			return RefactorResult{}, fmt.Errorf("delete %s: %w", d.Path, err)
		}
		paths = append(paths, d.Path)
	}

	side := 0
	for _, s := range ops.Side {
		if err := applySideWrite(p.Root, s); err != nil {
			log.Printf("pipeline: ApplyRefactor %s: %v", s.Path, err)
			continue
		}
		side++
	}
	dirs := 0
	for _, d := range ops.Dirs {
		abs := p.Store.AbsPath(d)
		_ = os.Remove(filepath.Join(abs, ".DS_Store"))
		if err := os.Remove(abs); err == nil {
			dirs++
		}
	}

	msg := fmt.Sprintf("%s: refactor %d moves, %d merges, %d pages relinked",
		actor, len(plan.Moves), len(plan.Merges), len(plan.Edits))
	if err := p.Versioner.BulkCommit(ctx, paths, actor, msg); err != nil {
		log.Printf("pipeline: ApplyRefactor BulkCommit: %v", err)
		for _, pa := range paths {
			p.trackUncommitted(pa)
		}
	}

	for _, d := range ops.Deletes {
		p.deindexFile(ctx, d.Path)
	}
	for _, w := range ops.Writes {
		p.indexFile(ctx, w.Path, w.Content)
	}
	for _, d := range ops.Deletes {
		p.broadcast(events.Event{Op: "delete", Path: d.Path, Actor: actor})
		if p.OnDelete != nil {
			p.OnDelete(d.Path, actor)
		}
	}
	for _, w := range ops.Writes {
		p.broadcast(events.Event{Op: "write", Path: w.Path, Actor: actor, ETag: ETag(w.Content)})
	}

	return RefactorResult{Written: len(ops.Writes), Deleted: len(ops.Deletes), Side: side, Dirs: dirs}, nil
}

// applySideWrite writes or removes a comment or personal-state file. The
// write goes to a temp file and is renamed into place, so a reader never
// sees half a JSON document.
func applySideWrite(root string, s refactor.SideWrite) error {
	if root == "" {
		return fmt.Errorf("no workspace root")
	}
	clean := filepath.ToSlash(filepath.Clean(filepath.FromSlash(s.Path)))
	if !strings.HasPrefix(clean, ".kiwi/") && !strings.HasPrefix(clean, ".me/") || strings.Contains(clean, "..") {
		return fmt.Errorf("%w: %s is not a comment or personal-state file", storage.ErrPathDenied, s.Path)
	}
	abs := filepath.Join(root, filepath.FromSlash(clean))
	if s.Delete {
		if err := os.Remove(abs); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return err
	}
	tmp := abs + ".kiwi-tmp"
	if err := os.WriteFile(tmp, s.Content, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, abs)
}
