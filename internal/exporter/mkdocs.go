package exporter

import (
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

var mkdocsWikiLinkRe = regexp.MustCompile(`\[\[([^\]|]+)(?:\|([^\]]+))?\]\]`)

// MkDocsOptions configures static MkDocs project export.
type MkDocsOptions struct {
	OutputDir  string
	PathPrefix string
	SiteName   string
	SiteURL    string
	RepoURL    string
}

type mkdocsPage struct {
	path  string
	title string
	order int
}

type mkdocsNavNode struct {
	title    string
	path     string
	order    int
	children map[string]*mkdocsNavNode
}

// ExportMkDocs writes a valid MkDocs project (mkdocs.yml + docs/) to opts.OutputDir.
func ExportMkDocs(ctx context.Context, store storage.Storage, opts MkDocsOptions) (int, error) {
	if opts.OutputDir == "" {
		return 0, fmt.Errorf("output directory is required")
	}

	docsDir := filepath.Join(opts.OutputDir, "docs")
	if err := os.MkdirAll(docsDir, 0o755); err != nil {
		return 0, fmt.Errorf("create docs dir: %w", err)
	}

	walkRoot := "/"
	if opts.PathPrefix != "" {
		walkRoot = strings.TrimPrefix(opts.PathPrefix, "/")
		if walkRoot == "" {
			walkRoot = "/"
		}
	}

	var allPaths []string
	var pages []mkdocsPage

	err := storage.Walk(ctx, store, walkRoot, func(entry storage.Entry) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if !strings.HasSuffix(strings.ToLower(entry.Path), ".md") {
			return nil
		}
		base := filepath.Base(entry.Path)
		if strings.HasPrefix(base, ".") || strings.Contains(entry.Path, "/.kiwi/") {
			return nil
		}
		if opts.PathPrefix != "" && !strings.HasPrefix(entry.Path, strings.TrimPrefix(opts.PathPrefix, "/")) {
			return nil
		}
		allPaths = append(allPaths, entry.Path)
		return nil
	})
	if err != nil {
		return 0, err
	}

	wikiIdx := buildMkdocsWikiIndex(allPaths)
	count := 0

	for _, pagePath := range allPaths {
		if ctx.Err() != nil {
			return count, ctx.Err()
		}

		content, err := store.Read(ctx, pagePath)
		if err != nil {
			continue
		}

		parsed, _ := markdown.Parse(content)
		title := strings.TrimSuffix(filepath.Base(pagePath), ".md")
		order := 9999
		if parsed.Frontmatter != nil {
			if t, ok := parsed.Frontmatter["title"].(string); ok && t != "" {
				title = t
			}
			if o := mkdocsExtractOrder(parsed.Frontmatter); o >= 0 {
				order = o
			}
		}

		rel := strings.TrimPrefix(pagePath, "/")
		if walkRoot != "/" && walkRoot != "" {
			rel = strings.TrimPrefix(pagePath, walkRoot)
			rel = strings.TrimPrefix(rel, "/")
		}

		outBytes, err := prepareMkdocsPage(content, rel, wikiIdx)
		if err != nil {
			return count, fmt.Errorf("prepare %s: %w", pagePath, err)
		}

		destPath := filepath.Join(docsDir, rel)
		if err := os.MkdirAll(filepath.Dir(destPath), 0o755); err != nil {
			return count, fmt.Errorf("mkdir %s: %w", filepath.Dir(destPath), err)
		}
		if err := os.WriteFile(destPath, outBytes, 0o644); err != nil {
			return count, fmt.Errorf("write %s: %w", destPath, err)
		}

		pages = append(pages, mkdocsPage{path: rel, title: title, order: order})
		count++
	}

	nav := buildMkdocsNav(pages)
	cfg, err := generateMkdocsYAML(opts, nav)
	if err != nil {
		return count, err
	}
	if err := os.WriteFile(filepath.Join(opts.OutputDir, "mkdocs.yml"), cfg, 0o644); err != nil {
		return count, fmt.Errorf("write mkdocs.yml: %w", err)
	}

	return count, nil
}

func buildMkdocsWikiIndex(paths []string) map[string]string {
	idx := make(map[string]string, len(paths)*4)
	for _, p := range paths {
		for _, form := range links.TargetForms(p) {
			lower := strings.ToLower(form)
			if _, exists := idx[lower]; !exists {
				idx[lower] = p
			}
		}
	}
	return idx
}

func prepareMkdocsPage(content []byte, relPath string, wikiIdx map[string]string) ([]byte, error) {
	fm, body, fmErr := markdown.SplitFrontmatter(content)
	bodyStr := string(body)
	if fmErr != nil {
		bodyStr = string(content)
		fm = nil
	}

	converted := convertWikiLinksForMkDocs(bodyStr, relPath, wikiIdx)

	var out []byte
	if fm != nil {
		cleanFM, err := sanitizeMkdocsFrontmatter(fm)
		if err != nil {
			return nil, err
		}
		if len(cleanFM) > 0 {
			out = append(out, []byte("---\n")...)
			out = append(out, cleanFM...)
			out = append(out, []byte("---\n")...)
		}
	}
	out = append(out, []byte(converted)...)
	return out, nil
}

func sanitizeMkdocsFrontmatter(fm []byte) ([]byte, error) {
	var data map[string]any
	if err := yaml.Unmarshal(fm, &data); err != nil {
		return fm, nil
	}
	clean := make(map[string]any)
	for k, v := range data {
		if strings.HasPrefix(k, "_") {
			continue
		}
		switch k {
		case "memory_kind", "doc_id", "episode_id", "repo", "issue_number", "languages", "status":
			continue
		}
		clean[k] = v
	}
	if len(clean) == 0 {
		return nil, nil
	}
	return yaml.Marshal(clean)
}

func convertWikiLinksForMkDocs(content, sourcePath string, wikiIdx map[string]string) string {
	lines := strings.Split(content, "\n")
	inFencedBlock := false
	fencePrefix := ""

	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if !inFencedBlock {
			if strings.HasPrefix(trimmed, "```") || strings.HasPrefix(trimmed, "~~~") {
				inFencedBlock = true
				fencePrefix = trimmed[:3]
				continue
			}
		} else {
			if strings.HasPrefix(trimmed, fencePrefix) && strings.TrimSpace(strings.TrimLeft(trimmed, fencePrefix[:1])) == "" {
				inFencedBlock = false
			}
			continue
		}

		lines[i] = replaceWikiLinksOutsideInlineCode(line, sourcePath, wikiIdx)
	}
	return strings.Join(lines, "\n")
}

func replaceWikiLinksOutsideInlineCode(line, sourcePath string, wikiIdx map[string]string) string {
	var result strings.Builder
	remaining := line
	for {
		idx := strings.Index(remaining, "`")
		if idx < 0 {
			result.WriteString(replaceSingleLineWikiLinks(remaining, sourcePath, wikiIdx))
			break
		}
		result.WriteString(replaceSingleLineWikiLinks(remaining[:idx], sourcePath, wikiIdx))

		remaining = remaining[idx:]
		end := strings.Index(remaining[1:], "`")
		if end < 0 {
			result.WriteString(remaining)
			break
		}
		result.WriteString(remaining[:end+2])
		remaining = remaining[end+2:]
	}
	return result.String()
}

func replaceSingleLineWikiLinks(s, sourcePath string, wikiIdx map[string]string) string {
	return mkdocsWikiLinkRe.ReplaceAllStringFunc(s, func(match string) string {
		sub := mkdocsWikiLinkRe.FindStringSubmatch(match)
		if len(sub) < 2 {
			return match
		}
		target := strings.TrimSpace(sub[1])
		label := target
		if len(sub) >= 3 && sub[2] != "" {
			label = strings.TrimSpace(sub[2])
		}

		anchor := ""
		if hashIdx := strings.Index(target, "#"); hashIdx >= 0 {
			anchor = target[hashIdx:]
			target = target[:hashIdx]
		}

		if target == "" {
			return match
		}

		resolved := wikiIdx[strings.ToLower(target)]
		if resolved == "" {
			return match
		}
		rel := mkdocsRelativeLink(sourcePath, resolved)
		return fmt.Sprintf("[%s](%s%s)", label, rel, anchor)
	})
}

func mkdocsRelativeLink(fromPath, toPath string) string {
	fromDir := filepath.Dir(fromPath)
	rel, err := filepath.Rel(fromDir, toPath)
	if err != nil {
		return toPath
	}
	return filepath.ToSlash(rel)
}

func mkdocsExtractOrder(fm map[string]any) int {
	for _, key := range []string{"nav_order", "order"} {
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

func buildMkdocsNav(pages []mkdocsPage) []any {
	root := &mkdocsNavNode{children: make(map[string]*mkdocsNavNode)}
	for _, p := range pages {
		parts := strings.Split(p.path, "/")
		cur := root
		for i := 0; i < len(parts)-1; i++ {
			seg := parts[i]
			if cur.children[seg] == nil {
				cur.children[seg] = &mkdocsNavNode{
					title:    seg,
					order:    9999,
					children: make(map[string]*mkdocsNavNode),
				}
			}
			cur = cur.children[seg]
			if p.order < cur.order {
				cur.order = p.order
			}
		}
		leaf := parts[len(parts)-1]
		cur.children[leaf] = &mkdocsNavNode{title: p.title, path: p.path, order: p.order}
	}

	keys := sortedNavKeys(root.children)
	nav := make([]any, 0, len(keys))
	for _, k := range keys {
		nav = append(nav, navNodeToYAML(k, root.children[k]))
	}
	return nav
}

func sortedNavKeys(nodes map[string]*mkdocsNavNode) []string {
	keys := make([]string, 0, len(nodes))
	for k := range nodes {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		ni, nj := nodes[keys[i]], nodes[keys[j]]
		if ni.order != nj.order {
			return ni.order < nj.order
		}
		return ni.title < nj.title
	})
	return keys
}

func navNodeToYAML(key string, node *mkdocsNavNode) any {
	if node.path != "" {
		return map[string]string{node.title: node.path}
	}
	childKeys := sortedNavKeys(node.children)
	items := make([]any, 0, len(childKeys))
	for _, ck := range childKeys {
		items = append(items, navNodeToYAML(ck, node.children[ck]))
	}
	return map[string]any{node.title: items}
}

func generateMkdocsYAML(opts MkDocsOptions, nav []any) ([]byte, error) {
	siteName := opts.SiteName
	if siteName == "" {
		siteName = "Knowledge Base"
	}

	config := map[string]any{
		"site_name": siteName,
		"theme": map[string]any{
			"name": "material",
			"features": []string{
				"navigation.sections",
				"search.suggest",
				"search.highlight",
			},
		},
		"plugins": []string{"search"},
		"markdown_extensions": []string{
			"tables",
			"fenced_code",
			"footnotes",
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
		config["nav"] = nav
	}

	return yaml.Marshal(config)
}
