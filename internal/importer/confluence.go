package importer

import (
	"bytes"
	"context"
	"encoding/xml"
	"fmt"
	htmlstd "html"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"golang.org/x/net/html"
)

type ConfluenceSource struct {
	exportPath  string
	pages       []confluencePage
	attachments []confluenceExportAttachment
}

type confluencePage struct {
	relPath  string
	title    string
	markdown string
	meta     map[string]any
}

type confluenceExportAttachment struct {
	pagePath string
	filePath string
	fileName string
}

func confluenceExportPageDirForAttachment(attachmentDir string) string {
	// attachmentDir is a relative directory in the export, e.g. "Space/Page/attachments/1234"
	parts := strings.Split(attachmentDir, string(filepath.Separator))
	for i := range parts {
		if parts[i] == "attachment" || parts[i] == "attachments" {
			if i == 0 {
				return ""
			}
			return filepath.Join(parts[:i]...)
		}
	}
	return filepath.Dir(attachmentDir)
}

var confluenceExportAssetLinkRe = regexp.MustCompile(`(?i)(src|href)\s*=\s*("([^"]*(?:attachments?|download/attachments)[^"]*/([^/"?#]+))"|'([^']*(?:attachments?|download/attachments)[^']*/([^/'?#]+))')`)

func rewriteConfluenceExportAssetLinks(html string) string {
	return confluenceExportAssetLinkRe.ReplaceAllStringFunc(html, func(m string) string {
		sub := confluenceExportAssetLinkRe.FindStringSubmatch(m)
		filename := sub[4]
		if filename == "" {
			filename = sub[6]
		}
		if filename == "" {
			return m
		}
		return fmt.Sprintf(`%s="_assets/%s"`, sub[1], filename)
	})
}

// confluenceExportEntity represents a page in the Confluence XML export manifest.
type confluenceExportEntity struct {
	ID       string `xml:"id,attr"`
	Title    string `xml:"title"`
	ParentID string `xml:"parent,attr"`
}

func NewConfluence(exportPath string) (*ConfluenceSource, error) {
	info, err := os.Stat(exportPath)
	if err != nil {
		return nil, fmt.Errorf("confluence export path: %w", err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("confluence export path is not a directory: %s", exportPath)
	}

	s := &ConfluenceSource{exportPath: exportPath}
	if err := s.walk(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *ConfluenceSource) Name() string {
	return filepath.Base(s.exportPath)
}

func (s *ConfluenceSource) walk() error {
	// Try to parse hierarchy from entities.xml (Confluence HTML export manifest)
	hierarchy := s.parseHierarchy()
	linkIndex := buildConfluencePageLinkIndex(s.exportPath, hierarchy)

	return filepath.Walk(s.exportPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}

		ext := strings.ToLower(filepath.Ext(path))

		// Collect attachments (non-HTML files in attachment directories)
		if ext != ".html" && ext != ".htm" {
			rel, _ := filepath.Rel(s.exportPath, path)
			dir := filepath.Dir(rel)
			if strings.Contains(dir, "attachment") || strings.Contains(dir, "attachments") {
				s.attachments = append(s.attachments, confluenceExportAttachment{
					pagePath: confluenceExportPageDirForAttachment(dir),
					filePath: path,
					fileName: filepath.Base(path),
				})
			}
			return nil
		}

		data, readErr := os.ReadFile(path)
		if readErr != nil {
			return fmt.Errorf("read %s: %w", path, readErr)
		}

		// Apply macro conversion on raw file content FIRST to preserve
		// CDATA sections that html.Parse would strip
		rawHTML := string(data)
		rawHTML = convertConfluenceMacros(rawHTML)
		rawHTML = rewriteConfluenceExportAssetLinks(rawHTML)
		rawHTML = rewriteConfluenceExportPageLinks(rawHTML, linkIndex)

		doc, parseErr := html.Parse(bytes.NewReader([]byte(rawHTML)))
		if parseErr != nil {
			return fmt.Errorf("parse %s: %w", path, parseErr)
		}

		meta := extractConfluenceMeta(doc)
		title := meta["title"]
		if t, ok := title.(string); ok && t == "" {
			title = strings.TrimSuffix(filepath.Base(path), ext)
			meta["title"] = title
		} else if title == nil {
			title = strings.TrimSuffix(filepath.Base(path), ext)
			meta["title"] = title
		}

		body := findBody(doc)
		// Convert the body to markdown, preserving macro-converted blocks
		bodyHTML := renderHTMLNode(body)
		md := convertMixedContent(bodyHTML)

		titleStr := fmt.Sprintf("%v", meta["title"])
		pageID := fmt.Sprintf("%v", meta["ajs-page-id"])
		if pageID == "<nil>" || pageID == "" {
			pageID = fmt.Sprintf("%v", meta["page-id"])
		}
		if pageID != "" && pageID != "<nil>" {
			meta["confluence_page_id"] = pageID
		}
		relPath := confluencePageRelPath(s.exportPath, path, hierarchy, meta, ext)

		s.pages = append(s.pages, confluencePage{
			relPath:  relPath,
			title:    titleStr,
			markdown: md,
			meta:     meta,
		})
		return nil
	})
}

// parseHierarchy attempts to read the entities.xml manifest from a Confluence
// HTML export to reconstruct the page tree.
func (s *ConfluenceSource) parseHierarchy() map[string]string {
	hierarchy := make(map[string]string)

	// Confluence HTML exports include an entities.xml file
	entitiesPath := filepath.Join(s.exportPath, "entities.xml")
	data, err := os.ReadFile(entitiesPath)
	if err != nil {
		return hierarchy
	}

	// Simple XML parsing for the entities file
	pages := parseEntitiesXML(data)
	if len(pages) == 0 {
		return hierarchy
	}

	// Build parent map
	idToPage := make(map[string]*pageInfo)
	for i := range pages {
		idToPage[pages[i].ID] = &pages[i]
	}

	// Detect duplicate slugs per parent (titles are not unique).
	parentSlugCounts := make(map[string]map[string]int)
	for _, p := range pages {
		parent := p.ParentID
		base := slugifyTitle(p.Title)
		if _, ok := parentSlugCounts[parent]; !ok {
			parentSlugCounts[parent] = make(map[string]int)
		}
		parentSlugCounts[parent][base]++
	}

	// Build hierarchy paths.
	// Store both ID -> path and (best-effort) Title -> path for older exports.
	for _, page := range pages {
		var parts []string
		current := &page
		for current != nil {
			base := slugifyTitle(current.Title)
			seg := base
			if counts, ok := parentSlugCounts[current.ParentID]; ok && counts[base] > 1 && current.ID != "" {
				seg = fmt.Sprintf("%s-%s", base, current.ID)
			}
			parts = append([]string{seg}, parts...)
			if current.ParentID == "" {
				break
			}
			parent, ok := idToPage[current.ParentID]
			if !ok {
				break
			}
			current = parent
		}
		path := strings.Join(parts, "/")
		if page.ID != "" {
			hierarchy[page.ID] = path
		}
		if page.Title != "" {
			// Only set if absent; titles can collide.
			if _, exists := hierarchy[page.Title]; !exists {
				hierarchy[page.Title] = path
			}
		}
	}

	return hierarchy
}

type entitiesXMLDoc struct {
	XMLName xml.Name         `xml:"hibernate-generic"`
	Objects []entitiesObject `xml:"object"`
}

type entitiesObject struct {
	Class      string            `xml:"class,attr"`
	ID        string            `xml:"id"`
	Properties []entitiesProperty `xml:"property"`
	Collections []entitiesCollection `xml:"collection"`
}

type entitiesProperty struct {
	Name  string `xml:"name,attr"`
	Value string `xml:",chardata"`
	ID    string `xml:"id"`
}

type entitiesCollection struct {
	Name     string             `xml:"name,attr"`
	Elements []entitiesElement  `xml:"element"`
}

type entitiesElement struct {
	Class string `xml:"class,attr"`
	ID    string `xml:"id"`
}

type pageInfo struct {
	ID       string
	Title    string
	ParentID string
}

func parseEntitiesXML(data []byte) []pageInfo {
	var pages []pageInfo

	var doc entitiesXMLDoc
	if err := xml.Unmarshal(data, &doc); err != nil {
		// Fallback: try simple regex-based parsing
		return parseEntitiesSimple(data)
	}

	for _, obj := range doc.Objects {
		if obj.Class != "Page" && obj.Class != "page" &&
			!strings.Contains(obj.Class, "Page") {
			continue
		}

		p := pageInfo{ID: obj.ID}
		for _, prop := range obj.Properties {
			switch prop.Name {
			case "title":
				p.Title = prop.Value
			case "parent":
				p.ParentID = prop.ID
			}
		}
		if p.Title != "" {
			pages = append(pages, p)
		}
	}

	return pages
}

func parseEntitiesSimple(data []byte) []pageInfo {
	// Fallback for non-standard entity formats
	return nil
}

// buildExportHierarchyPath converts a Confluence HTML export relative path
// into a clean hierarchy path. Confluence exports often have paths like
// "SpaceName/PageTitle_123456789.html" — we strip the numeric suffixes.
func buildExportHierarchyPath(relPath string) string {
	parts := strings.Split(relPath, string(filepath.Separator))
	var clean []string
	for _, part := range parts {
		// Strip trailing numeric IDs (e.g., "Page-Title_123456789" -> "Page-Title")
		cleaned := stripConfluenceID(part)
		if cleaned != "" {
			clean = append(clean, slugifyTitle(cleaned))
		}
	}
	if len(clean) == 0 {
		return slugifyTitle(relPath)
	}
	return strings.Join(clean, "/")
}

// stripConfluenceID removes the trailing _NNNNNNNN numeric ID that Confluence
// HTML exports append to filenames.
func stripConfluenceID(s string) string {
	// Pattern: "Some-Title_123456789" -> "Some-Title"
	idx := strings.LastIndex(s, "_")
	if idx < 0 {
		return s
	}
	suffix := s[idx+1:]
	allDigits := true
	for _, r := range suffix {
		if r < '0' || r > '9' {
			allDigits = false
			break
		}
	}
	if allDigits && len(suffix) >= 5 {
		return s[:idx]
	}
	return s
}

func (s *ConfluenceSource) Stream(ctx context.Context) (<-chan Record, <-chan error) {
	records := make(chan Record, 64)
	errs := make(chan error, 1)

	go func() {
		defer close(records)
		defer close(errs)

		name := s.Name()
		for i, p := range s.pages {
			if ctx.Err() != nil {
				return
			}

			fields := make(map[string]any, len(p.meta)+1)
			for k, v := range p.meta {
				fields[k] = v
			}
			fields["_raw_content"] = p.markdown

			// Use hierarchy-aware path instead of flat sanitized path
			pk := p.relPath

			rec := Record{
				SourceID:   fmt.Sprintf("confluence:%s:%d", name, i),
				SourceDSN:  s.exportPath,
				Table:      name,
				Fields:     fields,
				PrimaryKey: pk,
			}
			select {
			case records <- rec:
			case <-ctx.Done():
				return
			}
		}

		// Stream attachments as separate records
		for _, att := range s.attachments {
			if ctx.Err() != nil {
				return
			}

			data, err := os.ReadFile(att.filePath)
			if err != nil {
				continue
			}

			attPath := filepath.Join(att.pagePath, "_assets", att.fileName)

			fields := map[string]any{
				"_raw_content":  string(data),
				"_is_binary":    true,
				"_binary_data":  data,
				"title":         att.fileName,
				"attachment_of": att.pagePath,
			}

			rec := Record{
				SourceID:   fmt.Sprintf("confluence:%s:att:%s", name, att.fileName),
				SourceDSN:  s.exportPath,
				Table:      name,
				Fields:     fields,
				PrimaryKey: attPath,
			}
			select {
			case records <- rec:
			case <-ctx.Done():
				return
			}
		}
	}()
	return records, errs
}

func (s *ConfluenceSource) Close() error { return nil }

func extractConfluenceMeta(doc *html.Node) map[string]any {
	meta := map[string]any{}
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode && n.Data == "title" && n.FirstChild != nil {
			meta["title"] = n.FirstChild.Data
		}
		if n.Type == html.ElementNode && n.Data == "meta" {
			var name, content string
			for _, a := range n.Attr {
				switch a.Key {
				case "name":
					name = a.Val
				case "content":
					content = a.Val
				}
			}
			if name != "" && content != "" {
				meta[name] = content
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)
	return meta
}

// renderHTMLNode serializes an html.Node back to its HTML string representation.
func renderHTMLNode(n *html.Node) string {
	if n == nil {
		return ""
	}
	var buf bytes.Buffer
	html.Render(&buf, n)
	return buf.String()
}

// convertMixedContent handles a string that's a mix of HTML elements and
// already-converted markdown (from macro processing). It protects markdown
// blocks from being mangled by the HTML parser.
func convertMixedContent(input string) string {
	// Extract markdown blocks (code fences, admonitions, details, kiwi-query, [[toc]])
	// and replace with placeholders before HTML parsing.
	// We use <kiwi-ph> custom elements which survive HTML parsing.
	var placeholders []string
	placeholder := func(block string) string {
		idx := len(placeholders)
		placeholders = append(placeholders, block)
		return fmt.Sprintf("<kiwi-ph data-idx=\"%d\"></kiwi-ph>", idx)
	}

	protected := input

	// Protect code fences (```...```)
	codeFenceRe := regexp.MustCompile("(?s)```[^\n]*\n.*?```")
	protected = codeFenceRe.ReplaceAllStringFunc(protected, func(match string) string {
		return placeholder(htmlstd.UnescapeString(match))
	})

	// Protect admonitions (:::kind ... :::)
	admonRe := regexp.MustCompile(`(?s):::[a-z]+[^\n]*\n.*?:::`)
	protected = admonRe.ReplaceAllStringFunc(protected, func(match string) string {
		return placeholder(match)
	})

	// Protect [[toc]]
	protected = strings.ReplaceAll(protected, "[[toc]]", placeholder("[[toc]]"))

	// Protect <details> blocks
	detailsRe := regexp.MustCompile(`(?s)<details>.*?</details>`)
	protected = detailsRe.ReplaceAllStringFunc(protected, func(match string) string {
		return placeholder(match)
	})

	// Protect blockquotes that came from panel conversion
	blockquoteRe := regexp.MustCompile(`(?m)(^> .+\n?)+`)
	protected = blockquoteRe.ReplaceAllStringFunc(protected, func(match string) string {
		return placeholder(match)
	})

	// Protect status spans
	statusRe := regexp.MustCompile(`<span class="status[^"]*">[^<]*</span>`)
	protected = statusRe.ReplaceAllStringFunc(protected, func(match string) string {
		return placeholder(match)
	})

	// Now parse the remaining HTML and convert to markdown
	doc := parseHTMLString(protected)
	var md string
	if doc != nil {
		md = htmlToMarkdownWithPlaceholders(findBody(doc), placeholders)
	} else {
		md = protected
		// Restore placeholders in raw text
		for i, block := range placeholders {
			ph := fmt.Sprintf("<kiwi-ph data-idx=\"%d\"></kiwi-ph>", i)
			md = strings.Replace(md, ph, block, 1)
		}
	}

	return strings.TrimSpace(md)
}

// htmlToMarkdownWithPlaceholders is like htmlToMarkdown but recognizes
// <kiwi-ph> elements and replaces them with stored markdown blocks.
func htmlToMarkdownWithPlaceholders(n *html.Node, placeholders []string) string {
	if n == nil {
		return ""
	}
	var buf strings.Builder
	convertNodeWithPlaceholders(&buf, n, 0, placeholders)
	return strings.TrimSpace(buf.String())
}

func convertNodeWithPlaceholders(buf *strings.Builder, n *html.Node, listDepth int, placeholders []string) {
	if n.Type == html.TextNode {
		buf.WriteString(n.Data)
		return
	}

	if n.Type == html.ElementNode && n.Data == "kiwi-ph" {
		// Restore the placeholder
		idxStr := getAttr(n, "data-idx")
		idx := 0
		fmt.Sscanf(idxStr, "%d", &idx)
		if idx >= 0 && idx < len(placeholders) {
			buf.WriteString("\n\n")
			buf.WriteString(placeholders[idx])
			buf.WriteString("\n\n")
		}
		return
	}

	if n.Type != html.ElementNode {
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			convertNodeWithPlaceholders(buf, c, listDepth, placeholders)
		}
		return
	}

	// Delegate to the existing converter logic but with placeholder awareness
	switch n.Data {
	case "h1", "h2", "h3", "h4", "h5", "h6":
		level := int(n.Data[1] - '0')
		buf.WriteString("\n\n")
		buf.WriteString(strings.Repeat("#", level))
		buf.WriteByte(' ')
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			convertNodeWithPlaceholders(buf, c, listDepth, placeholders)
		}
		buf.WriteString("\n\n")

	case "p", "div":
		buf.WriteString("\n\n")
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			convertNodeWithPlaceholders(buf, c, listDepth, placeholders)
		}
		buf.WriteString("\n\n")

	case "br":
		buf.WriteByte('\n')

	case "strong", "b":
		buf.WriteString("**")
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			convertNodeWithPlaceholders(buf, c, listDepth, placeholders)
		}
		buf.WriteString("**")

	case "em", "i":
		buf.WriteString("*")
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			convertNodeWithPlaceholders(buf, c, listDepth, placeholders)
		}
		buf.WriteString("*")

	case "code":
		buf.WriteByte('`')
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			convertNodeWithPlaceholders(buf, c, listDepth, placeholders)
		}
		buf.WriteByte('`')

	case "del", "s":
		buf.WriteString("~~")
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			convertNodeWithPlaceholders(buf, c, listDepth, placeholders)
		}
		buf.WriteString("~~")

	case "u":
		buf.WriteString("<u>")
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			convertNodeWithPlaceholders(buf, c, listDepth, placeholders)
		}
		buf.WriteString("</u>")

	case "sup":
		buf.WriteString("<sup>")
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			convertNodeWithPlaceholders(buf, c, listDepth, placeholders)
		}
		buf.WriteString("</sup>")

	case "sub":
		buf.WriteString("<sub>")
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			convertNodeWithPlaceholders(buf, c, listDepth, placeholders)
		}
		buf.WriteString("</sub>")

	case "pre":
		buf.WriteString("\n\n```\n")
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			convertNodeWithPlaceholders(buf, c, listDepth, placeholders)
		}
		buf.WriteString("\n```\n\n")

	case "a":
		href := getAttr(n, "href")
		buf.WriteByte('[')
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			convertNodeWithPlaceholders(buf, c, listDepth, placeholders)
		}
		buf.WriteString("](")
		buf.WriteString(href)
		buf.WriteByte(')')

	case "img":
		alt := getAttr(n, "alt")
		src := getAttr(n, "src")
		buf.WriteString("![")
		buf.WriteString(alt)
		buf.WriteString("](")
		buf.WriteString(src)
		buf.WriteByte(')')

	case "ul":
		buf.WriteByte('\n')
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			if c.Type == html.ElementNode && c.Data == "li" {
				buf.WriteString(strings.Repeat("  ", listDepth))
				buf.WriteString("- ")
				for gc := c.FirstChild; gc != nil; gc = gc.NextSibling {
					convertNodeWithPlaceholders(buf, gc, listDepth+1, placeholders)
				}
				buf.WriteByte('\n')
			}
		}

	case "ol":
		buf.WriteByte('\n')
		counter := 1
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			if c.Type == html.ElementNode && c.Data == "li" {
				buf.WriteString(strings.Repeat("  ", listDepth))
				fmt.Fprintf(buf, "%d. ", counter)
				for gc := c.FirstChild; gc != nil; gc = gc.NextSibling {
					convertNodeWithPlaceholders(buf, gc, listDepth+1, placeholders)
				}
				buf.WriteByte('\n')
				counter++
			}
		}

	case "table":
		buf.WriteString("\n\n")
		convertTable(buf, n)
		buf.WriteString("\n\n")

	case "blockquote":
		buf.WriteString("\n\n> ")
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			convertNodeWithPlaceholders(buf, c, listDepth, placeholders)
		}
		buf.WriteString("\n\n")

	case "hr":
		buf.WriteString("\n\n---\n\n")

	case "html", "head", "body":
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			convertNodeWithPlaceholders(buf, c, listDepth, placeholders)
		}

	default:
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			convertNodeWithPlaceholders(buf, c, listDepth, placeholders)
		}
	}
}

func findBody(doc *html.Node) *html.Node {
	var body *html.Node
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode && n.Data == "body" {
			body = n
			return
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)
	if body == nil {
		return doc
	}
	return body
}

func htmlToMarkdown(n *html.Node) string {
	if n == nil {
		return ""
	}
	var buf strings.Builder
	convertNode(&buf, n, 0)
	return strings.TrimSpace(buf.String())
}

func convertNode(buf *strings.Builder, n *html.Node, listDepth int) {
	if n.Type == html.TextNode {
		buf.WriteString(n.Data)
		return
	}

	if n.Type != html.ElementNode {
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			convertNode(buf, c, listDepth)
		}
		return
	}

	switch n.Data {
	case "h1", "h2", "h3", "h4", "h5", "h6":
		level := int(n.Data[1] - '0')
		buf.WriteString("\n\n")
		buf.WriteString(strings.Repeat("#", level))
		buf.WriteByte(' ')
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			convertNode(buf, c, listDepth)
		}
		buf.WriteString("\n\n")

	case "p", "div":
		buf.WriteString("\n\n")
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			convertNode(buf, c, listDepth)
		}
		buf.WriteString("\n\n")

	case "br":
		buf.WriteByte('\n')

	case "strong", "b":
		buf.WriteString("**")
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			convertNode(buf, c, listDepth)
		}
		buf.WriteString("**")

	case "em", "i":
		buf.WriteString("*")
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			convertNode(buf, c, listDepth)
		}
		buf.WriteString("*")

	case "code":
		buf.WriteByte('`')
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			convertNode(buf, c, listDepth)
		}
		buf.WriteByte('`')

	case "del", "s":
		buf.WriteString("~~")
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			convertNode(buf, c, listDepth)
		}
		buf.WriteString("~~")

	case "u":
		buf.WriteString("<u>")
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			convertNode(buf, c, listDepth)
		}
		buf.WriteString("</u>")

	case "sup":
		buf.WriteString("<sup>")
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			convertNode(buf, c, listDepth)
		}
		buf.WriteString("</sup>")

	case "sub":
		buf.WriteString("<sub>")
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			convertNode(buf, c, listDepth)
		}
		buf.WriteString("</sub>")

	case "pre":
		buf.WriteString("\n\n```\n")
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			convertNode(buf, c, listDepth)
		}
		buf.WriteString("\n```\n\n")

	case "a":
		href := getAttr(n, "href")
		buf.WriteByte('[')
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			convertNode(buf, c, listDepth)
		}
		buf.WriteString("](")
		buf.WriteString(href)
		buf.WriteByte(')')

	case "img":
		alt := getAttr(n, "alt")
		src := getAttr(n, "src")
		buf.WriteString("![")
		buf.WriteString(alt)
		buf.WriteString("](")
		buf.WriteString(src)
		buf.WriteByte(')')

	case "ul":
		buf.WriteByte('\n')
		counter := 0
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			if c.Type == html.ElementNode && c.Data == "li" {
				buf.WriteString(strings.Repeat("  ", listDepth))
				buf.WriteString("- ")
				for gc := c.FirstChild; gc != nil; gc = gc.NextSibling {
					convertNode(buf, gc, listDepth+1)
				}
				buf.WriteByte('\n')
				counter++
			}
		}

	case "ol":
		buf.WriteByte('\n')
		counter := 1
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			if c.Type == html.ElementNode && c.Data == "li" {
				buf.WriteString(strings.Repeat("  ", listDepth))
				fmt.Fprintf(buf, "%d. ", counter)
				for gc := c.FirstChild; gc != nil; gc = gc.NextSibling {
					convertNode(buf, gc, listDepth+1)
				}
				buf.WriteByte('\n')
				counter++
			}
		}

	case "table":
		buf.WriteString("\n\n")
		convertTable(buf, n)
		buf.WriteString("\n\n")

	case "blockquote":
		buf.WriteString("\n\n> ")
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			convertNode(buf, c, listDepth)
		}
		buf.WriteString("\n\n")

	case "hr":
		buf.WriteString("\n\n---\n\n")

	default:
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			convertNode(buf, c, listDepth)
		}
	}
}

func convertTable(buf *strings.Builder, table *html.Node) {
	var rows [][]string
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode && (n.Data == "tr") {
			var cells []string
			for c := n.FirstChild; c != nil; c = c.NextSibling {
				if c.Type == html.ElementNode && (c.Data == "td" || c.Data == "th") {
					var cellBuf strings.Builder
					for gc := c.FirstChild; gc != nil; gc = gc.NextSibling {
						convertNode(&cellBuf, gc, 0)
					}
					cells = append(cells, strings.TrimSpace(cellBuf.String()))
				}
			}
			if len(cells) > 0 {
				rows = append(rows, cells)
			}
			return
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(table)

	if len(rows) == 0 {
		return
	}

	// Header row.
	buf.WriteString("| ")
	buf.WriteString(strings.Join(rows[0], " | "))
	buf.WriteString(" |\n")

	// Separator.
	buf.WriteString("|")
	for range rows[0] {
		buf.WriteString(" --- |")
	}
	buf.WriteByte('\n')

	// Data rows.
	for _, row := range rows[1:] {
		buf.WriteString("| ")
		// Pad to match header column count.
		padded := make([]string, len(rows[0]))
		copy(padded, row)
		buf.WriteString(strings.Join(padded, " | "))
		buf.WriteString(" |\n")
	}
}

func getAttr(n *html.Node, key string) string {
	for _, a := range n.Attr {
		if a.Key == key {
			return a.Val
		}
	}
	return ""
}
