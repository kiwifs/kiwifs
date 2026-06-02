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
	Path     string       `json:"path"`
	Name     string       `json:"name"`
	IsDir    bool         `json:"isDir"`
	Size     int64        `json:"size,omitempty"`
	Order    *int         `json:"order,omitempty"`
	Children []*TreeEntry `json:"children,omitempty"`
}

type frontmatterReader interface {
	ReadFrontmatter(ctx context.Context, path string) (map[string]any, error)
}

type treeOrderReader interface {
	ReadTreeOrder(ctx context.Context, path string) (*int, error)
}

func BuildTree(ctx context.Context, store Storage, path string, depth int) (*TreeEntry, error) {
	entries, err := store.List(ctx, path)
	if err != nil {
		return nil, err
	}

	cleanPath := strings.Trim(path, "/")
	displayName := filepath.Base(cleanPath)
	if cleanPath == "" {
		displayName = "/"
	}
	root := &TreeEntry{
		Path:  cleanPath,
		Name:  displayName,
		IsDir: true,
	}

	for _, e := range entries {
		child := &TreeEntry{
			Path:  e.Path,
			Name:  e.Name,
			IsDir: e.IsDir,
			Size:  e.Size,
		}
		if e.IsDir {
			child.Order = readDirectoryOrder(ctx, store, e.Path)
		} else {
			child.Order = readOrder(ctx, store, e.Path)
		}
		if e.IsDir && depth > 0 {
			sub, err := BuildTree(ctx, store, e.Path, depth-1)
			if err == nil {
				child.Children = sub.Children
			}
		}
		root.Children = append(root.Children, child)
	}
	sortTreeChildren(root.Children)
	return root, nil
}

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

func readDirectoryOrder(ctx context.Context, store Storage, path string) *int {
	if reader, ok := store.(treeOrderReader); ok {
		order, err := reader.ReadTreeOrder(ctx, path)
		if err == nil {
			return order
		}
	}
	return nil
}

func readOrder(ctx context.Context, store Storage, path string) *int {
	if !strings.HasSuffix(strings.ToLower(path), ".md") && !strings.HasSuffix(strings.ToLower(path), ".markdown") {
		return nil
	}
	if reader, ok := store.(frontmatterReader); ok {
		fm, err := reader.ReadFrontmatter(ctx, path)
		if err == nil {
			return frontmatterOrder(fm["order"])
		}
	}
	content, err := store.Read(ctx, path)
	if err != nil {
		return nil
	}
	fm, err := markdown.Frontmatter(content)
	if err != nil {
		return nil
	}
	return frontmatterOrder(fm["order"])
}

func frontmatterOrder(v any) *int {
	switch x := v.(type) {
	case int:
		return &x
	case int64:
		n := int(x)
		return &n
	case float64:
		n := int(x)
		if float64(n) == x {
			return &n
		}
	case string:
		n, err := strconv.Atoi(strings.TrimSpace(x))
		if err == nil {
			return &n
		}
	}
	return nil
}
