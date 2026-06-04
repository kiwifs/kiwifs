package importer

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// SampleCSVRows reads up to maxRows data rows from a CSV file (with header).
func SampleCSVRows(path string, maxRows int) ([]map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	r := csv.NewReader(f)
	r.LazyQuotes = true
	header, err := r.Read()
	if err != nil {
		return nil, fmt.Errorf("csv header: %w", err)
	}
	var rows []map[string]string
	for len(rows) < maxRows {
		rec, err := r.Read()
		if err != nil {
			break
		}
		m := make(map[string]string, len(header))
		for i, col := range header {
			if i < len(rec) {
				m[col] = rec[i]
			}
		}
		rows = append(rows, m)
	}
	return rows, nil
}

// InferFieldTypes samples rows and returns a JSON-Schema-style property map.
func InferFieldTypes(rows []map[string]string) map[string]any {
	if len(rows) == 0 {
		return map[string]any{}
	}
	cols := make(map[string][]string)
	for _, row := range rows {
		for k, v := range row {
			cols[k] = append(cols[k], strings.TrimSpace(v))
		}
	}
	props := make(map[string]any, len(cols))
	for name, vals := range cols {
		props[name] = map[string]any{"type": inferColumnType(vals)}
	}
	return props
}

func inferColumnType(vals []string) string {
	nonEmpty := 0
	allBool, allInt, allNum, allDate := true, true, true, true
	for _, v := range vals {
		if v == "" {
			continue
		}
		nonEmpty++
		low := strings.ToLower(v)
		if low != "true" && low != "false" && low != "1" && low != "0" {
			allBool = false
		}
		if _, err := strconv.ParseInt(v, 10, 64); err != nil {
			allInt = false
		}
		if _, err := strconv.ParseFloat(v, 64); err != nil {
			allNum = false
		}
		if _, err := time.Parse(time.RFC3339, v); err != nil {
			if _, err2 := time.Parse("2006-01-02", v); err2 != nil {
				allDate = false
			}
		}
	}
	if nonEmpty == 0 {
		return "string"
	}
	if allBool {
		return "boolean"
	}
	if allInt {
		return "integer"
	}
	if allNum {
		return "number"
	}
	if allDate {
		return "string" // format date in export layer
	}
	return "string"
}

// InferFieldTypesNative inspects native Go values (from JSON decode) and
// returns a JSON-Schema-style property map that correctly handles null,
// boolean, number, array, and object types without the lossy string
// conversion that InferFieldTypes performs.
func InferFieldTypesNative(rows []map[string]any) map[string]any {
	if len(rows) == 0 {
		return map[string]any{}
	}
	cols := make(map[string][]any)
	for _, row := range rows {
		for k, v := range row {
			cols[k] = append(cols[k], v)
		}
	}
	props := make(map[string]any, len(cols))
	for name, vals := range cols {
		props[name] = map[string]any{"type": inferNativeType(vals)}
	}
	return props
}

func inferNativeType(vals []any) string {
	allBool, allInt, allNum, allStr, allArr := true, true, true, true, true
	nonNull := 0
	for _, v := range vals {
		if v == nil {
			continue
		}
		nonNull++
		switch val := v.(type) {
		case bool:
			allInt = false
			allNum = false
			allStr = false
			allArr = false
			_ = val
		case float64:
			allBool = false
			allArr = false
			if val != float64(int64(val)) {
				allInt = false
			}
		case string:
			allBool = false
			allInt = false
			allNum = false
			allArr = false
		case []any:
			allBool = false
			allInt = false
			allNum = false
			allStr = false
			_ = val
		case map[string]any:
			return "object"
		default:
			allBool = false
			allArr = false
		}
	}
	if nonNull == 0 {
		return "string"
	}
	if allBool {
		return "boolean"
	}
	if allInt {
		return "integer"
	}
	if allNum {
		return "number"
	}
	if allArr {
		return "array"
	}
	if allStr {
		return "string"
	}
	return "string"
}

// SchemaDocument wraps inferred properties as JSON Schema.
func SchemaDocument(name string, props map[string]any) ([]byte, error) {
	doc := map[string]any{
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"title":   name,
		"type":    "object",
		"properties": props,
	}
	return json.MarshalIndent(doc, "", "  ")
}
