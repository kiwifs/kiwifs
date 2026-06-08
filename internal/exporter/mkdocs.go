package exporter

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/kiwifs/kiwifs/internal/links"
	"github.com/kiwifs/kiwifs/internal/markdown"
	"github.com/kiwifs/kiwifs/internal/storage"
	"gopkg.in/yaml.v3"
)

// MkDocsOptions controls MkDocs static-site export.
type MkDocsOptions struct {
	OutputDir  string // destination directory for mkdocs.yml + docs/
	PathPrefix string // scope export to a subdirectory (empty = entire tree)
	SiteName   string
	SiteURL    string
	RepoURL    string
	Limit      int
}

type mkdocsPage struct {
	storagePath string
	relPath     string
	title       string
	order       int
}

type mkdocsNavEntry struct {
	title    string
	path     string
	children []mkdocsNavEntry
	order    int
}

var mkdocsWikiLinkRe = regexp.MustCompile(`!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]`)

var mkdocsStripFrontmatterKeys = map[string]bool{
	"order": true, "nav_order": true, "type": true, "published": true,
	"memory_kind": true, "doc_id": true, "episode_id": true, "tags": true,
	"status": true, "repo": true, "issue_number": true, "languages": true,
	"date": true,
}

// ExportMkDocs writes a valid MkDocs project (mkdocs.yml + docs/) to OutputDir.
func ExportMkDocs(ctx context.Context, store storage.Storage, opts MkDocsOptions) (int, error) {
	if opts.OutputDir == "" {
		return 0, fmt.Errorf("output directory is required")
	}

	docsDir := filepath.Join(opts.OutputDir, "docs")
	if err := os.MkdirAll(docsDir, 0755); err != nil {
		return 0, fmt.Errorf("create docs dir: %w", err)
	}

	inputDir := opts.PathPrefix
	if inputDir == "" {
		inputDir = "/"
	}

	pages, err := collectMkDocsPages(ctx, store, inputDir)
	if err != nil {
		return 0, err
	}
	if opts.Limit > 0 && len(pages) > opts.Limit {
		pages = pages[:opts.Limit]
	}

	linkIndex := buildMkDocsLinkIndex(pages)

	for _, p := range pages {
		content, err := store.Read(ctx, p.storagePath)
		if err != nil {
			return 0, fmt.Errorf("read %s: %w", p.storagePath, err)
		}

		prepared := prepareMkDocsMarkdown(content, p.relPath, linkIndex)
		destPath := filepath.Join(docsDir, filepath.FromSlash(p.relPath))
		if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
			return 0, fmt.Errorf("mkdir %s: %w", filepath.Dir(destPath), err)
		}
		if err := os.WriteFile(destPath, prepared, 0644); err != nil {
			return 0, fmt.Errorf("write %s: %w", destPath, err)
		}
	}

	nav := buildMkDocsNav(pages)
	config, err := generateMkDocsYAML(opts, nav)
	if err != nil {
		return 0, fmt.Errorf("generate mkdocs config: %w", err)
	}

	mkdocsPath := filepath.Join(opts.OutputDir, "mkdocs.yml")
	if err := os.WriteFile(mkdocsPath, config, 0644); err != nil {
		return 0, fmt.Errorf("write mkdocs.yml: %w", err)
	}

	return len(pages), nil
}

func collectMkDocsPages(ctx context.Context, store storage.Storage, inputDir string) ([]mkdocsPage, error) {
	var pages []mkdocsPage

	err := storage.Walk(ctx, store, inputDir, func(entry storage.Entry) error {
		if !strings.HasSuffix(strings.ToLower(entry.Path), ".md") {
			return nil
		}
		base := filepath.Base(entry.Path)
		if strings.HasPrefix(base, ".") || strings.Contains(entry.Path, "/.kiwi/") {
			return nil
		}

		content, err := store.Read(ctx, entry.Path)
		if err != nil {
			return nil
		}

		parsed, _ := markdown.Parse(content)
		title := strings.TrimSuffix(base, ".md")
		order := 9999
		if parsed.Frontmatter != nil {
			if t, ok := parsed.Frontmatter["title"].(string); ok && t != "" {
				title = t
			}
			if o := extractMkDocsOrder(parsed.Frontmatter); o >= 0 {
				order = o
			}
			if published, ok := parsed.Frontmatter["published"].(bool); ok && !published {
				return nil
			}
		}

		rel := entry.Path
		prefix := strings.TrimPrefix(inputDir, "/")
		if prefix != "" && inputDir != "/" {
			rel = strings.TrimPrefix(entry.Path, prefix)
			rel = strings.TrimPrefix(rel, "/")
		}
		if rel == "" {
			rel = base
		}
		rel = filepath.ToSlash(rel)

		pages = append(pages, mkdocsPage{
			storagePath: entry.Path,
			relPath:     rel,
			title:       title,
			order:       order,
		})
		return nil
	})
	return pages, err
}

func buildMkDocsLinkIndex(pages []mkdocsPage) map[string]string {
	idx := make(map[string]string, len(pages)*4)
	for _, p := range pages {
		for _, path := range []string{p.relPath, p.storagePath} {
			for _, form := range links.TargetForms(path) {
				lower := strings.ToLower(form)
				if _, exists := idx[lower]; !exists {
					idx[lower] = p.relPath
				}
			}
		}
	}
	return idx
}

func prepareMkDocsMarkdown(content []byte, sourceRel string, linkIndex map[string]string) []byte {
	body := convertMkDocsFrontmatter(content)
	return []byte(rewriteMkDocsWikiLinks(string(body), sourceRel, linkIndex))
}

func convertMkDocsFrontmatter(content []byte) []byte {
	parsed, err := markdown.Parse(content)
	if err != nil || parsed.Frontmatter == nil {
		return stripMkDocsFrontmatter(content)
	}

	clean := make(map[string]any)
	for key, val := range parsed.Frontmatter {
		if mkdocsStripFrontmatterKeys[key] {
			continue
		}
		if key == "title" || key == "description" || key == "sidebar_position" {
			clean[key] = val
		}
	}

	body := stripMkDocsFrontmatter(content)
	if len(clean) == 0 {
		return body
	}

	fm, err := yaml.Marshal(clean)
	if err != nil {
		return body
	}

	var buf bytes.Buffer
	buf.WriteString("---\n")
	buf.Write(fm)
	buf.WriteString("---\n")
	buf.Write(body)
	return buf.Bytes()
}

func stripMkDocsFrontmatter(content []byte) []byte {
	s := string(content)
	if !strings.HasPrefix(s, "---") {
		return content
	}
	after := s[3:]
	if len(after) == 0 {
		return content
	}
	if after[0] == '\r' {
		after = after[1:]
	}
	if len(after) == 0 || after[0] != '\n' {
		return content
	}
	after = after[1:]

	closerIdx := -1
	if strings.HasPrefix(after, "---") {
		closerIdx = 0
	} else if idx := strings.Index(after, "\n---"); idx >= 0 {
		closerIdx = idx + 1
	} else if idx := strings.Index(after, "\r\n---"); idx >= 0 {
		closerIdx = idx + 2
	}
	if closerIdx < 0 {
		return content
	}

	end := closerIdx + 3
	if end < len(after) && after[end] == '\r' {
		end++
	}
	if end < len(after) && after[end] == '\n' {
		end++
	}
	return []byte(after[end:])
}

func rewriteMkDocsWikiLinks(content, sourceRel string, linkIndex map[string]string) string {
	if len(linkIndex) == 0 {
		return content
	}
	return mkdocsWikiLinkRe.ReplaceAllStringFunc(content, func(match string) string {
		sub := mkdocsWikiLinkRe.FindStringSubmatch(match)
		if len(sub) < 2 {
			return match
		}
		target := strings.TrimSpace(sub[1])
		label := target
		if len(sub) >= 3 && sub[2] != "" {
			label = strings.TrimSpace(sub[2])
		}
		resolved := linkIndex[strings.ToLower(target)]
		if resolved == "" {
			return match
		}
		rel, err := mkdocsRelativeLink(sourceRel, resolved)
		if err != nil || rel == "" {
			return match
		}
		return "[" + label + "](" + rel + ")"
	})
}

func mkdocsRelativeLink(from, to string) (string, error) {
	fromDir := filepath.Dir(filepath.FromSlash(from))
	rel, err := filepath.Rel(fromDir, filepath.FromSlash(to))
	if err != nil {
		return "", err
	}
	return filepath.ToSlash(rel), nil
}

type mkdocsNavTreeNode struct {
	name     string
	pages    []mkdocsPage
	children map[string]*mkdocsNavTreeNode
}

func buildMkDocsNav(pages []mkdocsPage) []mkdocsNavEntry {
	if len(pages) == 0 {
		return nil
	}

	root := &mkdocsNavTreeNode{children: make(map[string]*mkdocsNavTreeNode)}
	for _, p := range pages {
		parts := strings.Split(p.relPath, "/")
		n := root
		for i := 0; i < len(parts)-1; i++ {
			seg := parts[i]
			if n.children[seg] == nil {
				n.children[seg] = &mkdocsNavTreeNode{name: seg, children: make(map[string]*mkdocsNavTreeNode)}
			}
			n = n.children[seg]
		}
		n.pages = append(n.pages, p)
	}

	return mkdocsNodeToNav(root)
}

func mkdocsNodeToNav(n *mkdocsNavTreeNode) []mkdocsNavEntry {
	var entries []mkdocsNavEntry

	for _, p := range n.pages {
		entries = append(entries, mkdocsNavEntry{
			title: p.title,
			path:  p.relPath,
			order: p.order,
		})
	}

	for _, d := range sortedMkDocsNodeKeys(n.children) {
		child := n.children[d]
		children := mkdocsNodeToNav(child)
		if len(children) == 0 {
			continue
		}
		entries = append(entries, mkdocsNavEntry{
			title:    humanizeMkDocsDirName(d),
			children: children,
			order:    mkdocsMinNavOrder(children),
		})
	}

	sortMkDocsNavEntries(entries)
	return entries
}

func mkdocsMinNavOrder(entries []mkdocsNavEntry) int {
	min := 9999
	for _, e := range entries {
		o := e.order
		if len(e.children) > 0 {
			o = mkdocsMinNavOrder(e.children)
		}
		if o < min {
			min = o
		}
	}
	return min
}

func sortedMkDocsNodeKeys(m map[string]*mkdocsNavTreeNode) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func humanizeMkDocsDirName(name string) string {
	name = strings.NewReplacer("-", " ", "_", " ").Replace(name)
	words := strings.Fields(name)
	for i, w := range words {
		if len(w) > 0 {
			words[i] = strings.ToUpper(w[:1]) + strings.ToLower(w[1:])
		}
	}
	return strings.Join(words, " ")
}

func sortMkDocsNavEntries(entries []mkdocsNavEntry) {
	for i := 0; i < len(entries); i++ {
		for j := i + 1; j < len(entries); j++ {
			if lessMkDocsNavEntry(entries[j], entries[i]) {
				entries[i], entries[j] = entries[j], entries[i]
			}
		}
	}
}

func lessMkDocsNavEntry(a, b mkdocsNavEntry) bool {
	if a.order != b.order {
		return a.order < b.order
	}
	aIsCat := len(a.children) > 0
	bIsCat := len(b.children) > 0
	if aIsCat != bIsCat {
		return !aIsCat // leaf pages before categories at same order
	}
	return a.title < b.title
}

func extractMkDocsOrder(fm map[string]any) int {
	for _, key := range []string{"nav_order", "order", "sidebar_position"} {
		if v, ok := fm[key]; ok {
			switch n := v.(type) {
			case int:
				return n
			case float64:
				return int(n)
			}
		}
	}
	return -1
}

func mkdocsNavToYAML(entries []mkdocsNavEntry) []any {
	result := make([]any, 0, len(entries))
	for _, e := range entries {
		if len(e.children) > 0 {
			result = append(result, map[string]any{e.title: mkdocsNavToYAML(e.children)})
			continue
		}
		if e.path != "" {
			result = append(result, map[string]string{e.title: e.path})
		}
	}
	return result
}

func generateMkDocsYAML(opts MkDocsOptions, nav []mkdocsNavEntry) ([]byte, error) {
	siteName := opts.SiteName
	if siteName == "" {
		siteName = "Knowledge Base"
	}

	config := map[string]any{
		"site_name": siteName,
		"theme": map[string]any{
			"name":    "material",
			"palette": map[string]string{"scheme": "default"},
			"features": []string{
				"navigation.tabs",
				"navigation.sections",
				"navigation.expand",
				"search.suggest",
				"search.highlight",
				"content.code.copy",
			},
		},
		"plugins": []string{"search"},
		"markdown_extensions": []string{
			"tables",
			"fenced_code",
			"footnotes",
			"attr_list",
			"def_list",
			"admonition",
			"toc",
		},
	}

	if opts.SiteURL != "" {
		config["site_url"] = opts.SiteURL
	}
	if opts.RepoURL != "" {
		config["repo_url"] = opts.RepoURL
	}
	if len(nav) > 0 {
		config["nav"] = mkdocsNavToYAML(nav)
	}

	data, err := yaml.Marshal(config)
	if err != nil {
		return nil, fmt.Errorf("marshal mkdocs config: %w", err)
	}
	return data, nil
}
