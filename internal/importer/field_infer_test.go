package importer

import "testing"

func TestInferMappingFields_mixedTypes(t *testing.T) {
	rows := []map[string]any{
		{"id": "row-a", "name": "Alice", "score": float64(42), "active": true, "created": "2024-01-15"},
		{"id": "row-b", "name": "Bob", "score": float64(7), "active": false, "created": "2024-02-20"},
	}
	fields := InferMappingFields(rows)
	bySource := make(map[string]string)
	for _, f := range fields {
		bySource[f.Source] = f.Type
	}
	if bySource["id"] != "string" {
		t.Fatalf("id: %v", bySource["id"])
	}
	if bySource["score"] != "number" {
		t.Fatalf("score: %v", bySource["score"])
	}
	if bySource["active"] != "boolean" {
		t.Fatalf("active: %v", bySource["active"])
	}
	if bySource["created"] != "date" {
		t.Fatalf("created: %v", bySource["created"])
	}
}

func TestInferMappingFields_skipsInternalKeys(t *testing.T) {
	rows := []map[string]any{{"_raw_content": "x", "title": "ok"}}
	fields := InferMappingFields(rows)
	if len(fields) != 1 || fields[0].Source != "title" {
		t.Fatalf("got %+v", fields)
	}
}
