package importer

import (
	"bytes"
	"fmt"
	stdhtml "html"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"golang.org/x/net/html"
)

var confluencePageAnchorRe = regexp.MustCompile(`(?is)<a\s+[^>]*href\s*=\s*(?:"([^"]+\.html?)(#[^"]*)?"|'([^']+\.html?)(#[^']*)?')[^>]*>(.*?)</a>`)

// confluencePageRelPath returns the wiki-relative path for a Confluence HTML export file.
func confluencePageRelPath(exportPath, htmlFile string, hierarchy map[string]string, meta map[string]any, ext string) string {
	rel, _ := filepath.Rel(exportPath, htmlFile)
	relPath := strings.TrimSuffix(rel, ext)

	pageID := fmt.Sprintf("%v", meta["ajs-page-id"])
	if pageID == "<nil>" || pageID == "" {
		pageID = fmt.Sprintf("%v", meta["page-id"])
	}
	titleStr := fmt.Sprintf("%v", meta["title"])

	if pageID != "" && pageID != "<nil>" {
		if hierPath, ok := hierarchy[pageID]; ok {
			return hierPath
		}
	}
	if hierPath, ok := hierarchy[titleStr]; ok {
		return hierPath
	}
	return buildExportHierarchyPath(relPath)
}

func registerConfluencePageLinkKeys(index map[string]string, rel, relPath, ext string) {
	rel = filepath.ToSlash(rel)
	base := filepath.Base(rel)
	keys := []string{
		strings.ToLower(base),
		strings.ToLower(strings.TrimSuffix(base, ext)),
		strings.ToLower(rel),
		strings.ToLower(strings.TrimSuffix(rel, ext)),
	}
	for _, k := range keys {
		if k != "" {
			index[k] = relPath
		}
	}
}

// buildConfluencePageLinkIndex maps exported HTML filenames and relative paths to wiki paths.
func buildConfluencePageLinkIndex(exportPath string, hierarchy map[string]string) map[string]string {
	index := make(map[string]string)
	_ = filepath.Walk(exportPath, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		if ext != ".html" && ext != ".htm" {
			return nil
		}

		data, readErr := os.ReadFile(path)
		if readErr != nil {
			return nil
		}

		doc, parseErr := html.Parse(bytes.NewReader(data))
		if parseErr != nil {
			return nil
		}

		meta := extractConfluenceMeta(doc)
		title := meta["title"]
		if t, ok := title.(string); ok && t == "" {
			meta["title"] = strings.TrimSuffix(filepath.Base(path), ext)
		} else if title == nil {
			meta["title"] = strings.TrimSuffix(filepath.Base(path), ext)
		}

		rel, _ := filepath.Rel(exportPath, path)
		relPath := confluencePageRelPath(exportPath, path, hierarchy, meta, ext)
		registerConfluencePageLinkKeys(index, rel, relPath, ext)
		return nil
	})
	return index
}

func lookupConfluencePageLinkTarget(href string, index map[string]string) string {
	href = strings.TrimSpace(href)
	if href == "" {
		return ""
	}
	href = filepath.ToSlash(href)
	candidates := []string{
		strings.ToLower(href),
		strings.ToLower(filepath.Base(href)),
	}
	if ext := filepath.Ext(href); ext != "" {
		candidates = append(candidates, strings.ToLower(strings.TrimSuffix(href, ext)))
		candidates = append(candidates, strings.ToLower(strings.TrimSuffix(filepath.Base(href), ext)))
	}
	for _, k := range candidates {
		if target, ok := index[k]; ok {
			return target
		}
	}
	return ""
}

// rewriteConfluenceExportPageLinks converts internal HTML page anchors to wiki links.
func rewriteConfluenceExportPageLinks(rawHTML string, index map[string]string) string {
	if len(index) == 0 {
		return rawHTML
	}
	return confluencePageAnchorRe.ReplaceAllStringFunc(rawHTML, func(match string) string {
		sub := confluencePageAnchorRe.FindStringSubmatch(match)
		if len(sub) < 6 {
			return match
		}
		href := sub[1]
		anchor := sub[2]
		if href == "" {
			href = sub[3]
			anchor = sub[4]
		}
		if strings.HasPrefix(strings.ToLower(href), "http://") || strings.HasPrefix(strings.ToLower(href), "https://") {
			return match
		}
		if strings.HasPrefix(href, "_assets/") {
			return match
		}

		target := lookupConfluencePageLinkTarget(href, index)
		if target == "" {
			return match
		}
		if anchor != "" {
			target += anchor
		}

		text := strings.TrimSpace(stripHTMLTags(sub[5]))
		if text == "" {
			return "[[" + target + "]]"
		}
		if strings.EqualFold(text, target) || strings.EqualFold(text, filepath.Base(href)) {
			return "[[" + target + "]]"
		}
		return "[[" + target + "|" + text + "]]"
	})
}

func stripHTMLTags(s string) string {
	re := regexp.MustCompile(`(?is)<[^>]+>`)
	return stdhtml.UnescapeString(strings.TrimSpace(re.ReplaceAllString(s, "")))
}
