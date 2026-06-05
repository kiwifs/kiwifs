package importer

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/kiwifs/kiwifs/internal/markdown"
	"github.com/kiwifs/kiwifs/internal/pipeline"
	"github.com/kiwifs/kiwifs/internal/storage"
	"gopkg.in/yaml.v3"
)

// Record is one row/document from a data source, ready to be written as a
// markdown file in the knowledge base.
type Record struct {
	SourceID   string
	SourceDSN  string
	Table      string
	Fields     map[string]any
	PrimaryKey string
}

// Source streams records from an external data source.
type Source interface {
	Name() string
	Stream(ctx context.Context) (<-chan Record, <-chan error)
	Close() error
}

// Options controls the import pipeline behaviour.
type Options struct {
	Prefix         string // path prefix in kiwifs (default: table/collection name)
	IDColumn       string // column to use as filename (default: auto-detect primary key)
	Columns        []string
	FieldMappings  []FieldMapping
	DryRun         bool
	Limit          int
	Actor          string
	FullSync       bool // when true, files not seen in this run are archived (tombstoned)
}

// Stats is returned by Run with import counts.
type Stats struct {
	Imported int
	Skipped  int
	Archived int
	Errors   []string
}

// Run streams records from src, converts each to a markdown file, and writes
// them through the pipeline. Idempotent: files with matching _source_id are
// skipped if unchanged. Files previously imported but not seen in this sync
// are archived (soft-deleted via frontmatter).
func Run(ctx context.Context, src Source, pipe *pipeline.Pipeline, opts Options) (*Stats, error) {
	records, errs := src.Stream(ctx)
	stats := &Stats{}
	actor := opts.Actor
	if actor == "" {
		actor = "import"
	}
	prefix := opts.Prefix
	if prefix == "" {
		prefix = src.Name()
	}
	count := 0
	seenPaths := make(map[string]bool)

	for {
		select {
		case <-ctx.Done():
			return stats, ctx.Err()
		case err, ok := <-errs:
			if !ok {
				errs = nil
				continue
			}
			if err != nil {
				stats.Errors = append(stats.Errors, err.Error())
			}
		case rec, ok := <-records:
			if !ok {
				if opts.FullSync && !opts.DryRun {
					archiveRemovedFiles(ctx, pipe, prefix, seenPaths, src.Name(), actor, stats)
				}
				return stats, nil
			}
			if opts.Limit > 0 && count >= opts.Limit {
				return stats, nil
			}

			fields := rec.Fields
			if len(opts.Columns) > 0 {
				fields = filterColumns(fields, opts.Columns)
			}
			if len(opts.FieldMappings) > 0 {
				fields = ApplyFieldMappings(fields, opts.FieldMappings)
			}

			pk := rec.PrimaryKey
			if opts.IDColumn != "" {
				if v, ok := fields[opts.IDColumn]; ok {
					pk = fmt.Sprintf("%v", v)
				}
			}
			if pk == "" {
				pk = fmt.Sprintf("row_%d", count)
			}

			// Binary assets (e.g. Confluence attachments) are written as-is
			// without the .md extension or frontmatter wrapping.
			if isBin, _ := fields["_is_binary"].(bool); isBin {
				if binData, ok := fields["_binary_data"].([]byte); ok {
					binPath := fmt.Sprintf("%s/%s", prefix, sanitizePath(pk))
					seenPaths[binPath] = true
					if !opts.DryRun {
						if _, err := pipe.Write(ctx, binPath, binData, actor); err != nil {
							stats.Errors = append(stats.Errors, fmt.Sprintf("%s: %v", binPath, err))
						} else {
							stats.Imported++
						}
					} else {
						stats.Imported++
					}
					count++
					continue
				}
			}

			path := fmt.Sprintf("%s/%s.md", prefix, sanitizePath(pk))
			seenPaths[path] = true

			fm := make(map[string]any, len(fields)+3)
			for k, v := range fields {
				fm[k] = v
			}
			fm["_source"] = src.Name()
			fm["_source_id"] = rec.SourceID
			fm["_imported_at"] = time.Now().UTC().Format(time.RFC3339)

			title := pk
			if t, ok := fields["title"].(string); ok && t != "" {
				title = t
			} else if t, ok := fields["name"].(string); ok && t != "" {
				title = t
			}

			// Check for raw markdown content (used by Obsidian, Confluence, Markdown sources)
			var content []byte
			if rawContent, ok := fields["_raw_content"].(string); ok && rawContent != "" {
				content = renderRawContent(rawContent, src.Name(), rec.SourceID)
			} else {
				content = renderMarkdown(fm, title, rec.Table, rec.SourceID)
			}

			if !opts.DryRun {
				existing, rerr := pipe.Store.Read(ctx, path)
				if rerr == nil {
					existingID := extractSourceID(existing)
					isArchived := bytes.Contains(existing, []byte("_archived_at:"))
					if existingID == rec.SourceID && contentUnchanged(existing, fields) && !isArchived {
						stats.Skipped++
						count++
						continue
					}
				}
				if _, err := pipe.Write(ctx, path, content, actor); err != nil {
					stats.Errors = append(stats.Errors, fmt.Sprintf("%s: %v", path, err))
					count++
					continue
				}
			}
			stats.Imported++
			count++
		}
	}
}

// archiveRemovedFiles finds files in the prefix folder that were not seen
// during this sync run and marks them as archived by adding _archived_at
// to their frontmatter. Only applies to full syncs (not limited previews).
func archiveRemovedFiles(ctx context.Context, pipe *pipeline.Pipeline, prefix string, seenPaths map[string]bool, sourceName, actor string, stats *Stats) {
	if len(seenPaths) == 0 {
		return
	}

	now := time.Now().UTC().Format(time.RFC3339)
	_ = storage.Walk(ctx, pipe.Store, prefix, func(entry storage.Entry) error {
		path := entry.Path
		if seenPaths[path] {
			return nil
		}

		content, err := pipe.Store.Read(ctx, path)
		if err != nil {
			return nil
		}

		// Only archive files that were created by this source
		existingSource := extractSourceName(content)
		if existingSource != sourceName {
			return nil
		}

		// Skip if already archived
		if bytes.Contains(content, []byte("_archived_at:")) {
			return nil
		}

		archived := addArchiveMarker(content, now)
		if archived != nil {
			if _, err := pipe.Write(ctx, path, archived, actor); err == nil {
				stats.Archived++
			}
		}
		return nil
	})
}

func extractSourceName(content []byte) string {
	for _, line := range bytes.Split(content, []byte("\n")) {
		line = bytes.TrimSpace(line)
		if bytes.HasPrefix(line, []byte("_source:")) {
			return strings.TrimSpace(string(line[len("_source:"):]))
		}
	}
	return ""
}

func addArchiveMarker(content []byte, timestamp string) []byte {
	// Insert _archived_at into the YAML frontmatter
	endIdx := bytes.Index(content[4:], []byte("\n---"))
	if endIdx < 0 {
		return nil
	}
	endIdx += 4 // offset from the initial "---\n"

	var buf bytes.Buffer
	buf.Write(content[:endIdx])
	buf.WriteString(fmt.Sprintf("\n_archived_at: \"%s\"", timestamp))
	buf.Write(content[endIdx:])
	return buf.Bytes()
}

func renderMarkdown(fm map[string]any, title, table, id string) []byte {
	var buf bytes.Buffer
	buf.WriteString("---\n")
	enc := yaml.NewEncoder(&buf)
	enc.SetIndent(2)
	_ = enc.Encode(fm)
	_ = enc.Close()
	buf.WriteString("---\n\n")
	fmt.Fprintf(&buf, "# %s\n\n", title)

	// Render user-facing fields as a markdown table (skip internal fields)
	var dataFields [][2]string
	for k, v := range fm {
		if strings.HasPrefix(k, "_") {
			continue
		}
		valStr := formatFieldValue(v)
		if valStr == "" {
			continue
		}
		dataFields = append(dataFields, [2]string{k, valStr})
	}

	if len(dataFields) > 0 {
		sort.Slice(dataFields, func(i, j int) bool { return dataFields[i][0] < dataFields[j][0] })
		buf.WriteString("| Field | Value |\n")
		buf.WriteString("|-------|-------|\n")
		for _, f := range dataFields {
			buf.WriteString(fmt.Sprintf("| %s | %s |\n", f[0], escapeTableCell(f[1])))
		}
	}

	return buf.Bytes()
}

func formatFieldValue(v any) string {
	switch val := v.(type) {
	case nil:
		return ""
	case string:
		if len(val) > 200 {
			return val[:200] + "..."
		}
		return val
	case float64:
		if val == float64(int64(val)) {
			return fmt.Sprintf("%d", int64(val))
		}
		return fmt.Sprintf("%g", val)
	case bool:
		if val {
			return "true"
		}
		return "false"
	case map[string]any, []any:
		b, _ := json.Marshal(val)
		s := string(b)
		if len(s) > 200 {
			return s[:200] + "..."
		}
		return s
	default:
		return fmt.Sprintf("%v", val)
	}
}

func escapeTableCell(s string) string {
	s = strings.ReplaceAll(s, "|", "\\|")
	s = strings.ReplaceAll(s, "\n", " ")
	return s
}

// renderRawContent handles sources that provide complete markdown content
// (Obsidian, Confluence, Markdown). It merges source tracking fields into
// the existing frontmatter and returns the complete content.
func renderRawContent(rawContent, sourceName, sourceID string) []byte {
	// Parse existing frontmatter from the raw content
	fm, _ := markdown.Frontmatter([]byte(rawContent))
	if fm == nil {
		fm = make(map[string]any)
	}

	// Merge source tracking fields
	fm["_source"] = sourceName
	fm["_source_id"] = sourceID
	fm["_imported_at"] = time.Now().UTC().Format(time.RFC3339)

	// Get the body (everything after frontmatter)
	body := markdown.BodyAfterFrontmatter([]byte(rawContent))

	// Rebuild the markdown with merged frontmatter
	var buf bytes.Buffer
	buf.WriteString("---\n")
	enc := yaml.NewEncoder(&buf)
	enc.SetIndent(2)
	_ = enc.Encode(fm)
	_ = enc.Close()
	buf.WriteString("---\n\n")
	buf.WriteString(body)
	return buf.Bytes()
}

func sanitizePath(s string) string {
	// Preserve forward slashes for hierarchy-aware sources
	parts := strings.Split(s, "/")
	for i, part := range parts {
		part = strings.ReplaceAll(part, "\\", "_")
		part = strings.ReplaceAll(part, " ", "_")
		part = strings.ReplaceAll(part, "..", "_")
		parts[i] = part
	}
	return strings.Join(parts, "/")
}

// SanitizePath is the exported version of sanitizePath for use by other packages.
func SanitizePath(s string) string {
	return sanitizePath(s)
}

func filterColumns(fields map[string]any, columns []string) map[string]any {
	out := make(map[string]any, len(columns))
	for _, c := range columns {
		if v, ok := fields[c]; ok {
			out[c] = v
		}
	}
	return out
}

func extractSourceID(content []byte) string {
	fm := extractFrontmatter(content)
	if fm == "" {
		return ""
	}
	for _, line := range strings.Split(fm, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "_source_id:") {
			v := strings.TrimSpace(strings.TrimPrefix(line, "_source_id:"))
			return strings.Trim(v, `"'`)
		}
	}
	return ""
}

func contentUnchanged(existing []byte, newFields map[string]any) bool {
	existingFM := extractFrontmatter(existing)
	if existingFM == "" {
		return false
	}
	var existingMap map[string]any
	if err := yaml.Unmarshal([]byte(existingFM), &existingMap); err != nil {
		return false
	}
	for k, newVal := range newFields {
		oldVal, ok := existingMap[k]
		if !ok {
			return false
		}
		if fmt.Sprintf("%v", oldVal) != fmt.Sprintf("%v", newVal) {
			return false
		}
	}
	return true
}

func extractFrontmatter(content []byte) string {
	s := string(content)
	if !strings.HasPrefix(s, "---\n") {
		return ""
	}
	end := strings.Index(s[4:], "\n---\n")
	if end < 0 {
		return ""
	}
	return s[4 : 4+end]
}
