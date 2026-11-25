package importer

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// SampleJSONRows reads up to maxRows objects from a JSON array file or JSONL.
// Deprecated: use SampleJSONRowsNative for type-aware schema inference.
func SampleJSONRows(path string, maxRows int) ([]map[string]string, error) {
	rows, err := SampleJSONRowsNative(path, maxRows)
	if err != nil {
		return nil, err
	}
	return mapsToStringRows(rows, maxRows), nil
}

// SampleJSONRowsNative reads up to maxRows objects preserving native JSON types.
func SampleJSONRowsNative(path string, maxRows int) ([]map[string]any, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	trim := strings.TrimSpace(string(data))
	if strings.HasSuffix(path, ".jsonl") || (!strings.HasPrefix(trim, "[") && strings.Contains(trim, "\n")) {
		return sampleJSONLNative(path, maxRows)
	}
	var arr []map[string]any
	if err := decodeJSONNumbers(data, &arr); err != nil {
		return nil, fmt.Errorf("parse json array: %w", err)
	}
	if len(arr) > maxRows {
		arr = arr[:maxRows]
	}
	for i := range arr {
		arr[i] = jsonNumbers(arr[i]).(map[string]any)
	}
	return arr, nil
}

func sampleJSONLNative(path string, maxRows int) ([]map[string]any, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var arr []map[string]any
	sc := bufio.NewScanner(f)
	for sc.Scan() && len(arr) < maxRows {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		var obj map[string]any
		if err := decodeJSONNumbers([]byte(line), &obj); err != nil {
			return nil, err
		}
		arr = append(arr, jsonNumbers(obj).(map[string]any))
	}
	return arr, sc.Err()
}

// decodeJSONNumbers decodes like the JSON importer does, keeping numbers as
// json.Number so jsonNumbers can type them the same way the import will.
func decodeJSONNumbers(data []byte, v any) error {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	return dec.Decode(v)
}

func mapsToStringRows(arr []map[string]any, maxRows int) []map[string]string {
	var rows []map[string]string
	for i, obj := range arr {
		if i >= maxRows {
			break
		}
		row := make(map[string]string, len(obj))
		for k, v := range obj {
			if v == nil {
				continue
			}
			row[k] = fmt.Sprint(v)
		}
		rows = append(rows, row)
	}
	return rows
}
