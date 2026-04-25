package dataview

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// Render formats a QueryResult into the requested output format.
func Render(result *QueryResult, format string) string {
	switch format {
	case "table":
		return renderTable(result)
	case "list":
		return renderList(result)
	case "count":
		return renderCount(result)
	case "json":
		return renderJSON(result)
	case "distinct":
		return renderDistinct(result)
	case "task":
		return renderTaskList(result)
	default:
		return renderTable(result)
	}
}

func renderTable(result *QueryResult) string {
	if len(result.Groups) > 0 {
		return renderGroupedTable(result)
	}
	if len(result.Rows) == 0 {
		return "*No results*"
	}

	cols := result.Columns
	if len(cols) == 0 {
		return "*No columns*"
	}

	var sb strings.Builder

	// Header
	sb.WriteString("| ")
	for i, col := range cols {
		if i > 0 {
			sb.WriteString(" | ")
		}
		sb.WriteString(formatColumnHeader(col))
	}
	sb.WriteString(" |\n")

	// Separator
	sb.WriteString("|")
	for range cols {
		sb.WriteString("---|")
	}
	sb.WriteString("\n")

	// Rows
	for _, row := range result.Rows {
		sb.WriteString("| ")
		for i, col := range cols {
			if i > 0 {
				sb.WriteString(" | ")
			}
			sb.WriteString(formatValue(row[col]))
		}
		sb.WriteString(" |\n")
	}

	if result.HasMore {
		fmt.Fprintf(&sb, "\n*Showing %d+ results*", len(result.Rows))
	}
	return sb.String()
}

func renderGroupedTable(result *QueryResult) string {
	var sb strings.Builder
	for _, g := range result.Groups {
		fmt.Fprintf(&sb, "### %s (%d)\n\n", formatValue(g.Key), g.Count)
		if len(g.Rows) > 0 {
			sub := &QueryResult{
				Columns: result.Columns,
				Rows:    g.Rows,
			}
			sb.WriteString(renderTable(sub))
			sb.WriteString("\n")
		}
	}
	return sb.String()
}

func renderList(result *QueryResult) string {
	if len(result.Rows) == 0 {
		return "*No results*"
	}
	var sb strings.Builder
	for _, row := range result.Rows {
		path, _ := row["_path"].(string)
		if path == "" {
			path, _ = row["path"].(string)
		}
		sb.WriteString("- ")
		if path != "" {
			sb.WriteString(fmt.Sprintf("[%s](%s)", path, path))
		}
		// Append other fields
		for _, col := range result.Columns {
			if col == "_path" || col == "path" {
				continue
			}
			val := row[col]
			if val != nil {
				sb.WriteString(fmt.Sprintf(": %s", formatValue(val)))
			}
		}
		sb.WriteString("\n")
	}
	if result.HasMore {
		fmt.Fprintf(&sb, "\n*Showing %d+ results*", len(result.Rows))
	}
	return sb.String()
}

func renderCount(result *QueryResult) string {
	if result.Total > 0 {
		return fmt.Sprintf("**%d** results", result.Total)
	}
	if len(result.Rows) > 0 {
		if cnt, ok := result.Rows[0]["cnt"]; ok {
			return fmt.Sprintf("**%v** results", cnt)
		}
	}
	return "**0** results"
}

func renderJSON(result *QueryResult) string {
	data, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return fmt.Sprintf(`{"error": %q}`, err.Error())
	}
	return string(data)
}

func renderTaskList(result *QueryResult) string {
	if len(result.Rows) == 0 {
		return "*No tasks*"
	}
	var sb strings.Builder
	currentPath := ""
	for _, row := range result.Rows {
		path, _ := row["_path"].(string)
		if path == "" {
			path, _ = row["path"].(string)
		}
		if path != currentPath {
			if currentPath != "" {
				sb.WriteString("\n")
			}
			fmt.Fprintf(&sb, "**%s**\n", path)
			currentPath = path
		}
		completed, _ := row["completed"].(bool)
		text, _ := row["text"].(string)
		check := " "
		if completed {
			check = "x"
		}
		fmt.Fprintf(&sb, "- [%s] %s", check, text)
		if due, ok := row["due"].(string); ok && due != "" {
			fmt.Fprintf(&sb, " [due:: %s]", due)
		}
		sb.WriteString("\n")
	}
	return sb.String()
}

func renderDistinct(result *QueryResult) string {
	if len(result.Rows) == 0 {
		return "*No results*"
	}
	var sb strings.Builder
	for _, row := range result.Rows {
		for _, v := range row {
			fmt.Fprintf(&sb, "- %s\n", formatValue(v))
		}
	}
	return sb.String()
}

// formatColumnHeader converts a field path to a human-readable header.
// "mastery.derivatives" → "Mastery Derivatives"
// "_word_count" → "Word Count"
func formatColumnHeader(col string) string {
	col = strings.TrimPrefix(col, "$.")
	col = strings.TrimPrefix(col, "_")
	col = strings.ReplaceAll(col, ".", " ")
	col = strings.ReplaceAll(col, "_", " ")
	words := strings.Fields(col)
	for i, w := range words {
		if len(w) > 0 {
			words[i] = strings.ToUpper(w[:1]) + w[1:]
		}
	}
	return strings.Join(words, " ")
}

// formatValue renders a cell value as a string for markdown output.
func formatValue(v any) string {
	if v == nil {
		return "—" // em-dash
	}
	switch val := v.(type) {
	case string:
		if isISODate(val) {
			return formatDate(val)
		}
		return val
	case float64:
		if val == float64(int64(val)) {
			return fmt.Sprintf("%d", int64(val))
		}
		return fmt.Sprintf("%.2f", val)
	case int64:
		return fmt.Sprintf("%d", val)
	case bool:
		if val {
			return "true"
		}
		return "false"
	default:
		return fmt.Sprintf("%v", val)
	}
}

func isISODate(s string) bool {
	if len(s) != 10 && (len(s) < 19 || s[10] != 'T') {
		return false
	}
	_, err := time.Parse("2006-01-02", s[:10])
	return err == nil
}

func formatDate(s string) string {
	if t, err := time.Parse("2006-01-02", s[:10]); err == nil {
		return t.Format("Jan 02, 2006")
	}
	return s
}
