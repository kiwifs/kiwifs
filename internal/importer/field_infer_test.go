package importer

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

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

func TestInferMappingFieldsKeepsIdentifiersAsText(t *testing.T) {
	rows := []map[string]any{
		{"zip": "02134", "order_id": "41111111111111111112", "qty": "3", "price": "12.50"},
		{"zip": "10001", "order_id": "41111111111111111113", "qty": "4", "price": "7"},
	}
	types := make(map[string]string)
	for _, f := range InferMappingFields(rows) {
		types[f.Source] = f.Type
	}
	want := map[string]string{"zip": "string", "order_id": "string", "qty": "number", "price": "number"}
	for col, w := range want {
		if types[col] != w {
			t.Errorf("%s: %q, want %q", col, types[col], w)
		}
	}
}

func TestInferCSVSchemaMatchesImport(t *testing.T) {
	path := filepath.Join(t.TempDir(), "contacts.csv")
	data := "\ufeffid,zip,amount,ratio\r\n1,02134,12,0.5\r\n2,10001,7.0,1\r\n"
	if err := os.WriteFile(path, []byte(data), 0o644); err != nil {
		t.Fatal(err)
	}
	rows, err := SampleCSVRows(path, 10)
	if err != nil {
		t.Fatal(err)
	}
	props := InferFieldTypes(rows)
	want := map[string]string{"id": "integer", "zip": "string", "amount": "integer", "ratio": "number"}
	for col, w := range want {
		p, ok := props[col].(map[string]any)
		if !ok {
			t.Errorf("no property %q in %v", col, props)
			continue
		}
		if p["type"] != w {
			t.Errorf("%s: %v, want %q", col, p["type"], w)
		}
	}
}

func TestSampleSourceFieldsStopsAtLimit(t *testing.T) {
	var b strings.Builder
	b.WriteString("id,name\n")
	for i := 0; i < 500; i++ {
		fmt.Fprintf(&b, "%d,n%d\n", i, i)
	}
	path := filepath.Join(t.TempDir(), "big.csv")
	if err := os.WriteFile(path, []byte(b.String()), 0o644); err != nil {
		t.Fatal(err)
	}
	src, err := NewCSV(path, true)
	if err != nil {
		t.Fatal(err)
	}
	type result struct {
		rows []map[string]any
		err  error
	}
	done := make(chan result, 1)
	go func() {
		rows, err := SampleSourceFields(context.Background(), src, 100)
		done <- result{rows, err}
	}()
	select {
	case r := <-done:
		if r.err != nil || len(r.rows) != 100 {
			t.Fatalf("got %d rows, err %v; want 100", len(r.rows), r.err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("SampleSourceFields blocked on a source longer than the limit")
	}
}
