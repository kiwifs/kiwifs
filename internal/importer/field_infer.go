package importer

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"
)

// InferredField is a source column with a suggested frontmatter type for the import wizard.
type InferredField struct {
	Source string `json:"source"`
	Target string `json:"target"`
	Type   string `json:"type"` // string, number, date, boolean
}

// InferMappingFields infers wizard field types from sampled import records.
func InferMappingFields(sampleRows []map[string]any) []InferredField {
	if len(sampleRows) == 0 {
		return nil
	}
	cols := make(map[string][]any)
	for _, row := range sampleRows {
		for k, v := range row {
			if strings.HasPrefix(k, "_") {
				continue
			}
			cols[k] = append(cols[k], v)
		}
	}
	names := make([]string, 0, len(cols))
	for name := range cols {
		names = append(names, name)
	}
	sort.Strings(names)

	out := make([]InferredField, 0, len(names))
	for _, name := range names {
		out = append(out, InferredField{
			Source: name,
			Target: name,
			Type:   inferMappingType(cols[name]),
		})
	}
	return out
}

// SampleSourceFields reads up to limit records from src for type inference.
func SampleSourceFields(ctx context.Context, src Source, limit int) ([]map[string]any, error) {
	if limit <= 0 {
		limit = 100
	}
	// Sources close errs only once they stop sending, so stop them at the
	// limit and drain the rest; leaving the loop early would block on errs.
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	records, errs := src.Stream(ctx)
	rows := make([]map[string]any, 0, limit)
	for rec := range records {
		if len(rows) < limit {
			rows = append(rows, rec.Fields)
			if len(rows) == limit {
				cancel()
			}
		}
	}
	for err := range errs {
		if err != nil && len(rows) == 0 {
			return nil, err
		}
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("no records found in source")
	}
	return rows, nil
}

func inferMappingType(vals []any) string {
	nonNull := 0
	allBool, allInt, allNum, allDate := true, true, true, true
	for _, v := range vals {
		if v == nil {
			continue
		}
		nonNull++
		switch val := v.(type) {
		case bool:
			allInt = false
			allNum = false
			allDate = false
		case float64:
			allBool = false
			allDate = false
			if val != float64(int64(val)) {
				allInt = false
			}
		case int, int64:
			allBool = false
			allNum = false
			allDate = false
		case string:
			s := strings.TrimSpace(val)
			if s == "" {
				continue
			}
			low := strings.ToLower(s)
			if low != "true" && low != "false" && low != "1" && low != "0" {
				allBool = false
			}
			if n, ok := parseSpreadsheetNumber(s); !ok {
				allInt = false
				allNum = false
			} else if _, isInt := n.(int64); !isInt {
				allInt = false
			}
			if !isDateString(s) {
				allDate = false
			}
		default:
			allBool = false
			allInt = false
			allNum = false
			allDate = false
		}
	}
	if nonNull == 0 {
		return "string"
	}
	if allBool {
		return "boolean"
	}
	if allDate {
		return "date"
	}
	if allInt || allNum {
		return "number"
	}
	return "string"
}

func isDateString(s string) bool {
	if _, err := time.Parse(time.RFC3339, s); err == nil {
		return true
	}
	if _, err := time.Parse("2006-01-02", s); err == nil {
		return true
	}
	return false
}
