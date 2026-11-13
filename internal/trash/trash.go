// Package trash keeps deleted files recoverable. A trashed file is moved
// under .kiwi/trash/<id>/ and recorded in .kiwi/trash/manifest.json, so it
// can be listed, restored to its original path, or purged for good.
//
// The bin only moves bytes and keeps the manifest; committing the deletion,
// updating indexes and broadcasting events is the pipeline's job.
package trash

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Dir is the bin's location relative to the workspace root.
const Dir = ".kiwi/trash"

const manifestName = "manifest.json"

// maxSlugLen keeps item directory names well under filesystem limits while
// leaving enough of the original path to recognise it in a listing.
const maxSlugLen = 64

var (
	// ErrNotFound is returned for an id the manifest doesn't know.
	ErrNotFound = errors.New("trash item not found")
	// ErrExists is returned by Restore when something already occupies
	// the destination.
	ErrExists = errors.New("destination already exists")
)

var validID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)

// Item describes one trashed file.
type Item struct {
	ID           string    `json:"id"`
	OriginalPath string    `json:"original_path"`
	DeletedAt    time.Time `json:"deleted_at"`
	Actor        string    `json:"actor,omitempty"`
	Size         int64     `json:"size"`
}

type manifest struct {
	Items []Item `json:"items"`
}

// Bin is the trash of one workspace. It is safe for concurrent use.
type Bin struct {
	dir string
	now func() time.Time
	mu  sync.Mutex
}

// New returns the bin for the workspace at root. Nothing is created on
// disk until the first file is trashed.
func New(root string) *Bin {
	return &Bin{dir: filepath.Join(root, filepath.FromSlash(Dir)), now: time.Now}
}

// Put moves the file at src into the bin and records it under
// originalPath, the workspace-relative path it is restored to.
func (b *Bin) Put(src, originalPath, actor string) (Item, error) {
	info, err := os.Lstat(src)
	if err != nil {
		return Item{}, err
	}
	if info.IsDir() {
		return Item{}, fmt.Errorf("trash %s: is a directory", originalPath)
	}
	originalPath = strings.TrimPrefix(path.Clean("/"+filepath.ToSlash(originalPath)), "/")
	if originalPath == "" {
		return Item{}, errors.New("trash: original path is required")
	}

	b.mu.Lock()
	defer b.mu.Unlock()
	m, err := b.load()
	if err != nil {
		return Item{}, err
	}
	if err := os.MkdirAll(b.dir, 0o755); err != nil {
		return Item{}, fmt.Errorf("create trash dir: %w", err)
	}
	now := b.now().UTC()
	id, err := b.reserveID(now, originalPath)
	if err != nil {
		return Item{}, err
	}
	item := Item{
		ID:           id,
		OriginalPath: originalPath,
		DeletedAt:    now,
		Actor:        actor,
		Size:         info.Size(),
	}
	dst := b.payloadPath(item)
	if err := os.Rename(src, dst); err != nil {
		os.Remove(filepath.Join(b.dir, id))
		return Item{}, fmt.Errorf("move into trash: %w", err)
	}
	m.Items = append(m.Items, item)
	if err := b.save(m); err != nil {
		if rerr := os.Rename(dst, src); rerr != nil {
			return Item{}, fmt.Errorf("%w (and moving %s back failed: %v)", err, originalPath, rerr)
		}
		os.Remove(filepath.Join(b.dir, id))
		return Item{}, err
	}
	return item, nil
}

// List returns the trashed items, most recently deleted first. Entries
// whose file has disappeared from the bin are left out.
func (b *Bin) List() ([]Item, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	m, err := b.load()
	if err != nil {
		return nil, err
	}
	items := make([]Item, 0, len(m.Items))
	for _, it := range m.Items {
		if _, err := os.Lstat(b.payloadPath(it)); err == nil {
			items = append(items, it)
		}
	}
	sort.SliceStable(items, func(i, j int) bool {
		return items[i].DeletedAt.After(items[j].DeletedAt)
	})
	return items, nil
}

// Get returns the item with the given id.
func (b *Bin) Get(id string) (Item, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	m, err := b.load()
	if err != nil {
		return Item{}, err
	}
	_, it, err := m.find(id)
	return it, err
}

// Restore moves the item's file to dst, an absolute path, and drops it
// from the bin. It fails with ErrExists rather than overwrite dst.
func (b *Bin) Restore(id, dst string) (Item, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	m, err := b.load()
	if err != nil {
		return Item{}, err
	}
	i, item, err := m.find(id)
	if err != nil {
		return Item{}, err
	}
	if _, err := os.Lstat(dst); err == nil {
		return item, fmt.Errorf("restore %s: %w", item.OriginalPath, ErrExists)
	} else if !errors.Is(err, os.ErrNotExist) {
		return item, err
	}
	src := b.payloadPath(item)
	if _, err := os.Lstat(src); err != nil {
		return item, fmt.Errorf("restore %s: trashed file is missing: %w", item.OriginalPath, err)
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return item, fmt.Errorf("create parent dirs: %w", err)
	}
	if err := os.Rename(src, dst); err != nil {
		return item, fmt.Errorf("move out of trash: %w", err)
	}
	m.Items = append(m.Items[:i], m.Items[i+1:]...)
	if err := b.save(m); err != nil {
		if rerr := os.Rename(dst, src); rerr != nil {
			return item, fmt.Errorf("%w (and moving %s back into the trash failed: %v)", err, item.OriginalPath, rerr)
		}
		return item, err
	}
	os.Remove(filepath.Join(b.dir, item.ID))
	return item, nil
}

// Delete permanently removes one item.
func (b *Bin) Delete(id string) (Item, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	m, err := b.load()
	if err != nil {
		return Item{}, err
	}
	i, item, err := m.find(id)
	if err != nil {
		return Item{}, err
	}
	m.Items = append(m.Items[:i], m.Items[i+1:]...)
	if err := b.save(m); err != nil {
		return Item{}, err
	}
	if err := os.RemoveAll(filepath.Join(b.dir, item.ID)); err != nil {
		return item, fmt.Errorf("remove trashed file: %w", err)
	}
	return item, nil
}

// Purge permanently removes every item deleted before cutoff, and drops
// manifest entries whose file is already gone. It returns the items it
// removed.
func (b *Bin) Purge(cutoff time.Time) ([]Item, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	m, err := b.load()
	if err != nil {
		return nil, err
	}
	var keep, purged []Item
	for _, it := range m.Items {
		_, statErr := os.Lstat(b.payloadPath(it))
		switch {
		case it.DeletedAt.Before(cutoff):
			purged = append(purged, it)
		case statErr != nil:
			// Vanished out of band; nothing left to restore.
		default:
			keep = append(keep, it)
		}
	}
	if len(keep) == len(m.Items) {
		return nil, nil
	}
	m.Items = keep
	if err := b.save(m); err != nil {
		return nil, err
	}
	var errs []error
	for _, it := range purged {
		if err := os.RemoveAll(filepath.Join(b.dir, it.ID)); err != nil {
			errs = append(errs, err)
		}
	}
	return purged, errors.Join(errs...)
}

func (m *manifest) find(id string) (int, Item, error) {
	if !validID.MatchString(id) {
		return -1, Item{}, ErrNotFound
	}
	for i, it := range m.Items {
		if it.ID == id {
			return i, it, nil
		}
	}
	return -1, Item{}, ErrNotFound
}

func (b *Bin) payloadPath(it Item) string {
	return filepath.Join(b.dir, it.ID, path.Base(it.OriginalPath))
}

// reserveID creates the item directory and returns its name: the deletion
// time plus a slug of the original path, numbered when two deletions of
// the same path land in the same second.
func (b *Bin) reserveID(at time.Time, originalPath string) (string, error) {
	base := at.Format("20060102T150405Z") + "_" + slugify(originalPath)
	for n := 1; ; n++ {
		id := base
		if n > 1 {
			id += "-" + strconv.Itoa(n)
		}
		err := os.Mkdir(filepath.Join(b.dir, id), 0o755)
		if err == nil {
			return id, nil
		}
		if !errors.Is(err, os.ErrExist) {
			return "", fmt.Errorf("create trash item: %w", err)
		}
	}
}

func slugify(p string) string {
	var sb strings.Builder
	dash := false
	for _, r := range p {
		ok := r < 0x80 && (r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '.' || r == '_')
		if ok {
			sb.WriteRune(r)
			dash = false
		} else if !dash && sb.Len() > 0 {
			sb.WriteByte('-')
			dash = true
		}
		if sb.Len() >= maxSlugLen {
			break
		}
	}
	s := strings.Trim(sb.String(), "-.")
	if s == "" {
		return "file"
	}
	return s
}

func (b *Bin) load() (*manifest, error) {
	data, err := os.ReadFile(filepath.Join(b.dir, manifestName))
	if errors.Is(err, os.ErrNotExist) {
		return &manifest{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read trash manifest: %w", err)
	}
	var m manifest
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, fmt.Errorf("parse trash manifest: %w", err)
	}
	return &m, nil
}

func (b *Bin) save(m *manifest) error {
	if m.Items == nil {
		m.Items = []Item{}
	}
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(b.dir, ".manifest-*")
	if err != nil {
		return fmt.Errorf("write trash manifest: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if _, err := tmp.Write(append(data, '\n')); err != nil {
		tmp.Close()
		return fmt.Errorf("write trash manifest: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("write trash manifest: %w", err)
	}
	if err := os.Rename(tmpName, filepath.Join(b.dir, manifestName)); err != nil {
		return fmt.Errorf("write trash manifest: %w", err)
	}
	return nil
}
