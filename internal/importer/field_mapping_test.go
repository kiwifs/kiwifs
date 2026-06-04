package importer

import "testing"

func TestApplyFieldMappings_renameSkipCoerce(t *testing.T) {
	fields := map[string]any{
		"id":    "1",
		"name":  "Alice",
		"score": "42",
		"done":  "true",
		"extra": "drop",
	}
	mappings := []FieldMapping{
		{Source: "id", Target: "doc_id", Type: "string"},
		{Source: "name", Target: "title", Type: "string"},
		{Source: "score", Target: "score", Type: "number"},
		{Source: "done", Target: "done", Type: "boolean"},
		{Source: "extra", Skip: true},
	}
	out := ApplyFieldMappings(fields, mappings)
	if out["doc_id"] != "1" {
		t.Fatalf("doc_id: got %v", out["doc_id"])
	}
	if out["title"] != "Alice" {
		t.Fatalf("title: got %v", out["title"])
	}
	if out["score"] != float64(42) {
		t.Fatalf("score: got %v (%T)", out["score"], out["score"])
	}
	if out["done"] != true {
		t.Fatalf("done: got %v", out["done"])
	}
	if _, ok := out["extra"]; ok {
		t.Fatal("extra should be skipped")
	}
	if _, ok := out["name"]; ok {
		t.Fatal("unmapped source name should not pass through")
	}
}

func TestApplyFieldMappings_emptyMappingsPassthrough(t *testing.T) {
	fields := map[string]any{"a": 1}
	out := ApplyFieldMappings(fields, nil)
	if out["a"] != 1 {
		t.Fatal("expected passthrough")
	}
}
