package storage

import (
	"context"
	"path/filepath"
	"sort"
	"strings"

	"github.com/fvbommel/sortorder"
)

type TreeEntry struct {
	Path             string       `json:"path"`
	Name             string       `json:"name"`
	IsDir            bool         `json:"isDir"`
	Size             int64        `json:"size,omitempty"`
	FrontmatterError string       `json:"frontmatterError,omitempty"`
	Children         []*TreeEntry `json:"children,omitempty"`
}

type frontmatterErrorReader interface {
	ReadFrontmatterError(ctx context.Context, path string) (string, error)
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

	applyFrontmatterError(ctx, store, child)
	applyTreeChildren(ctx, store, child, depth)
	return child
}

// applyFrontmatterError attaches parse errors so the UI can warn about broken frontmatter.
func applyFrontmatterError(ctx context.Context, store Storage, child *TreeEntry) {
	if child.IsDir {
		return
	}
	if !isMarkdownPath(child.Path) {
		return
	}
	child.FrontmatterError = readFrontmatterError(ctx, store, child.Path)
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

// sortTreeChildren sorts entries using natural (human/version) sort order
// so that "2-foo" comes before "10-bar".
func sortTreeChildren(children []*TreeEntry) {
	sort.SliceStable(children, func(i, j int) bool {
		return sortorder.NaturalLess(
			strings.ToLower(children[i].Name),
			strings.ToLower(children[j].Name),
		)
	})
}

// isMarkdownPath reports whether the path is a markdown file.
func isMarkdownPath(path string) bool {
	lower := strings.ToLower(path)
	return strings.HasSuffix(lower, ".md") || strings.HasSuffix(lower, ".markdown")
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
