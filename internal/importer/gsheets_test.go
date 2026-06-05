package importer

import "testing"

func TestRecordsFromSheetValues_CoercesNumericColumns(t *testing.T) {
	values := [][]interface{}{
		{"id", "name", "score", "ratio"},
		{"a1", "Alice", "42", "0.5"},
		{"a2", "Bob", "7", "1.25"},
	}

	recs := RecordsFromSheetValues(values, "sheet123", "Sheet1")
	if len(recs) != 2 {
		t.Fatalf("expected 2 records, got %d", len(recs))
	}

	if recs[0].PrimaryKey != "a1" {
		t.Fatalf("pk: %q", recs[0].PrimaryKey)
	}
	if recs[0].Fields["score"] != int64(42) {
		t.Fatalf("score type/value: %#v (%T)", recs[0].Fields["score"], recs[0].Fields["score"])
	}
	if recs[0].Fields["ratio"] != 0.5 {
		t.Fatalf("ratio type/value: %#v (%T)", recs[0].Fields["ratio"], recs[0].Fields["ratio"])
	}
	if recs[1].Fields["ratio"] != 1.25 {
		t.Fatalf("ratio2 type/value: %#v (%T)", recs[1].Fields["ratio"], recs[1].Fields["ratio"])
	}
}

func TestRecordsFromSheetValues_MixedColumnDisablesNumeric(t *testing.T) {
	values := [][]interface{}{
		{"score"},
		{"10"},
		{"n/a"},
	}

	recs := RecordsFromSheetValues(values, "sheet123", "Sheet1")
	if len(recs) != 2 {
		t.Fatalf("expected 2 records, got %d", len(recs))
	}
	if recs[0].Fields["score"] != "10" {
		t.Fatalf("expected score to remain string, got %#v (%T)", recs[0].Fields["score"], recs[0].Fields["score"])
	}
	if recs[1].Fields["score"] != "n/a" {
		t.Fatalf("expected score to remain string, got %#v (%T)", recs[1].Fields["score"], recs[1].Fields["score"])
	}
}

