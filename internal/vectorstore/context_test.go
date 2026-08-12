package vectorstore

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// legacyHeadingPrefix is verbatim the pre-K2 buildHeadingPrefix. It exists
// only so the default context template can be pinned against the exact bytes
// the old code emitted — a drift here silently invalidates every index built
// before context enrichment landed, with no error anywhere to notice it.
func legacyHeadingPrefix(ancestry []string) string {
	var parts []string
	for _, h := range ancestry {
		if h != "" {
			parts = append(parts, h)
		}
	}
	if len(parts) == 0 {
		return ""
	}
	return strings.Join(parts, " > ") + "\n\n"
}

func TestDefaultTemplateMatchesLegacyHeadingPrefix(t *testing.T) {
	cases := [][]string{
		nil,
		{},
		{""},
		{"", ""},
		{"Alpha"},
		{"Alpha", "Beta"},
		{"Alpha", "Beta", "Gamma"},
		{"Alpha", "", "Gamma"}, // h1 → h3, skipped level
		{"", "Beta"},           // document starts at h2
	}
	for _, ancestry := range cases {
		var dc *docContext // nil → default builder, no page metadata
		got := dc.prefix(ancestry, "body text")
		want := legacyHeadingPrefix(ancestry)
		if got != want {
			t.Errorf("ancestry %q: got %q, want %q", ancestry, got, want)
		}
	}
}

// TestDefaultTemplateViaService pins the same guarantee one layer up: a
// Service built with no ContextTemplate must chunk identically to the bare
// chunkMarkdown entry point.
func TestDefaultTemplateViaService(t *testing.T) {
	b, err := newContextBuilder("", "")
	if err != nil {
		t.Fatalf("newContextBuilder: %v", err)
	}
	body := "# Alpha\n\nFirst body paragraph that is reasonably long.\n\n## Beta\n\nSecond body paragraph, also of a decent length.\n"
	want := chunkMarkdown(body, 1500, 10)
	got := chunkMarkdownWithContext(body, 1500, 10, &docContext{path: "a.md", title: "Alpha", builder: b})
	if len(got) != len(want) {
		t.Fatalf("chunk count %d != %d\ngot=%q\nwant=%q", len(got), len(want), got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("chunk %d:\n got %q\nwant %q", i, got[i], want[i])
		}
	}
}

func TestCustomTemplateRendersTitleAndFrontmatter(t *testing.T) {
	b, err := newContextBuilder(`{{ .Title }} ({{ index .Frontmatter "kind" }}){{ if .Headings }} > {{ .Headings }}{{ end }}`, "")
	if err != nil {
		t.Fatalf("newContextBuilder: %v", err)
	}
	dc := &docContext{
		path:        "datasets/sales/data.md",
		title:       "Sales",
		frontmatter: map[string]any{"kind": "dataset-data"},
		builder:     b,
	}

	got := dc.prefix([]string{"Dataset", "Schema"}, "body")
	want := "Sales (dataset-data) > Dataset > Schema\n\n"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}

	// No headings → the conditional collapses, and the prefix is still
	// normalised to exactly one blank-line separator.
	got = dc.prefix(nil, "body")
	want = "Sales (dataset-data)\n\n"
	if got != want {
		t.Fatalf("headless: got %q, want %q", got, want)
	}
}

func TestTemplateMissingFrontmatterKeyIsEmptyNotError(t *testing.T) {
	b, err := newContextBuilder(`{{ .Title }}{{ index .Frontmatter "nope" }}`, "")
	if err != nil {
		t.Fatalf("newContextBuilder: %v", err)
	}
	dc := &docContext{title: "T", frontmatter: map[string]any{}, builder: b}
	if got := dc.prefix(nil, "body"); got != "T\n\n" {
		t.Fatalf("got %q, want %q", got, "T\n\n")
	}
	// Nil frontmatter must behave the same way rather than panicking.
	dc.frontmatter = nil
	if got := dc.prefix(nil, "body"); got != "T\n\n" {
		t.Fatalf("nil frontmatter: got %q", got)
	}
}

func TestMalformedTemplateFailsAtNewServiceNotIndexTime(t *testing.T) {
	if _, err := newContextBuilder("{{ .Title ", ""); err == nil {
		t.Fatal("expected a parse error for an unterminated action")
	}
	svc, err := NewService("/", nil, &fakeEmbedder{}, &fakeStore{}, Options{
		WorkerCount:     1,
		ContextTemplate: "{{ .Title ",
	})
	if err == nil {
		svc.Close()
		t.Fatal("NewService accepted a malformed context template")
	}
	if svc != nil {
		t.Fatal("NewService returned a Service alongside an error")
	}
}

func TestContextHookOverridesTemplate(t *testing.T) {
	var gotReq contextHookRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&gotReq); err != nil {
			t.Errorf("decode hook request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"context":"hook-supplied context"}`))
	}))
	defer srv.Close()

	b, err := newContextBuilder("{{ .Headings }}", srv.URL)
	if err != nil {
		t.Fatalf("newContextBuilder: %v", err)
	}
	dc := &docContext{ctx: context.Background(), path: "p.md", title: "P", builder: b}

	if got := dc.prefix([]string{"Alpha"}, "the chunk body"); got != "hook-supplied context\n\n" {
		t.Fatalf("got %q, want hook context", got)
	}
	if gotReq.Chunk != "the chunk body" {
		t.Errorf("hook did not receive the chunk body, got %q", gotReq.Chunk)
	}
	if gotReq.Headings != "Alpha" || gotReq.Path != "p.md" || gotReq.Title != "P" {
		t.Errorf("hook payload lost metadata: %+v", gotReq)
	}
}

// TestContextHookFailureFallsBackToTemplate covers every failure mode the
// hook can produce. In none of them may the chunk be dropped or the prefix be
// lost — a flaky sidecar must degrade to the deterministic template.
func TestContextHookFailureFallsBackToTemplate(t *testing.T) {
	cases := []struct {
		name    string
		handler http.HandlerFunc
	}{
		{"non-2xx", func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "boom", http.StatusInternalServerError)
		}},
		{"malformed json", func(w http.ResponseWriter, r *http.Request) {
			_, _ = w.Write([]byte("not json at all"))
		}},
		{"empty context", func(w http.ResponseWriter, r *http.Request) {
			_, _ = w.Write([]byte(`{"context":"   "}`))
		}},
		{"missing field", func(w http.ResponseWriter, r *http.Request) {
			_, _ = w.Write([]byte(`{"other":"x"}`))
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(tc.handler)
			defer srv.Close()
			b, err := newContextBuilder("{{ .Title }} > {{ .Headings }}", srv.URL)
			if err != nil {
				t.Fatalf("newContextBuilder: %v", err)
			}
			dc := &docContext{ctx: context.Background(), title: "Fallback", builder: b}
			if got := dc.prefix([]string{"Alpha"}, "body"); got != "Fallback > Alpha\n\n" {
				t.Fatalf("got %q, want the template fallback", got)
			}
		})
	}

	// An unreachable host is the other realistic failure and must not hang
	// the index pass beyond the hook timeout.
	b, err := newContextBuilder("{{ .Title }}", "http://127.0.0.1:1/hook")
	if err != nil {
		t.Fatalf("newContextBuilder: %v", err)
	}
	dc := &docContext{ctx: context.Background(), title: "Unreachable", builder: b}
	if got := dc.prefix(nil, "body"); got != "Unreachable\n\n" {
		t.Fatalf("unreachable hook: got %q", got)
	}
}

// capturingEmbedder records the exact strings handed to the embedder, which
// is the only place the stored chunk text can be observed end to end.
type capturingEmbedder struct {
	mu    sync.Mutex
	texts []string
}

func (c *capturingEmbedder) Embed(ctx context.Context, texts []string) ([][]float32, error) {
	c.mu.Lock()
	c.texts = append(c.texts, texts...)
	c.mu.Unlock()
	out := make([][]float32, len(texts))
	for i := range texts {
		out[i] = []float32{1}
	}
	return out, nil
}

func (c *capturingEmbedder) Dimensions() int { return 1 }

func (c *capturingEmbedder) seen() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]string(nil), c.texts...)
}

func TestIndexHandsContextPrefixToEmbedder(t *testing.T) {
	emb := &capturingEmbedder{}
	svc, err := NewService("/", nil, emb, &fakeStore{}, Options{
		WorkerCount:     1,
		ContextTemplate: `{{ .Title }}{{ if .Headings }} > {{ .Headings }}{{ end }}`,
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	defer svc.Close()

	content := []byte("---\ntitle: Sales\nkind: dataset\n---\n\n" +
		"# Overview\n\nThe target is a skewed continuous variable measured per row.\n\n" +
		"## Metric\n\nPredictions are scored by root mean squared error on the holdout split.\n")

	if err := svc.Index(context.Background(), "datasets/sales/index.md", content); err != nil {
		t.Fatalf("Index: %v", err)
	}

	seen := emb.seen()
	if len(seen) == 0 {
		t.Fatal("embedder received no chunks")
	}
	for i, text := range seen {
		if !strings.HasPrefix(text, "Sales") {
			t.Errorf("chunk %d lacks the title prefix: %q", i, text)
		}
	}
	joined := strings.Join(seen, "\n---\n")
	if !strings.Contains(joined, "Sales > Overview") {
		t.Errorf("heading path missing from context prefix:\n%s", joined)
	}
}

// TestIndexStripsFrontmatterFromChunkBody locks the fix for the leak that
// context enrichment exposed: goldmark reads frontmatter's closing `---` as a
// setext underline, so the raw YAML was being emitted as its own embedded
// chunk. Metadata belongs in the context prefix, not the body.
func TestIndexStripsFrontmatterFromChunkBody(t *testing.T) {
	emb := &capturingEmbedder{}
	svc, err := NewService("/", nil, emb, &fakeStore{}, Options{WorkerCount: 1})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	defer svc.Close()

	content := []byte("---\ntitle: My Page\nkind: dataset\nstatus: verified\n---\n\n" +
		"# Heading One\n\nBody text that is long enough to stand on its own as a chunk.\n")

	if err := svc.Index(context.Background(), "notes/page.md", content); err != nil {
		t.Fatalf("Index: %v", err)
	}

	for i, text := range emb.seen() {
		for _, leaked := range []string{"kind: dataset", "status: verified", "title: My Page"} {
			if strings.Contains(text, leaked) {
				t.Errorf("chunk %d leaked frontmatter %q: %q", i, leaked, text)
			}
		}
	}
}
