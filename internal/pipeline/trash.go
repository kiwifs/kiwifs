package pipeline

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/kiwifs/kiwifs/internal/events"
	"github.com/kiwifs/kiwifs/internal/storage"
	"github.com/kiwifs/kiwifs/internal/trash"
)

// ErrTrashDisabled is returned by the trash operations when the workspace
// has no trash ([trash] enabled = false, or a pipeline without a root).
var ErrTrashDisabled = errors.New("trash is disabled")

// ErrIsDirectory is returned by MoveToTrash for a directory: the trash holds
// files, and an empty directory carries nothing worth restoring.
var ErrIsDirectory = errors.New("path is a directory")

// TrashEnabled reports whether deletes can go to the trash.
func (p *Pipeline) TrashEnabled() bool {
	return p.Trash != nil
}

// MoveToTrash is the soft form of Delete: the file moves into the trash
// instead of being removed, and the removal is committed as "trash: <path>".
// Indexes and subscribers see a delete; the event carries trashed=true and
// the restore id.
func (p *Pipeline) MoveToTrash(ctx context.Context, path, actor string) (trash.Item, error) {
	if p.Trash == nil {
		return trash.Item{}, ErrTrashDisabled
	}
	if path == "" {
		return trash.Item{}, fmt.Errorf("path is required")
	}
	if err := ctx.Err(); err != nil {
		return trash.Item{}, err
	}
	abs, err := storage.GuardPath(p.Root, path)
	if err != nil {
		return trash.Item{}, err
	}
	actor = coalesce(actor)
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	if err := ctx.Err(); err != nil {
		return trash.Item{}, err
	}
	info, err := os.Lstat(abs)
	if err != nil {
		return trash.Item{}, err
	}
	if info.IsDir() {
		return trash.Item{}, fmt.Errorf("trash %s: %w", path, ErrIsDirectory)
	}
	p.markInflight(path)
	p.tryPreDelete(path)
	item, err := p.Trash.Put(abs, path, actor)
	if err != nil {
		return trash.Item{}, err
	}
	if err := p.Versioner.BulkCommit(ctx, []string{path}, actor, "trash: "+path); err != nil {
		log.Printf("pipeline: versioner.BulkCommit(trash %s): %v", path, err)
		p.trackUncommitted(path)
	}
	p.deindexFile(ctx, path)
	p.broadcast(events.Event{Op: "delete", Path: path, Actor: actor, Extra: map[string]any{
		"trashed":    true,
		"restore_id": item.ID,
	}})
	if p.OnDelete != nil {
		p.OnDelete(path, actor)
	}
	return item, nil
}

// DeleteOrTrash is what a user-facing delete does: the file goes to the
// trash when the workspace has one and permanent is false, and is removed
// outright otherwise. Directories are always removed outright, since only
// empty ones can be deleted and they carry nothing to restore. The returned
// item is nil when nothing went to the trash.
func (p *Pipeline) DeleteOrTrash(ctx context.Context, path, actor string, permanent bool) (*trash.Item, error) {
	if p.TrashEnabled() && !permanent {
		item, err := p.MoveToTrash(ctx, path, actor)
		if err == nil {
			return &item, nil
		}
		if !errors.Is(err, ErrIsDirectory) {
			return nil, err
		}
	}
	return nil, p.Delete(ctx, path, actor)
}

// RestoreFromTrash moves a trashed file back to its original path and runs
// the usual write side effects: a "restore: <path>" commit, re-indexing and
// a write event carrying restored_from. It fails with trash.ErrExists when
// the original path has been taken since, and trash.ErrNotFound for an
// unknown id.
func (p *Pipeline) RestoreFromTrash(ctx context.Context, id, actor string) (trash.Item, Result, error) {
	if p.Trash == nil {
		return trash.Item{}, Result{}, ErrTrashDisabled
	}
	if err := ctx.Err(); err != nil {
		return trash.Item{}, Result{}, err
	}
	actor = coalesce(actor)
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	if err := ctx.Err(); err != nil {
		return trash.Item{}, Result{}, err
	}
	item, err := p.Trash.Get(id)
	if err != nil {
		return trash.Item{}, Result{}, err
	}
	path := item.OriginalPath
	abs, err := storage.GuardPath(p.Root, path)
	if err != nil {
		return item, Result{}, err
	}
	p.markInflight(path)
	if item, err = p.Trash.Restore(id, abs); err != nil {
		return item, Result{}, err
	}
	if err := p.Versioner.Commit(ctx, path, actor, "restore: "+path); err != nil {
		log.Printf("pipeline: versioner.Commit(restore %s): %v", path, err)
		p.trackUncommitted(path)
	}
	res := Result{Path: path}
	if storage.IsKnowledgeFile(path) {
		if content, err := os.ReadFile(abs); err == nil {
			res.ETag = ETag(content)
			p.markInflightEtag(path, res.ETag)
			p.indexFile(ctx, path, content)
		} else {
			log.Printf("pipeline: read restored %s: %v", path, err)
		}
	}
	p.broadcast(events.Event{Op: "write", Path: path, Actor: actor, ETag: res.ETag, Extra: map[string]any{
		"restored_from": item.ID,
	}})
	return item, res, nil
}

// ListTrash returns the trashed files, most recently deleted first.
func (p *Pipeline) ListTrash() ([]trash.Item, error) {
	if p.Trash == nil {
		return nil, ErrTrashDisabled
	}
	return p.Trash.List()
}

// DeleteFromTrash permanently removes one trashed file. The file's history
// stays in git; only the trash copy goes.
func (p *Pipeline) DeleteFromTrash(id string) (trash.Item, error) {
	if p.Trash == nil {
		return trash.Item{}, ErrTrashDisabled
	}
	return p.Trash.Delete(id)
}

// PurgeTrash permanently removes trashed files deleted more than retention
// ago. A retention of zero or less keeps everything.
func (p *Pipeline) PurgeTrash(retention time.Duration) ([]trash.Item, error) {
	if p.Trash == nil || retention <= 0 {
		return nil, nil
	}
	return p.Trash.Purge(time.Now().Add(-retention))
}
