package storage

import (
	"context"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/kiwifs/kiwifs/internal/markdown"
)

type TreeEntry struct {
	Path             string       `json:"path"`
	Name             string       `json:"name"`
	IsDir            bool         `json:"isDir"`
	Size             int64        `json:"size,omitempty"`
	Order            *int         `json:"order,omitempty"`
	FrontmatterError string       `json:"frontmatterError,omitempty"`
	Children         []*TreeEntry `json:"children,omitempty"`
}

type frontmatterReader interface {
	ReadFrontmatter(ctx context.Context, path string) (map[string]any, error)
}

type frontmatterErrorReader interface {
	ReadFrontmatterError(ctx context.Context, path string) (string, error)
}

type treeOrderReader interface {
	ReadTreeOrder(ctx context.Context, path string) (*int, error)
}

// BuildTree creates the recursive API tree and attaches order metadata.
//
// Directory order is read from the tree sidecar metadata; markdown order is
// read from frontmatter. Markdown parse errors are carried on the row so the UI
// can warn users without dropping files that lack valid frontmatter.
func BuildTree(ctx context.Context, store Storage, path string, depth int) (*TreeEntry, error) {
	entries, err := store.List(ctx, path)
	if err != nil {
		return nil, err
	}

	root := &TreeEntry{
		Path:  strings.Trim(path, "/"),
		Name:  treeDisplayName(path),
		IsDir: true,
	}

	for _, entry := range entries {
		child := buildTreeChild(ctx, store, entry, depth)
		root.Children = append(root.Children, child)
	}
	sortTreeChildren(root.Children)
	return root, nil
}

// treeDisplayName gives the root node a stable slash label.
func treeDisplayName(path string) string {
	cleanPath := strings.Trim(path, "/")
	if cleanPath == "" {
		return "/"
	}
	return filepath.Base(cleanPath)
}

// buildTreeChild maps one storage entry to the public tree row shape.
func buildTreeChild(ctx context.Context, store Storage, entry Entry, depth int) *TreeEntry {
	child := &TreeEntry{
		Path:  entry.Path,
		Name:  entry.Name,
		IsDir: entry.IsDir,
		Size:  entry.Size,
	}

	applyTreeOrderMetadata(ctx, store, child)
	applyTreeChildren(ctx, store, child, depth)
	return child
}

// applyTreeOrderMetadata attaches directory sidecar order or markdown frontmatter order.
func applyTreeOrderMetadata(ctx context.Context, store Storage, child *TreeEntry) {
	if child.IsDir {
		child.Order = readDirectoryOrder(ctx, store, child.Path)
		return
	}
	child.Order, child.FrontmatterError = readOrderMetadata(ctx, store, child.Path)
}

// applyTreeChildren recursively loads child rows for expandable directories.
func applyTreeChildren(ctx context.Context, store Storage, child *TreeEntry, depth int) {
	if !child.IsDir {
		return
	}
	if depth <= 0 {
		return
	}
	sub, err := BuildTree(ctx, store, child.Path, depth-1)
	if err != nil {
		return
	}
	child.Children = sub.Children
}

// sortTreeChildren orders explicit order metadata before falling back to names.
func sortTreeChildren(children []*TreeEntry) {
	sort.SliceStable(children, func(i, j int) bool {
		a, b := children[i], children[j]
		if a.Order != nil && b.Order != nil && *a.Order != *b.Order {
			return *a.Order < *b.Order
		}
		if a.Order != nil && b.Order == nil {
			return true
		}
		if a.Order == nil && b.Order != nil {
			return false
		}
		return strings.ToLower(a.Name) < strings.ToLower(b.Name)
	})
}

// readDirectoryOrder returns the persisted folder order when the backend supports it.
func readDirectoryOrder(ctx context.Context, store Storage, path string) *int {
	reader, ok := store.(treeOrderReader)
	if !ok {
		return nil
	}
	order, err := reader.ReadTreeOrder(ctx, path)
	if err != nil {
		return nil
	}
	return order
}

// readOrder preserves the older helper contract for callers that only need order.
func readOrder(ctx context.Context, store Storage, path string) *int {
	order, _ := readOrderMetadata(ctx, store, path)
	return order
}

// readOrderMetadata reads markdown order and returns parse errors as display text.
func readOrderMetadata(ctx context.Context, store Storage, path string) (*int, string) {
	if !isMarkdownPath(path) {
		return nil, ""
	}
	reader, ok := store.(frontmatterReader)
	if ok {
		return readOrderFromFrontmatterReader(ctx, store, reader, path)
	}
	return readOrderFromContent(ctx, store, path)
}

// isMarkdownPath reports whether order should come from markdown frontmatter.
func isMarkdownPath(path string) bool {
	lower := strings.ToLower(path)
	if strings.HasSuffix(lower, ".md") {
		return true
	}
	return strings.HasSuffix(lower, ".markdown")
}

// readOrderFromFrontmatterReader uses storage-provided frontmatter parsing.
func readOrderFromFrontmatterReader(ctx context.Context, store Storage, reader frontmatterReader, path string) (*int, string) {
	fm, err := reader.ReadFrontmatter(ctx, path)
	if err != nil {
		return nil, err.Error()
	}
	return frontmatterOrder(fm["order"]), readFrontmatterError(ctx, store, path)
}

// readOrderFromContent parses frontmatter when the backend has no reader interface.
func readOrderFromContent(ctx context.Context, store Storage, path string) (*int, string) {
	content, err := store.Read(ctx, path)
	if err != nil {
		return nil, ""
	}
	fm, err := markdown.Frontmatter(content)
	if err != nil {
		return nil, err.Error()
	}
	return frontmatterOrder(fm["order"]), ""
}

// readFrontmatterError exposes cached parse errors when available.
func readFrontmatterError(ctx context.Context, store Storage, path string) string {
	reader, ok := store.(frontmatterErrorReader)
	if !ok {
		return ""
	}
	errText, err := reader.ReadFrontmatterError(ctx, path)
	if err != nil {
		return ""
	}
	return errText
}

// frontmatterOrder normalizes supported YAML scalar forms into an integer order.
func frontmatterOrder(v any) *int {
	asInt, ok := v.(int)
	if ok {
		return &asInt
	}

	asInt64, ok := v.(int64)
	if ok {
		n := int(asInt64)
		return &n
	}

	asFloat64, ok := v.(float64)
	if ok {
		return integralFloatOrder(asFloat64)
	}

	asString, ok := v.(string)
	if !ok {
		return nil
	}
	n, err := strconv.Atoi(strings.TrimSpace(asString))
	if err != nil {
		return nil
	}
	return &n
}

// integralFloatOrder accepts JSON-decoded whole numbers and rejects fractions.
func integralFloatOrder(v float64) *int {
	n := int(v)
	if float64(n) != v {
		return nil
	}
	return &n
}
