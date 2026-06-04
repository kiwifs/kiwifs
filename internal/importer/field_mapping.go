package importer

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// FieldMapping maps a source column/field to a frontmatter key with optional type coercion.
type FieldMapping struct {
	Source string `json:"source"`
	Target string `json:"target,omitempty"`
	Type   string `json:"type,omitempty"` // string, number, boolean, date
	Skip   bool   `json:"skip,omitempty"`
}

// ApplyFieldMappings renames, skips, and coerces fields per mapping rules.
// Unmapped source fields are omitted when any mapping is provided.
func ApplyFieldMappings(fields map[string]any, mappings []FieldMapping) map[string]any {
	if len(mappings) == 0 {
		return fields
	}
	bySource := make(map[string]FieldMapping, len(mappings))
	for _, m := range mappings {
		bySource[m.Source] = m
	}
	out := make(map[string]any)
	for srcKey, v := range fields {
		m, ok := bySource[srcKey]
		if !ok {
			continue
		}
		if m.Skip || m.Target == "" {
			continue
		}
		out[m.Target] = CoerceFieldValue(v, m.Type)
	}
	return out
}

// CoerceFieldValue converts v to the requested frontmatter type when possible.
func CoerceFieldValue(v any, typ string) any {
	switch strings.ToLower(strings.TrimSpace(typ)) {
	case "number":
		return coerceNumber(v)
	case "boolean":
		return coerceBoolean(v)
	case "date":
		return coerceDate(v)
	default:
		return coerceString(v)
	}
}

func coerceString(v any) any {
	switch val := v.(type) {
	case nil:
		return ""
	case string:
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
	default:
		return fmt.Sprintf("%v", val)
	}
}

func coerceNumber(v any) any {
	switch val := v.(type) {
	case nil:
		return 0
	case float64:
		return val
	case int:
		return float64(val)
	case int64:
		return float64(val)
	case string:
		s := strings.TrimSpace(val)
		if s == "" {
			return 0
		}
		if i, err := strconv.ParseInt(s, 10, 64); err == nil {
			return float64(i)
		}
		if f, err := strconv.ParseFloat(s, 64); err == nil {
			return f
		}
		return 0
	case bool:
		if val {
			return float64(1)
		}
		return float64(0)
	default:
		return 0
	}
}

func coerceBoolean(v any) any {
	switch val := v.(type) {
	case nil:
		return false
	case bool:
		return val
	case float64:
		return val != 0
	case int:
		return val != 0
	case string:
		s := strings.ToLower(strings.TrimSpace(val))
		return s == "true" || s == "1" || s == "yes"
	default:
		return false
	}
}

func coerceDate(v any) any {
	switch val := v.(type) {
	case nil:
		return ""
	case time.Time:
		return val.UTC().Format(time.RFC3339)
	case string:
		s := strings.TrimSpace(val)
		if s == "" {
			return ""
		}
		if t, err := time.Parse(time.RFC3339, s); err == nil {
			return t.UTC().Format(time.RFC3339)
		}
		if t, err := time.Parse("2006-01-02", s); err == nil {
			return t.UTC().Format(time.RFC3339)
		}
		return s
	default:
		return coerceString(v)
	}
}
