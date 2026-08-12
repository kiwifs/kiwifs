package importer

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kiwifs/kiwifs/internal/dataview"
	"github.com/kiwifs/kiwifs/internal/events"
	"github.com/kiwifs/kiwifs/internal/markdown"
	"github.com/kiwifs/kiwifs/internal/pipeline"
	"github.com/kiwifs/kiwifs/internal/search"
	"github.com/kiwifs/kiwifs/internal/storage"
	"github.com/kiwifs/kiwifs/internal/versioning"
)

func loadCroissant(t *testing.T, name string) *CroissantSource {
	t.Helper()
	path := filepath.Join("testdata", "croissant", name+".json")
	src, err := NewCroissant(path)
	if err != nil {
		t.Fatalf("NewCroissant(%s): %v", name, err)
	}
	return src
}

// renderPage returns the markdown a full import would write, by draining the
// source exactly as Run does.
func renderPage(t *testing.T, src *CroissantSource) string {
	t.Helper()
	records, errs := src.Stream(context.Background())
	var page string
	n := 0
	for rec := range records {
		n++
		raw, ok := rec.Fields["_raw_content"].(string)
		if !ok {
			t.Fatalf("record %d has no _raw_content", n)
		}
		page = raw
		if rec.PrimaryKey != "data" {
			t.Errorf("PrimaryKey = %q, want %q (success criterion writes <prefix>/data.md)", rec.PrimaryKey, "data")
		}
	}
	for err := range errs {
		if err != nil {
			t.Fatalf("stream error: %v", err)
		}
	}
	if n != 1 {
		t.Fatalf("got %d records, want exactly 1", n)
	}
	return page
}

// recordsOfKind pulls the kiwi-data records back out of the rendered page
// through the same extractor the indexer uses. Asserting on the page text
// would pass even if K3 could not parse what we emit.
func recordsOfKind(t *testing.T, page, kind string) []map[string]any {
	t.Helper()
	blocks, err := markdown.ExtractDataBlocks([]byte(page))
	if err != nil {
		t.Fatalf("ExtractDataBlocks: %v\n---\n%s", err, page)
	}
	var out []map[string]any
	for _, b := range blocks {
		if b.Kind == kind {
			out = append(out, b.Records...)
		}
	}
	return out
}

func findRecord(records []map[string]any, key, value string) map[string]any {
	for _, r := range records {
		if s, _ := r[key].(string); s == value {
			return r
		}
	}
	return nil
}

// --- Kaggle-emitted file ---

func TestCroissantKaggleEmitted(t *testing.T) {
	src := loadCroissant(t, "titanic")

	if got, want := src.Name(), "titanic"; got != want {
		t.Errorf("Name() = %q, want %q", got, want)
	}

	page := renderPage(t, src)
	fm, err := markdown.Frontmatter([]byte(page))
	if err != nil {
		t.Fatalf("Frontmatter: %v", err)
	}
	if got := fm["title"]; got != "Titanic" {
		t.Errorf("title = %v, want Titanic", got)
	}
	if got := fm["kind"]; got != "dataset" {
		t.Errorf("kind = %v, want dataset", got)
	}
	if got := fm["conforms-to"]; got != "http://mlcommons.org/croissant/1.0" {
		t.Errorf("conforms-to = %v", got)
	}
	if got := fm["url"]; got != "https://www.openml.org/d/40945" {
		t.Errorf("url = %v", got)
	}

	schema := recordsOfKind(t, page, "dataset-schema")
	// 3 record sets: genders(2) + embarkation_ports(3) + passengers(14).
	if len(schema) != 19 {
		t.Fatalf("got %d dataset-schema records, want 19", len(schema))
	}

	survived := findRecord(schema, "field-id", "passengers/survived")
	if survived == nil {
		t.Fatal("no record for passengers/survived")
	}
	if got := survived["name"]; got != "survived" {
		t.Errorf("name = %v, want survived (local segment of the compound id)", got)
	}
	if got := survived["dtype"]; got != "integer" {
		t.Errorf("dtype = %v, want integer", got)
	}
	if got := survived["column"]; got != "survived" {
		t.Errorf("column = %v, want survived", got)
	}
	if got := survived["source-file"]; got != "passengers.csv" {
		t.Errorf("source-file = %v, want passengers.csv", got)
	}
	if got := survived["record-set"]; got != "passengers" {
		t.Errorf("record-set = %v, want passengers", got)
	}

	// references is the join key the whole point of a schema import is to keep.
	gender := findRecord(schema, "field-id", "passengers/gender")
	if gender == nil {
		t.Fatal("no record for passengers/gender")
	}
	if got := gender["references"]; got != "genders/label" {
		t.Errorf("references = %v, want genders/label", got)
	}

	files := recordsOfKind(t, page, "dataset-file")
	if len(files) != 3 {
		t.Fatalf("got %d dataset-file records, want 3", len(files))
	}
	passengersCSV := findRecord(files, "id", "passengers.csv")
	if passengersCSV == nil {
		t.Fatal("no dataset-file record for passengers.csv")
	}
	if got := passengersCSV["encoding-format"]; got != "text/csv" {
		t.Errorf("encoding-format = %v, want text/csv", got)
	}
	if got := passengersCSV["file-type"]; got != "file-object" {
		t.Errorf("file-type = %v, want file-object", got)
	}
	if got := passengersCSV["content-url"]; got != "data/titanic.csv" {
		t.Errorf("content-url = %v", got)
	}
}

// --- Hugging Face-emitted file ---

func TestCroissantHuggingFaceEmitted(t *testing.T) {
	src := loadCroissant(t, "huggingface-mnist")
	page := renderPage(t, src)

	fm, err := markdown.Frontmatter([]byte(page))
	if err != nil {
		t.Fatalf("Frontmatter: %v", err)
	}
	if got := fm["title"]; got != "mnist" {
		t.Errorf("title = %v, want mnist", got)
	}

	schema := recordsOfKind(t, page, "dataset-schema")
	image := findRecord(schema, "field-id", "default/image")
	if image == nil {
		t.Fatalf("no record for default/image; got %d records", len(schema))
	}
	// A vision column is exactly the case §7 warns will stress a
	// columnar-first schema — it must at least survive the round trip.
	if got := image["dtype"]; got != "image" {
		t.Errorf("dtype = %v, want image", got)
	}

	// Hugging Face sources columns from a FileSet, not a FileObject.
	split := findRecord(schema, "field-id", "default/split")
	if split == nil {
		t.Fatal("no record for default/split")
	}
	if got := split["source-file"]; got != "parquet-files" {
		t.Errorf("source-file = %v, want parquet-files (the FileSet id)", got)
	}
	if got := split["file-property"]; got != "fullpath" {
		t.Errorf("file-property = %v, want fullpath", got)
	}
	if got := split["references"]; got != "mnist_splits/split_name" {
		t.Errorf("references = %v", got)
	}

	files := recordsOfKind(t, page, "dataset-file")
	parquet := findRecord(files, "id", "parquet-files")
	if parquet == nil {
		t.Fatal("no dataset-file record for parquet-files")
	}
	if got := parquet["file-type"]; got != "file-set" {
		t.Errorf("file-type = %v, want file-set", got)
	}
	if got := parquet["includes"]; got != "*/*/*.parquet" {
		t.Errorf("includes = %v", got)
	}
	if got, want := parquet["contained-in"], "repo"; !containsString(got, want) {
		t.Errorf("contained-in = %v, want to contain %q", got, want)
	}
}

// --- aliased @context ---

// TestCroissantAliasedContext is the reason this importer expands the document
// instead of reading JSON keys. Every term in the fixture is aliased and both
// namespaces use their alternate spelling; a literal parser extracts nothing.
func TestCroissantAliasedContext(t *testing.T) {
	src := loadCroissant(t, "aliased-context")

	if got, want := src.Name(), "aliased-sample-dataset"; got != want {
		t.Errorf("Name() = %q, want %q", got, want)
	}

	page := renderPage(t, src)
	fm, err := markdown.Frontmatter([]byte(page))
	if err != nil {
		t.Fatalf("Frontmatter: %v", err)
	}
	if got := fm["title"]; got != "Aliased Sample Dataset" {
		t.Errorf("title = %v", got)
	}
	if got := fm["cite-as"]; got != "Aliased et al. (2024)" {
		t.Errorf("cite-as = %v", got)
	}
	if got := fm["version"]; got != "2.1.0" {
		t.Errorf("version = %v", got)
	}
	if got := fm["license"]; got != "https://creativecommons.org/licenses/by/4.0/" {
		t.Errorf("license = %v", got)
	}

	schema := recordsOfKind(t, page, "dataset-schema")
	if len(schema) != 2 {
		t.Fatalf("got %d dataset-schema records, want 2", len(schema))
	}

	target := findRecord(schema, "field-id", "rows/target")
	if target == nil {
		t.Fatal("no record for rows/target")
	}
	if got := target["dtype"]; got != "float" {
		t.Errorf("dtype = %v, want float", got)
	}
	if got := target["column"]; got != "target" {
		t.Errorf("column = %v, want target", got)
	}
	if got := target["source-file"]; got != "train.csv" {
		t.Errorf("source-file = %v, want train.csv", got)
	}

	group := findRecord(schema, "field-id", "rows/group")
	if group == nil {
		t.Fatal("no record for rows/group")
	}
	if got := group["references"]; got != "groups/id" {
		t.Errorf("references = %v, want groups/id", got)
	}
	if got := group["repeated"]; got != true {
		t.Errorf("repeated = %v, want true", got)
	}

	files := recordsOfKind(t, page, "dataset-file")
	if len(files) != 1 || files[0]["id"] != "train.csv" {
		t.Errorf("dataset-file records = %v", files)
	}
}

// --- dtype selection ---

// TestCroissantDtypeSkipsSemanticAnnotation pins the rule that a dataType list
// mixes storage types with semantic annotations. titanic's gender label is
// [sc:Text, sc:name]; "take the first entry" would report `name` as the dtype.
func TestCroissantDtypeSkipsSemanticAnnotation(t *testing.T) {
	page := renderPage(t, loadCroissant(t, "titanic"))
	schema := recordsOfKind(t, page, "dataset-schema")

	label := findRecord(schema, "field-id", "genders/label")
	if label == nil {
		t.Fatal("no record for genders/label")
	}
	if got := label["dtype"]; got != "text" {
		t.Errorf("dtype = %v, want text", got)
	}
	// The annotation is not discarded, only demoted out of `dtype`.
	raw, _ := label["data-type"].([]any)
	if len(raw) != 2 || raw[0] != "https://schema.org/Text" || raw[1] != "https://schema.org/name" {
		t.Errorf("data-type = %v, want both IRIs preserved in order", label["data-type"])
	}
}

// TestCroissantUnknownDtypeIsNull applies Phase 0 finding #2: an unrecognised
// type must not become a string sentinel in a field that queries compare.
func TestCroissantUnknownDtypeIsNull(t *testing.T) {
	doc := `{
	  "@context": {"@vocab": "https://schema.org/", "cr": "http://mlcommons.org/croissant/",
	    "recordSet": "cr:recordSet", "field": "cr:field",
	    "dataType": {"@id": "cr:dataType", "@type": "@vocab"}},
	  "@type": "Dataset",
	  "name": "Unknown Types",
	  "recordSet": [{"@type": "cr:RecordSet", "@id": "rows", "name": "rows",
	    "field": [{"@type": "cr:Field", "@id": "rows/mystery", "name": "rows/mystery",
	      "dataType": "https://example.org/CustomType"}]}]
	}`
	src, err := NewCroissantFromBytes([]byte(doc), "inline")
	if err != nil {
		t.Fatalf("NewCroissantFromBytes: %v", err)
	}
	page := renderPage(t, src)
	rec := findRecord(recordsOfKind(t, page, "dataset-schema"), "field-id", "rows/mystery")
	if rec == nil {
		t.Fatal("no record for rows/mystery")
	}
	v, present := rec["dtype"]
	if !present {
		t.Fatal("dtype key absent; it must be present and null so a record does not inherit the page value")
	}
	if v != nil {
		t.Errorf("dtype = %#v, want nil", v)
	}
	if got := rec["data-type"]; !containsString(got, "https://example.org/CustomType") {
		t.Errorf("data-type = %v, want the unmapped IRI preserved", got)
	}
}

// --- robustness ---

func TestCroissantRejectsMalformedInput(t *testing.T) {
	cases := []struct {
		name string
		doc  string
		want string
	}{
		{"not json", `{"@context":`, "parse json"},
		{"no dataset node", `{"@context": {"@vocab": "https://schema.org/"}, "@type": "Person", "name": "nobody"}`, "no "},
		{"bad context", `{"@context": 42, "name": "x"}`, "expand json-ld"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := NewCroissantFromBytes([]byte(tc.doc), "inline")
			if err == nil {
				t.Fatal("expected an error")
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Errorf("error = %q, want it to mention %q", err, tc.want)
			}
		})
	}
}

// TestCroissantRefusesRemoteContext locks the offline document loader. A
// fetched context would make imports depend on a third-party host being up and
// let an untrusted document steer a server-side request.
func TestCroissantRefusesRemoteContext(t *testing.T) {
	doc := `{"@context": "https://evil.example.com/ctx.jsonld", "@type": "Dataset", "name": "x"}`
	_, err := NewCroissantFromBytes([]byte(doc), "inline")
	if err == nil {
		t.Fatal("expected an error for a remote context")
	}
	if !strings.Contains(err.Error(), "evil.example.com") {
		t.Errorf("error = %q, want it to name the refused URL", err)
	}
}

// TestCroissantResolvesWellKnownContextOffline is the other half: a document
// that references the standard Croissant context by URL still works, from the
// embedded copy, with no network.
func TestCroissantResolvesWellKnownContextOffline(t *testing.T) {
	doc := `{
	  "@context": "http://mlcommons.org/croissant/",
	  "@type": "sc:Dataset",
	  "name": "Remote Context Dataset",
	  "recordSet": [{"@type": "cr:RecordSet", "@id": "rows", "name": "rows",
	    "field": [{"@type": "cr:Field", "@id": "rows/x", "name": "rows/x", "dataType": "sc:Float"}]}]
	}`
	src, err := NewCroissantFromBytes([]byte(doc), "inline")
	if err != nil {
		t.Fatalf("NewCroissantFromBytes: %v", err)
	}
	page := renderPage(t, src)
	rec := findRecord(recordsOfKind(t, page, "dataset-schema"), "field-id", "rows/x")
	if rec == nil {
		t.Fatalf("no record for rows/x\n%s", page)
	}
	if got := rec["dtype"]; got != "float" {
		t.Errorf("dtype = %v, want float", got)
	}
}

// TestCroissantFenceSurvivesBacktickedDescription: a description containing a
// code fence would otherwise close the kiwi-data block early and spill the
// rest of the schema into the page body as prose.
func TestCroissantFenceSurvivesBacktickedDescription(t *testing.T) {
	doc := "{\n" +
		`  "@context": {"@vocab": "https://schema.org/", "cr": "http://mlcommons.org/croissant/",` +
		`    "recordSet": "cr:recordSet", "field": "cr:field",` +
		`    "dataType": {"@id": "cr:dataType", "@type": "@vocab"}},` + "\n" +
		`  "@type": "Dataset", "name": "Fenced",` + "\n" +
		`  "recordSet": [{"@type": "cr:RecordSet", "@id": "rows", "name": "rows",` + "\n" +
		`    "field": [` + "\n" +
		`      {"@type": "cr:Field", "@id": "rows/a", "name": "rows/a", "dataType": "Text",` + "\n" +
		`       "description": "Parsed with ` + "```" + `python\npd.read_csv(f)\n` + "```" + `"},` + "\n" +
		`      {"@type": "cr:Field", "@id": "rows/b", "name": "rows/b", "dataType": "Integer"}` + "\n" +
		`    ]}]` + "\n}"

	src, err := NewCroissantFromBytes([]byte(doc), "inline")
	if err != nil {
		t.Fatalf("NewCroissantFromBytes: %v", err)
	}
	page := renderPage(t, src)

	schema := recordsOfKind(t, page, "dataset-schema")
	if len(schema) != 2 {
		t.Fatalf("got %d records, want 2 — the fence was terminated early\n%s", len(schema), page)
	}
	if findRecord(schema, "field-id", "rows/b") == nil {
		t.Errorf("rows/b was lost after the backticked description\n%s", page)
	}
}

// TestCroissantEmptyRecordSetDoesNotEmitBrokenBlock: a record set with no
// fields must not produce an empty kiwi-data block, which K3 reports as a
// parse error for the whole page.
func TestCroissantEmptyRecordSetDoesNotEmitBrokenBlock(t *testing.T) {
	doc := `{
	  "@context": {"@vocab": "https://schema.org/", "cr": "http://mlcommons.org/croissant/",
	    "recordSet": "cr:recordSet", "field": "cr:field"},
	  "@type": "Dataset", "name": "Empty",
	  "recordSet": [{"@type": "cr:RecordSet", "@id": "rows", "name": "rows"}]
	}`
	src, err := NewCroissantFromBytes([]byte(doc), "inline")
	if err != nil {
		t.Fatalf("NewCroissantFromBytes: %v", err)
	}
	page := renderPage(t, src)
	if _, err := markdown.ExtractDataBlocks([]byte(page)); err != nil {
		t.Errorf("ExtractDataBlocks: %v\n%s", err, page)
	}
}

// --- transport ---

func TestCroissantFromURL(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "croissant", "titanic.json"))
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Accept"); !strings.Contains(got, "ld+json") {
			t.Errorf("Accept = %q", got)
		}
		w.Header().Set("Content-Type", "application/ld+json")
		_, _ = w.Write(raw)
	}))
	defer srv.Close()

	src, err := NewCroissantFromURL(srv.URL + "/croissant/download")
	if err != nil {
		t.Fatalf("NewCroissantFromURL: %v", err)
	}
	if got := src.Name(); got != "titanic" {
		t.Errorf("Name() = %q", got)
	}
	if len(recordsOfKind(t, renderPage(t, src), "dataset-schema")) != 19 {
		t.Error("URL-fetched document did not produce the same schema as the file")
	}
}

func TestCroissantFromURLReportsHTTPFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	if _, err := NewCroissantFromURL(srv.URL); err == nil || !strings.Contains(err.Error(), "404") {
		t.Errorf("err = %v, want it to report HTTP 404", err)
	}
}

func TestCroissantIsBuiltinSource(t *testing.T) {
	if !IsBuiltinSource("croissant") {
		t.Error("croissant must be registered as a builtin source or the API routes it to Airbyte")
	}
	if IsSyncable("croissant") {
		t.Error("croissant is a one-shot metadata import, not a syncable live source")
	}
}

func containsString(v any, want string) bool {
	switch vv := v.(type) {
	case string:
		return vv == want
	case []any:
		for _, item := range vv {
			if s, _ := item.(string); s == want {
				return true
			}
		}
	case []string:
		for _, s := range vv {
			if s == want {
				return true
			}
		}
	}
	return false
}

// TestCroissantEndToEndRecordsAreQueryable is K11's success criterion: the
// imported page's dataset-schema records must be reachable by the K3 DQL
// records source, with no hand transcription anywhere in between. It runs the
// real pipeline and the real indexer rather than seeding page_records, because
// the thing under test is precisely that what this importer emits is what the
// indexer accepts.
func TestCroissantEndToEndRecordsAreQueryable(t *testing.T) {
	dir := t.TempDir()
	store, err := storage.NewLocal(dir)
	if err != nil {
		t.Fatal(err)
	}
	searcher, err := search.NewSQLite(dir, store)
	if err != nil {
		t.Fatal(err)
	}
	defer searcher.Close()

	pipe := pipeline.New(store, versioning.NewNoop(), searcher, nil, events.NewHub(), nil, "")
	src := loadCroissant(t, "titanic")
	defer src.Close()

	ctx := context.Background()
	stats, err := Run(ctx, src, pipe, Options{Actor: "test"})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if stats.Imported != 1 || len(stats.Errors) > 0 {
		t.Fatalf("imported=%d errors=%v, want 1 and none", stats.Imported, stats.Errors)
	}

	// The success criterion names the path explicitly.
	if _, err := store.Read(ctx, "titanic/data.md"); err != nil {
		t.Fatalf("read titanic/data.md: %v", err)
	}

	exec := dataview.NewExecutor(searcher.ReadDB())
	result, err := exec.Query(ctx, `
TABLE name, dtype, column, source-file
FROM RECORDS "dataset-schema"
WHERE record-set = "passengers"
SORT name ASC`, 0, 0)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if len(result.Rows) != 14 {
		t.Fatalf("got %d rows, want 14 passenger columns: %+v", len(result.Rows), result.Rows)
	}

	// The parent page's frontmatter is addressable alongside the record fields,
	// which is what makes a cross-dataset schema query possible at all.
	titles, err := exec.Query(ctx,
		`TABLE title, name, dtype FROM RECORDS "dataset-schema" WHERE dtype = "integer"`, 0, 0)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if len(titles.Rows) == 0 {
		t.Fatal("no integer-typed columns found")
	}
	for _, row := range titles.Rows {
		if row["title"] != "Titanic" {
			t.Errorf("title = %v, want Titanic (inherited from the page)", row["title"])
		}
	}

	// dtype must be null, never a string sentinel, for an unmapped type —
	// otherwise SQLite's NULL < numeric < TEXT ordering corrupts range filters
	// on any numeric field a later record kind adds (Phase 0 finding #2).
	nulls, err := exec.Query(ctx,
		`TABLE name FROM RECORDS "dataset-schema" WHERE dtype = "name"`, 0, 0)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if len(nulls.Rows) != 0 {
		t.Errorf("a semantic annotation leaked into dtype: %+v", nulls.Rows)
	}
}
