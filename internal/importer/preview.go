package importer

import (
	"bytes"
	"fmt"
)

// PreviewItem is one import preview row for the API/UI.
type PreviewItem struct {
	Path        string
	Frontmatter map[string]any
	BodyPreview string
}

// RecordPreviewOpts controls how a record is transformed for preview/import rendering.
type RecordPreviewOpts struct {
	Prefix         string
	IDColumn       string
	Columns        []string
	FieldMappings  []FieldMapping
	SourceName     string
	DefaultPrefix  string // used when Prefix is empty
}

// BuildPreviewItem renders one record the same way as Run(), for preview endpoints.
func BuildPreviewItem(rec Record, opts RecordPreviewOpts) PreviewItem {
	fields := rec.Fields
	if len(opts.Columns) > 0 {
		fields = filterColumns(fields, opts.Columns)
	}
	if len(opts.FieldMappings) > 0 {
		fields = ApplyFieldMappings(fields, opts.FieldMappings)
	}

	prefix := opts.Prefix
	if prefix == "" {
		prefix = opts.DefaultPrefix
	}
	if prefix == "" {
		prefix = opts.SourceName
	}

	pk := rec.PrimaryKey
	if opts.IDColumn != "" {
		if v, ok := fields[opts.IDColumn]; ok {
			pk = fmt.Sprintf("%v", v)
		}
	}
	if pk == "" {
		pk = rec.SourceID
	}

	path := fmt.Sprintf("%s/%s.md", prefix, SanitizePath(pk))

	fm := make(map[string]any, len(fields)+2)
	for k, v := range fields {
		fm[k] = v
	}
	fm["_source"] = opts.SourceName
	fm["_source_id"] = rec.SourceID

	title := pk
	if t, ok := fields["title"].(string); ok && t != "" {
		title = t
	} else if t, ok := fields["name"].(string); ok && t != "" {
		title = t
	}

	var bodyPreview string
	if rawContent, ok := fields["_raw_content"].(string); ok && rawContent != "" {
		body := BodyAfterFrontmatter(renderRawContent(rawContent, opts.SourceName, rec.SourceID))
		bodyPreview = truncatePreview(body)
	} else {
		content := renderMarkdown(fm, title, rec.Table, rec.SourceID)
		body := BodyAfterFrontmatter(content)
		bodyPreview = truncatePreview(body)
	}

	return PreviewItem{
		Path:        path,
		Frontmatter: fm,
		BodyPreview: bodyPreview,
	}
}

// BodyAfterFrontmatter returns markdown body text following YAML frontmatter.
func BodyAfterFrontmatter(content []byte) string {
	end := bytes.Index(content[4:], []byte("\n---"))
	if end < 0 {
		return string(content)
	}
	end += 4
	body := content[end:]
	body = bytes.TrimPrefix(body, []byte("\n"))
	return string(body)
}

func truncatePreview(body string) string {
	const maxLen = 800
	if len(body) <= maxLen {
		return body
	}
	return body[:maxLen] + "..."
}
