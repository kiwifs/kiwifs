package importer

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kiwifs/kiwifs/internal/events"
	"github.com/kiwifs/kiwifs/internal/pipeline"
	"github.com/kiwifs/kiwifs/internal/search"
	"github.com/kiwifs/kiwifs/internal/storage"
	"github.com/kiwifs/kiwifs/internal/versioning"
	"github.com/xuri/excelize/v2"
)

func testPipeline(t *testing.T) (*pipeline.Pipeline, storage.Storage) {
	t.Helper()
	dir := t.TempDir()
	store, err := storage.NewLocal(dir)
	if err != nil {
		t.Fatalf("storage: %v", err)
	}
	ver := versioning.NewNoop()
	searcher := search.NewGrep(dir)
	hub := events.NewHub()
	pipe := pipeline.New(store, ver, searcher, nil, hub, nil, "")
	return pipe, store
}

func TestCSVImport(t *testing.T) {
	csvData := "name,age,grade\nAlice,18,A\nBob,19,B\nCharlie,20,A\n"
	csvFile := filepath.Join(t.TempDir(), "students.csv")
	if err := os.WriteFile(csvFile, []byte(csvData), 0644); err != nil {
		t.Fatalf("write csv: %v", err)
	}

	src, err := NewCSV(csvFile, true)
	if err != nil {
		t.Fatalf("new csv: %v", err)
	}
	defer src.Close()

	pipe, store := testPipeline(t)
	ctx := context.Background()
	stats, err := Run(ctx, src, pipe, Options{Actor: "test"})
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if stats.Imported != 3 {
		t.Fatalf("imported=%d, want 3", stats.Imported)
	}

	// Verify files exist with correct frontmatter.
	content, err := store.Read(ctx, "students/0.md")
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	s := string(content)
	if !strings.Contains(s, "name: Alice") {
		t.Fatalf("missing Alice in frontmatter: %s", s)
	}
	if !strings.Contains(s, "_source: students") {
		t.Fatalf("missing _source: %s", s)
	}
	if !strings.Contains(s, "| name") {
		t.Fatalf("missing markdown table: %s", s)
	}
}

func TestJSONImport(t *testing.T) {
	data := `[
		{"id": "s1", "name": "Alice", "score": 95},
		{"id": "s2", "name": "Bob", "score": 88}
	]`
	jsonFile := filepath.Join(t.TempDir(), "data.json")
	if err := os.WriteFile(jsonFile, []byte(data), 0644); err != nil {
		t.Fatalf("write json: %v", err)
	}

	src, err := NewJSON(jsonFile)
	if err != nil {
		t.Fatalf("new json: %v", err)
	}
	defer src.Close()

	pipe, store := testPipeline(t)
	ctx := context.Background()
	stats, err := Run(ctx, src, pipe, Options{Actor: "test"})
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if stats.Imported != 2 {
		t.Fatalf("imported=%d, want 2", stats.Imported)
	}

	content, err := store.Read(ctx, "data/s1.md")
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if !strings.Contains(string(content), "name: Alice") {
		t.Fatalf("missing Alice: %s", content)
	}
}

func TestJSONImportKeepsIntegerIDs(t *testing.T) {
	data := `[
		{"id": 12345678, "amount": 2500000},
		{"id": 1234567890123456789},
		{"id": 1234567890123456788}
	]`
	jsonFile := filepath.Join(t.TempDir(), "orders.json")
	if err := os.WriteFile(jsonFile, []byte(data), 0644); err != nil {
		t.Fatalf("write json: %v", err)
	}

	src, err := NewJSON(jsonFile)
	if err != nil {
		t.Fatalf("new json: %v", err)
	}
	defer src.Close()

	pipe, store := testPipeline(t)
	ctx := context.Background()
	if _, err := Run(ctx, src, pipe, Options{Actor: "test"}); err != nil {
		t.Fatalf("run: %v", err)
	}

	content, err := store.Read(ctx, "orders/12345678.md")
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if !strings.Contains(string(content), "amount: 2500000") {
		t.Fatalf("amount not kept as an integer: %s", content)
	}
	for _, id := range []string{"1234567890123456789", "1234567890123456788"} {
		if _, err := store.Read(ctx, "orders/"+id+".md"); err != nil {
			t.Fatalf("record %s: %v", id, err)
		}
	}
}

func TestJSONLImportRejectsDataAfterObject(t *testing.T) {
	for _, line := range []string{`{"id":1}{"id":2}`, `{"id":1} junk`, `{"id":1}]`} {
		jsonlFile := filepath.Join(t.TempDir(), "rows.jsonl")
		if err := os.WriteFile(jsonlFile, []byte(line+"\n{\"id\":3}\n"), 0644); err != nil {
			t.Fatalf("write jsonl: %v", err)
		}

		src, err := NewJSON(jsonlFile)
		if err != nil {
			t.Fatalf("new json: %v", err)
		}

		records, errs := src.Stream(context.Background())
		for range records {
		}
		if err := <-errs; err == nil {
			t.Errorf("%s: expected an error", line)
		}
		src.Close()
	}
}

func TestJSONLImport(t *testing.T) {
	data := `{"id": "a", "name": "X"}
{"id": "b", "name": "Y"}`
	jsonlFile := filepath.Join(t.TempDir(), "data.jsonl")
	if err := os.WriteFile(jsonlFile, []byte(data), 0644); err != nil {
		t.Fatalf("write jsonl: %v", err)
	}

	src, err := NewJSON(jsonlFile)
	if err != nil {
		t.Fatalf("new json: %v", err)
	}
	defer src.Close()

	pipe, _ := testPipeline(t)
	ctx := context.Background()
	stats, err := Run(ctx, src, pipe, Options{Actor: "test"})
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if stats.Imported != 2 {
		t.Fatalf("imported=%d, want 2", stats.Imported)
	}
}

func TestSQLiteImport(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer db.Close()

	_, err = db.Exec(`CREATE TABLE students (id INTEGER PRIMARY KEY, name TEXT, grade TEXT)`)
	if err != nil {
		t.Fatalf("create table: %v", err)
	}
	_, err = db.Exec(`INSERT INTO students VALUES (1, 'Alice', 'A'), (2, 'Bob', 'B'), (3, 'Charlie', 'C')`)
	if err != nil {
		t.Fatalf("insert: %v", err)
	}
	db.Close()

	src, err := NewSQLiteSource(dbPath, "students", "")
	if err != nil {
		t.Fatalf("new sqlite: %v", err)
	}
	defer src.Close()

	pipe, store := testPipeline(t)
	ctx := context.Background()
	stats, err := Run(ctx, src, pipe, Options{Actor: "test"})
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if stats.Imported != 3 {
		t.Fatalf("imported=%d, want 3", stats.Imported)
	}

	content, err := store.Read(ctx, "students/1.md")
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if !strings.Contains(string(content), "name: Alice") {
		t.Fatalf("missing Alice: %s", content)
	}
}

func TestIdempotentReImport(t *testing.T) {
	data := `[{"id": "x", "name": "Test"}]`
	jsonFile := filepath.Join(t.TempDir(), "data.json")
	if err := os.WriteFile(jsonFile, []byte(data), 0644); err != nil {
		t.Fatalf("write json: %v", err)
	}

	pipe, _ := testPipeline(t)
	ctx := context.Background()

	// First import.
	src1, _ := NewJSON(jsonFile)
	stats1, err := Run(ctx, src1, pipe, Options{Actor: "test"})
	src1.Close()
	if err != nil {
		t.Fatalf("first run: %v", err)
	}
	if stats1.Imported != 1 {
		t.Fatalf("first imported=%d, want 1", stats1.Imported)
	}

	// Second import — same data, should be skipped.
	src2, _ := NewJSON(jsonFile)
	stats2, err := Run(ctx, src2, pipe, Options{Actor: "test"})
	src2.Close()
	if err != nil {
		t.Fatalf("second run: %v", err)
	}
	if stats2.Skipped != 1 {
		t.Fatalf("second skipped=%d, want 1", stats2.Skipped)
	}
	if stats2.Imported != 0 {
		t.Fatalf("second imported=%d, want 0", stats2.Imported)
	}
}

func TestDryRun(t *testing.T) {
	data := `[{"id": "1", "name": "A"}, {"id": "2", "name": "B"}]`
	jsonFile := filepath.Join(t.TempDir(), "data.json")
	if err := os.WriteFile(jsonFile, []byte(data), 0644); err != nil {
		t.Fatalf("write: %v", err)
	}

	pipe, store := testPipeline(t)
	ctx := context.Background()

	src, _ := NewJSON(jsonFile)
	stats, err := Run(ctx, src, pipe, Options{Actor: "test", DryRun: true})
	src.Close()
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if stats.Imported != 2 {
		t.Fatalf("imported=%d, want 2", stats.Imported)
	}

	// No files should have been written.
	if store.Exists(ctx, "data/1.md") {
		t.Fatalf("file exists in dry-run mode")
	}
}

func TestColumnsFilter(t *testing.T) {
	data := `[{"id": "1", "name": "Alice", "secret": "hidden", "grade": "A"}]`
	jsonFile := filepath.Join(t.TempDir(), "data.json")
	if err := os.WriteFile(jsonFile, []byte(data), 0644); err != nil {
		t.Fatalf("write: %v", err)
	}

	pipe, store := testPipeline(t)
	ctx := context.Background()

	src, _ := NewJSON(jsonFile)
	stats, err := Run(ctx, src, pipe, Options{
		Actor:   "test",
		Columns: []string{"name", "grade"},
	})
	src.Close()
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if stats.Imported != 1 {
		t.Fatalf("imported=%d, want 1", stats.Imported)
	}

	content, err := store.Read(ctx, "data/1.md")
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	s := string(content)
	if strings.Contains(s, "secret") {
		t.Fatalf("secret field should be filtered out: %s", s)
	}
	if !strings.Contains(s, "name: Alice") {
		t.Fatalf("name should be present: %s", s)
	}
}

func TestLimit(t *testing.T) {
	data := `[{"id":"1"},{"id":"2"},{"id":"3"},{"id":"4"},{"id":"5"}]`
	jsonFile := filepath.Join(t.TempDir(), "data.json")
	if err := os.WriteFile(jsonFile, []byte(data), 0644); err != nil {
		t.Fatalf("write: %v", err)
	}

	pipe, _ := testPipeline(t)
	ctx := context.Background()

	src, _ := NewJSON(jsonFile)
	stats, err := Run(ctx, src, pipe, Options{Actor: "test", Limit: 2})
	src.Close()
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if stats.Imported != 2 {
		t.Fatalf("imported=%d, want 2", stats.Imported)
	}
}

func TestMySQLSkipWithoutEnv(t *testing.T) {
	if os.Getenv("KIWI_TEST_MYSQL_DSN") == "" {
		t.Skip("skipping mysql integration test (set KIWI_TEST_MYSQL_DSN)")
	}
}

func TestFirestoreSkipWithoutEnv(t *testing.T) {
	if os.Getenv("GOOGLE_APPLICATION_CREDENTIALS") == "" {
		t.Skip("skipping firestore integration test (set GOOGLE_APPLICATION_CREDENTIALS)")
	}
}

func TestMongoDBSkipWithoutEnv(t *testing.T) {
	if os.Getenv("KIWI_TEST_MONGODB_URI") == "" {
		t.Skip("skipping mongodb integration test (set KIWI_TEST_MONGODB_URI)")
	}
}

// Verify JSON source auto-detects array vs JSONL format.
func TestJSONAutoDetect(t *testing.T) {
	// Array format
	arrayFile := filepath.Join(t.TempDir(), "array.json")
	os.WriteFile(arrayFile, []byte(`[{"id":"1"}]`), 0644)
	src1, _ := NewJSON(arrayFile)
	ch1, _ := src1.Stream(context.Background())
	count := 0
	for range ch1 {
		count++
	}
	if count != 1 {
		t.Fatalf("array format: got %d, want 1", count)
	}

	// JSONL format
	jsonlFile := filepath.Join(t.TempDir(), "data.jsonl")
	os.WriteFile(jsonlFile, []byte("{\"id\":\"1\"}\n{\"id\":\"2\"}\n"), 0644)
	src2, _ := NewJSON(jsonlFile)
	ch2, _ := src2.Stream(context.Background())
	count = 0
	for range ch2 {
		count++
	}
	if count != 2 {
		t.Fatalf("jsonl format: got %d, want 2", count)
	}
}

// Ensure CSVSource auto-detects numeric columns.
func TestCSVNumericDetection(t *testing.T) {
	csvData := "name,score,grade\nAlice,95,A\nBob,88,B\n"
	csvFile := filepath.Join(t.TempDir(), "scores.csv")
	os.WriteFile(csvFile, []byte(csvData), 0644)

	src, _ := NewCSV(csvFile, true)
	ch, _ := src.Stream(context.Background())

	rec := <-ch
	if _, ok := rec.Fields["score"].(int64); !ok {
		t.Fatalf("score should be int64, got %T: %v", rec.Fields["score"], rec.Fields["score"])
	}
	if _, ok := rec.Fields["name"].(string); !ok {
		t.Fatalf("name should be string, got %T", rec.Fields["name"])
	}
}

func TestCSVWithByteOrderMark(t *testing.T) {
	csvFile := filepath.Join(t.TempDir(), "contacts.csv")
	os.WriteFile(csvFile, []byte("\ufeffid,name\r\n7,Alice\r\n"), 0644)

	src, _ := NewCSV(csvFile, true)
	ch, _ := src.Stream(context.Background())
	if rec := <-ch; rec.Fields["id"] != int64(7) {
		t.Fatalf("fields = %#v, want id 7", rec.Fields)
	}
}

func TestCSVKeepsIdentifiersAsText(t *testing.T) {
	csvData := "order_id,zip,phone,amount\n4111111111111111111,02134,0412345678,12.50\n41111111111111111112,10001,0298765432,7\n"
	csvFile := filepath.Join(t.TempDir(), "orders.csv")
	os.WriteFile(csvFile, []byte(csvData), 0644)

	src, _ := NewCSV(csvFile, true)
	ch, _ := src.Stream(context.Background())

	rec := <-ch
	for col, want := range map[string]any{"order_id": "4111111111111111111", "zip": "02134", "phone": "0412345678", "amount": 12.5} {
		if rec.Fields[col] != want {
			t.Fatalf("%s = %#v, want %#v", col, rec.Fields[col], want)
		}
	}
	if rec := <-ch; rec.Fields["order_id"] != "41111111111111111112" {
		t.Fatalf("order_id = %#v, want the full digits", rec.Fields["order_id"])
	}
}

func TestParseSpreadsheetNumber(t *testing.T) {
	for in, want := range map[string]any{"95": int64(95), "-3": int64(-3), "0": int64(0), "0.5": 0.5, "7.0": int64(7), "4111111111111111111": int64(4111111111111111111)} {
		if got, ok := parseSpreadsheetNumber(in); !ok || got != want {
			t.Fatalf("parseSpreadsheetNumber(%q) = %#v, %v; want %#v", in, got, ok, want)
		}
	}
	for _, in := range []string{"02134", "-007", "41111111111111111112", "NaN", "Inf", "abc"} {
		if got, ok := parseSpreadsheetNumber(in); ok {
			t.Fatalf("parseSpreadsheetNumber(%q) = %#v, want text", in, got)
		}
	}
}

func TestExcelImport(t *testing.T) {
	f := excelize.NewFile()
	defer f.Close()

	sheet := "Sheet1"
	f.SetCellValue(sheet, "A1", "name")
	f.SetCellValue(sheet, "B1", "score")
	f.SetCellValue(sheet, "C1", "grade")
	f.SetCellValue(sheet, "A2", "Alice")
	f.SetCellValue(sheet, "B2", 95)
	f.SetCellValue(sheet, "C2", "A")
	f.SetCellValue(sheet, "A3", "Bob")
	f.SetCellValue(sheet, "B3", 88)
	f.SetCellValue(sheet, "C3", "B")

	xlsxPath := filepath.Join(t.TempDir(), "students.xlsx")
	if err := f.SaveAs(xlsxPath); err != nil {
		t.Fatalf("save xlsx: %v", err)
	}

	src, err := NewExcel(xlsxPath, "")
	if err != nil {
		t.Fatalf("new excel: %v", err)
	}
	defer src.Close()

	pipe, store := testPipeline(t)
	ctx := context.Background()
	stats, err := Run(ctx, src, pipe, Options{Actor: "test"})
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if stats.Imported != 2 {
		t.Fatalf("imported=%d, want 2", stats.Imported)
	}

	content, err := store.Read(ctx, "students/0.md")
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	s := string(content)
	if !strings.Contains(s, "name: Alice") {
		t.Fatalf("missing Alice: %s", s)
	}
	if !strings.Contains(s, "_source: students") {
		t.Fatalf("missing _source: %s", s)
	}
}

func TestExcelKeepsZipAsText(t *testing.T) {
	f := excelize.NewFile()
	defer f.Close()
	f.SetCellValue("Sheet1", "A1", "zip")
	f.SetCellValue("Sheet1", "A2", "02134")
	xlsxPath := filepath.Join(t.TempDir(), "contacts.xlsx")
	if err := f.SaveAs(xlsxPath); err != nil {
		t.Fatalf("save xlsx: %v", err)
	}

	src, _ := NewExcel(xlsxPath, "")
	ch, _ := src.Stream(context.Background())
	if rec := <-ch; rec.Fields["zip"] != "02134" {
		t.Fatalf("zip = %#v, want \"02134\"", rec.Fields["zip"])
	}
}

func TestExcelWithSheetName(t *testing.T) {
	f := excelize.NewFile()
	defer f.Close()

	f.NewSheet("Data")
	f.SetCellValue("Data", "A1", "id")
	f.SetCellValue("Data", "B1", "value")
	f.SetCellValue("Data", "A2", "1")
	f.SetCellValue("Data", "B2", "hello")

	xlsxPath := filepath.Join(t.TempDir(), "test.xlsx")
	f.SaveAs(xlsxPath)

	src, _ := NewExcel(xlsxPath, "Data")
	ch, _ := src.Stream(context.Background())
	count := 0
	for range ch {
		count++
	}
	if count != 1 {
		t.Fatalf("got %d records, want 1", count)
	}
}

func TestYAMLArrayImport(t *testing.T) {
	data := `- name: Alice
  grade: 10
- name: Bob
  grade: 11
- name: Charlie
  grade: 12
`
	yamlFile := filepath.Join(t.TempDir(), "data.yaml")
	os.WriteFile(yamlFile, []byte(data), 0644)

	src, err := NewYAML(yamlFile)
	if err != nil {
		t.Fatalf("new yaml: %v", err)
	}
	defer src.Close()

	pipe, store := testPipeline(t)
	ctx := context.Background()
	stats, err := Run(ctx, src, pipe, Options{Actor: "test"})
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if stats.Imported != 3 {
		t.Fatalf("imported=%d, want 3", stats.Imported)
	}

	content, err := store.Read(ctx, "data/0.md")
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if !strings.Contains(string(content), "name: Alice") {
		t.Fatalf("missing Alice: %s", content)
	}
}

func TestYAMLNestedImport(t *testing.T) {
	data := `students:
  - name: Priya
    grade: 10
  - name: Raj
    grade: 11
`
	yamlFile := filepath.Join(t.TempDir(), "nested.yaml")
	os.WriteFile(yamlFile, []byte(data), 0644)

	src, _ := NewYAML(yamlFile)
	ch, _ := src.Stream(context.Background())
	var recs []Record
	for r := range ch {
		recs = append(recs, r)
	}
	if len(recs) != 2 {
		t.Fatalf("got %d records, want 2", len(recs))
	}
	if recs[0].Fields["name"] != "Priya" {
		t.Fatalf("first record name=%v, want Priya", recs[0].Fields["name"])
	}
}

func TestObsidianImport(t *testing.T) {
	vault := t.TempDir()

	// Create a note with wiki-links and embeds.
	os.MkdirAll(filepath.Join(vault, "notes"), 0755)
	note := `---
title: Test Note
tags: [test, demo]
---

# Hello

This links to [[Other Page]] and [[Page Name|alias]].

Here is an embed: ![[image.png]]
`
	os.WriteFile(filepath.Join(vault, "notes", "test.md"), []byte(note), 0644)

	// Create .obsidian dir that should be skipped.
	os.MkdirAll(filepath.Join(vault, ".obsidian"), 0755)
	os.WriteFile(filepath.Join(vault, ".obsidian", "config.json"), []byte("{}"), 0644)

	// Create an attachment.
	os.MkdirAll(filepath.Join(vault, "attachments"), 0755)
	os.WriteFile(filepath.Join(vault, "attachments", "image.png"), []byte("fakepng"), 0644)

	src, err := NewObsidian(vault)
	if err != nil {
		t.Fatalf("new obsidian: %v", err)
	}
	defer src.Close()

	ch, errs := src.Stream(context.Background())
	var recs []Record
	for r := range ch {
		recs = append(recs, r)
	}
	for err := range errs {
		if err != nil {
			t.Fatalf("stream error: %v", err)
		}
	}

	if len(recs) != 1 {
		t.Fatalf("got %d records, want 1", len(recs))
	}

	raw, ok := recs[0].Fields["_raw_content"].(string)
	if !ok {
		t.Fatalf("no _raw_content field")
	}

	if !strings.Contains(raw, "[[other-page]]") {
		t.Fatalf("wiki-link not rewritten: %s", raw)
	}
	if !strings.Contains(raw, "[[page-name|alias]]") {
		t.Fatalf("aliased wiki-link not rewritten: %s", raw)
	}
	if !strings.Contains(raw, "![image](assets/image.png)") {
		t.Fatalf("embed not rewritten: %s", raw)
	}
}

func TestObsidianSkipsDotObsidian(t *testing.T) {
	vault := t.TempDir()
	os.MkdirAll(filepath.Join(vault, ".obsidian"), 0755)
	os.WriteFile(filepath.Join(vault, ".obsidian", "app.json"), []byte("{}"), 0644)
	os.WriteFile(filepath.Join(vault, "note.md"), []byte("# Hi\n"), 0644)

	src, _ := NewObsidian(vault)
	ch, _ := src.Stream(context.Background())
	count := 0
	for range ch {
		count++
	}
	if count != 1 {
		t.Fatalf("got %d records (should skip .obsidian), want 1", count)
	}
}

func TestConfluenceImport(t *testing.T) {
	exportDir := t.TempDir()

	htmlContent := `<!DOCTYPE html>
<html>
<head>
<title>Test Page</title>
<meta name="author" content="John">
</head>
<body>
<h1>Welcome</h1>
<p>This is a <strong>test</strong> page.</p>
<ul>
<li>Item 1</li>
<li>Item 2</li>
</ul>
<table>
<tr><th>Name</th><th>Score</th></tr>
<tr><td>Alice</td><td>95</td></tr>
</table>
<pre><code>fmt.Println("hello")</code></pre>
<p>Visit <a href="https://example.com">here</a>.</p>
</body>
</html>`
	os.WriteFile(filepath.Join(exportDir, "page.html"), []byte(htmlContent), 0644)

	src, err := NewConfluence(exportDir)
	if err != nil {
		t.Fatalf("new confluence: %v", err)
	}
	defer src.Close()

	ch, errs := src.Stream(context.Background())
	var recs []Record
	for r := range ch {
		recs = append(recs, r)
	}
	for err := range errs {
		if err != nil {
			t.Fatalf("stream error: %v", err)
		}
	}

	if len(recs) != 1 {
		t.Fatalf("got %d records, want 1", len(recs))
	}

	raw, ok := recs[0].Fields["_raw_content"].(string)
	if !ok {
		t.Fatalf("no _raw_content field")
	}

	if !strings.Contains(raw, "# Welcome") {
		t.Fatalf("missing h1: %s", raw)
	}
	if !strings.Contains(raw, "**test**") {
		t.Fatalf("missing bold: %s", raw)
	}
	if !strings.Contains(raw, "- Item 1") {
		t.Fatalf("missing list: %s", raw)
	}
	if !strings.Contains(raw, "| Name | Score |") {
		t.Fatalf("missing table: %s", raw)
	}
	if !strings.Contains(raw, "[here](https://example.com)") {
		t.Fatalf("missing link: %s", raw)
	}

	if recs[0].Fields["title"] != "Test Page" {
		t.Fatalf("title=%v, want Test Page", recs[0].Fields["title"])
	}
	if recs[0].Fields["author"] != "John" {
		t.Fatalf("author=%v, want John", recs[0].Fields["author"])
	}
}

func TestConfluenceNestedPages(t *testing.T) {
	exportDir := t.TempDir()
	os.MkdirAll(filepath.Join(exportDir, "child"), 0755)

	os.WriteFile(filepath.Join(exportDir, "parent.html"), []byte("<html><body><p>Parent</p></body></html>"), 0644)
	os.WriteFile(filepath.Join(exportDir, "child", "page.html"), []byte("<html><body><p>Child</p></body></html>"), 0644)

	src, _ := NewConfluence(exportDir)
	ch, _ := src.Stream(context.Background())
	count := 0
	for range ch {
		count++
	}
	if count != 2 {
		t.Fatalf("got %d pages, want 2", count)
	}
}

func TestGoogleSheetsSkipWithoutEnv(t *testing.T) {
	if os.Getenv("GOOGLE_SHEETS_TEST_ID") == "" {
		t.Skip("skipping google sheets integration test (set GOOGLE_SHEETS_TEST_ID)")
	}
}

func TestDynamoDBSkipWithoutEnv(t *testing.T) {
	if os.Getenv("AWS_DYNAMODB_TEST_TABLE") == "" {
		t.Skip("skipping dynamodb integration test (set AWS_DYNAMODB_TEST_TABLE)")
	}
}

func TestRedisSkipWithoutEnv(t *testing.T) {
	if os.Getenv("REDIS_TEST_ADDR") == "" {
		t.Skip("skipping redis integration test (set REDIS_TEST_ADDR)")
	}
}

func TestElasticsearchSkipWithoutEnv(t *testing.T) {
	if os.Getenv("ES_TEST_URL") == "" {
		t.Skip("skipping elasticsearch integration test (set ES_TEST_URL)")
	}
}

func TestMarkdownImport(t *testing.T) {
	docsDir := t.TempDir()

	// Create a nested structure of markdown files.
	os.MkdirAll(filepath.Join(docsDir, "guides"), 0755)

	// Root level file with frontmatter.
	rootNote := `---
title: Getting Started
category: basics
---

# Getting Started

Welcome to the documentation!
`
	os.WriteFile(filepath.Join(docsDir, "readme.md"), []byte(rootNote), 0644)

	// Nested file without frontmatter.
	guideNote := `# Advanced Guide

This is an advanced topic.

- Point 1
- Point 2
`
	os.WriteFile(filepath.Join(docsDir, "guides", "advanced.md"), []byte(guideNote), 0644)

	// Create .git dir that should be skipped.
	os.MkdirAll(filepath.Join(docsDir, ".git"), 0755)
	os.WriteFile(filepath.Join(docsDir, ".git", "config"), []byte("[core]"), 0644)

	src, err := NewMarkdown(docsDir, MarkdownOpts{})
	if err != nil {
		t.Fatalf("new markdown: %v", err)
	}
	defer src.Close()

	pipe, store := testPipeline(t)
	ctx := context.Background()
	stats, err := Run(ctx, src, pipe, Options{Actor: "test"})
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if stats.Imported != 2 {
		t.Fatalf("imported=%d, want 2", stats.Imported)
	}

	// Verify the root file preserves frontmatter and body.
	content, err := store.Read(ctx, filepath.Base(docsDir)+"/readme.md")
	if err != nil {
		t.Fatalf("read readme: %v", err)
	}
	s := string(content)
	if !strings.Contains(s, "title: Getting Started") {
		t.Fatalf("missing title in frontmatter: %s", s)
	}
	if !strings.Contains(s, "category: basics") {
		t.Fatalf("missing category in frontmatter: %s", s)
	}
	if !strings.Contains(s, "# Getting Started") {
		t.Fatalf("missing body heading: %s", s)
	}
	if !strings.Contains(s, "_source:") {
		t.Fatalf("missing _source tracking: %s", s)
	}
	// Ensure _raw_content is NOT in the output frontmatter.
	if strings.Contains(s, "_raw_content") {
		t.Fatalf("_raw_content should not be in output: %s", s)
	}

	// Verify nested file.
	content2, err := store.Read(ctx, filepath.Base(docsDir)+"/guides/advanced.md")
	if err != nil {
		t.Fatalf("read advanced: %v", err)
	}
	s2 := string(content2)
	if !strings.Contains(s2, "# Advanced Guide") {
		t.Fatalf("missing body in nested file: %s", s2)
	}
}

func TestMarkdownImportPreservesBody(t *testing.T) {
	// Test that the _raw_content handling correctly uses the body.
	docsDir := t.TempDir()

	note := `---
title: Body Test
---

# Main Heading

Paragraph one.

Paragraph two.
`
	os.WriteFile(filepath.Join(docsDir, "note.md"), []byte(note), 0644)

	src, _ := NewMarkdown(docsDir, MarkdownOpts{})
	defer src.Close()

	pipe, store := testPipeline(t)
	ctx := context.Background()
	stats, _ := Run(ctx, src, pipe, Options{Actor: "test"})
	if stats.Imported != 1 {
		t.Fatalf("imported=%d, want 1", stats.Imported)
	}

	content, _ := store.Read(ctx, filepath.Base(docsDir)+"/note.md")
	s := string(content)

	// The original body should be present, not the auto-generated boilerplate.
	if !strings.Contains(s, "# Main Heading") {
		t.Fatalf("body heading missing: %s", s)
	}
	if !strings.Contains(s, "Paragraph one.") {
		t.Fatalf("body paragraph missing: %s", s)
	}
	// Should NOT have the auto-generated "Auto-imported from" text.
	if strings.Contains(s, "Auto-imported from") {
		t.Fatalf("unexpected auto-generated body: %s", s)
	}
}

func TestMarkdownImportSingleFile(t *testing.T) {
	// Test importing a single markdown file (not a directory).
	tmpDir := t.TempDir()

	note := `---
title: Single Note
tags: [test]
---

# Single Note

This is a single file import test.
`
	mdPath := filepath.Join(tmpDir, "single.md")
	os.WriteFile(mdPath, []byte(note), 0644)

	src, err := NewMarkdown(mdPath, MarkdownOpts{})
	if err != nil {
		t.Fatalf("new markdown: %v", err)
	}
	defer src.Close()

	// Name should be the filename without extension
	if src.Name() != "single" {
		t.Fatalf("name=%q, want 'single'", src.Name())
	}

	pipe, store := testPipeline(t)
	ctx := context.Background()
	stats, err := Run(ctx, src, pipe, Options{Actor: "test"})
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if stats.Imported != 1 {
		t.Fatalf("imported=%d, want 1", stats.Imported)
	}

	content, err := store.Read(ctx, "single/single.md")
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	s := string(content)
	if !strings.Contains(s, "title: Single Note") {
		t.Fatalf("missing title: %s", s)
	}
	if !strings.Contains(s, "# Single Note") {
		t.Fatalf("missing body: %s", s)
	}
}

func TestMarkdownImportRejectsNonMarkdown(t *testing.T) {
	tmpDir := t.TempDir()
	txtPath := filepath.Join(tmpDir, "readme.txt")
	os.WriteFile(txtPath, []byte("not markdown"), 0644)

	_, err := NewMarkdown(txtPath, MarkdownOpts{})
	if err == nil {
		t.Fatal("expected error for non-markdown file")
	}
	if !strings.Contains(err.Error(), "not a markdown file") {
		t.Fatalf("unexpected error: %v", err)
	}
}

// Suppress lint for unused json import.
var _ = json.Marshal

func TestArchiveRemovedFiles(t *testing.T) {
	csvData1 := "id,name,age\nalice,Alice,25\nbob,Bob,30\ncharlie,Charlie,35\n"
	csvFile := filepath.Join(t.TempDir(), "people.csv")
	os.WriteFile(csvFile, []byte(csvData1), 0644)

	src1, _ := NewCSV(csvFile, true)
	defer src1.Close()

	pipe, store := testPipeline(t)
	ctx := context.Background()

	// First import: all 3 records
	stats1, err := Run(ctx, src1, pipe, Options{Actor: "test", FullSync: true, IDColumn: "id"})
	if err != nil {
		t.Fatalf("run1: %v", err)
	}
	if stats1.Imported != 3 {
		t.Fatalf("imported=%d, want 3", stats1.Imported)
	}

	// Second import: only 2 records (charlie removed)
	csvData2 := "id,name,age\nalice,Alice,25\nbob,Bob,30\n"
	os.WriteFile(csvFile, []byte(csvData2), 0644)

	src2, _ := NewCSV(csvFile, true)
	defer src2.Close()

	stats2, err := Run(ctx, src2, pipe, Options{Actor: "test", FullSync: true, IDColumn: "id"})
	if err != nil {
		t.Fatalf("run2: %v", err)
	}
	if stats2.Archived != 1 {
		t.Fatalf("archived=%d, want 1", stats2.Archived)
	}

	// Verify charlie's file has _archived_at
	content, err := store.Read(ctx, "people/charlie.md")
	if err != nil {
		t.Fatalf("read charlie: %v", err)
	}
	if !strings.Contains(string(content), "_archived_at:") {
		t.Fatalf("charlie not archived: %s", content)
	}

	// Third import: charlie comes back
	csvData3 := "id,name,age\nalice,Alice,25\nbob,Bob,30\ncharlie,Charlie,36\n"
	os.WriteFile(csvFile, []byte(csvData3), 0644)

	src3, _ := NewCSV(csvFile, true)
	defer src3.Close()

	stats3, err := Run(ctx, src3, pipe, Options{Actor: "test", FullSync: true, IDColumn: "id"})
	if err != nil {
		t.Fatalf("run3: %v", err)
	}
	if stats3.Imported != 1 {
		t.Fatalf("re-imported=%d, want 1 (charlie)", stats3.Imported)
	}

	// Verify charlie is no longer archived
	content, err = store.Read(ctx, "people/charlie.md")
	if err != nil {
		t.Fatalf("read charlie after unarchive: %v", err)
	}
	if strings.Contains(string(content), "_archived_at:") {
		t.Fatalf("charlie still archived after re-import: %s", content)
	}
}
