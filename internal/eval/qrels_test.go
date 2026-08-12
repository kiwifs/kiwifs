package eval

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestParseQrelsFourColumn(t *testing.T) {
	in := `# leave-one-out golden set
q1 0 projects/a/index.md 1
q1 0 projects/b/index.md 2

q2 0 techniques/stacking.md 1
`
	got, err := ParseQrels(strings.NewReader(in))
	if err != nil {
		t.Fatalf("ParseQrels: %v", err)
	}
	want := map[string]map[string]int{
		"q1": {"projects/a/index.md": 1, "projects/b/index.md": 2},
		"q2": {"techniques/stacking.md": 1},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestParseQrelsThreeColumn(t *testing.T) {
	got, err := ParseQrels(strings.NewReader("q1 docs/a.md 1\nq1 docs/b.md 0\n"))
	if err != nil {
		t.Fatalf("ParseQrels: %v", err)
	}
	if got["q1"]["docs/a.md"] != 1 {
		t.Errorf("docs/a.md grade = %d, want 1", got["q1"]["docs/a.md"])
	}
	// A judged-non-relevant document is retained with grade 0. It is not
	// relevant, but it is also not unjudged, and TREC keeps the distinction.
	if grade, ok := got["q1"]["docs/b.md"]; !ok || grade != 0 {
		t.Errorf("docs/b.md = (%d, %v), want (0, true)", grade, ok)
	}
}

func TestParseQrelsMalformed(t *testing.T) {
	cases := map[string]string{
		"too few fields":   "q1 docs/a.md\n",
		"too many fields":  "q1 0 docs/a.md 1 extra\n",
		"non-integer rank": "q1 0 docs/a.md high\n",
	}
	for name, in := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := ParseQrels(strings.NewReader(in)); err == nil {
				t.Fatal("expected an error, got nil")
			}
		})
	}
}

func TestParseQrelsNegativeGradeIsNonRelevant(t *testing.T) {
	got, err := ParseQrels(strings.NewReader("q1 0 docs/a.md -1\n"))
	if err != nil {
		t.Fatalf("ParseQrels: %v", err)
	}
	if got["q1"]["docs/a.md"] != 0 {
		t.Fatalf("grade = %d, want 0", got["q1"]["docs/a.md"])
	}
}

func TestParseTopics(t *testing.T) {
	in := "q1\thow do I handle missing values?\nq2 what is a good validation scheme\n"
	got, err := ParseTopics(strings.NewReader(in))
	if err != nil {
		t.Fatalf("ParseTopics: %v", err)
	}
	if got["q1"] != "how do I handle missing values?" {
		t.Errorf("q1 = %q", got["q1"])
	}
	if got["q2"] != "what is a good validation scheme" {
		t.Errorf("q2 = %q", got["q2"])
	}
}

func TestParseTopicsMissingText(t *testing.T) {
	if _, err := ParseTopics(strings.NewReader("q1\n")); err == nil {
		t.Fatal("expected an error for a topic with no question text")
	}
}

func writeSet(t *testing.T, root, name, qrels, topics string) {
	t.Helper()
	dir := filepath.Join(root, filepath.FromSlash(EvalDir))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if qrels != "" {
		if err := os.WriteFile(filepath.Join(dir, name+".qrels"), []byte(qrels), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if topics != "" {
		if err := os.WriteFile(filepath.Join(dir, name+".topics"), []byte(topics), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func TestLoadSet(t *testing.T) {
	root := t.TempDir()
	writeSet(t, root, "leave-one-out",
		"q2 0 docs/b.md 1\nq1 0 docs/a.md 2\n",
		"q1\tfirst question\nq2\tsecond question\n")

	queries, err := LoadSet(root, "leave-one-out")
	if err != nil {
		t.Fatalf("LoadSet: %v", err)
	}
	if len(queries) != 2 {
		t.Fatalf("got %d queries, want 2", len(queries))
	}
	// Sorted by id, so the run order does not depend on map iteration.
	if queries[0].ID != "q1" || queries[1].ID != "q2" {
		t.Fatalf("ids = %q, %q; want q1, q2", queries[0].ID, queries[1].ID)
	}
	if queries[0].Question != "first question" {
		t.Errorf("q1 question = %q", queries[0].Question)
	}
	if got := queries[0].RelevantPaths(); !reflect.DeepEqual(got, []string{"docs/a.md"}) {
		t.Errorf("q1 relevant = %v", got)
	}
}

// A judged document that no longer exists in the corpus is a load-time
// non-event: it simply never matches a result, and drags nDCG down through
// IDCG. Loading must not fail, or a single renamed page breaks the whole set.
func TestLoadSetAcceptsUnknownDocID(t *testing.T) {
	root := t.TempDir()
	writeSet(t, root, "s", "q1 0 does/not/exist.md 1\n", "q1\tq\n")
	queries, err := LoadSet(root, "s")
	if err != nil {
		t.Fatalf("LoadSet: %v", err)
	}
	if len(queries) != 1 || queries[0].Relevant["does/not/exist.md"] != 1 {
		t.Fatalf("got %+v", queries)
	}
}

func TestLoadSetQrelsWithoutTopic(t *testing.T) {
	root := t.TempDir()
	writeSet(t, root, "s", "q1 0 docs/a.md 1\nq2 0 docs/b.md 1\n", "q1\tonly the first\n")
	_, err := LoadSet(root, "s")
	if err == nil {
		t.Fatal("expected an error when a query has judgements but no topic")
	}
	if !strings.Contains(err.Error(), "q2") {
		t.Errorf("error should name the offending query: %v", err)
	}
}

func TestLoadSetRejectsPathTraversal(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"../secrets", "a/b", ".."} {
		if _, err := LoadSet(root, name); err == nil {
			t.Errorf("LoadSet(%q) should fail", name)
		}
	}
}

func TestListSets(t *testing.T) {
	root := t.TempDir()
	if got, err := ListSets(root); err != nil || got != nil {
		t.Fatalf("missing dir: got %v, %v", got, err)
	}
	writeSet(t, root, "zulu", "q1 0 a.md 1\n", "q1\tq\n")
	writeSet(t, root, "alpha", "q1 0 a.md 1\n", "q1\tq\n")
	got, err := ListSets(root)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, []string{"alpha", "zulu"}) {
		t.Fatalf("got %v", got)
	}
}
