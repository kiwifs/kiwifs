package vectorstore

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"text/template"
	"time"
)

// DefaultContextTemplate reproduces the pre-K2 behaviour exactly: a chunk is
// prefixed with its heading ancestry joined by " > ". A workspace that sets
// context_template replaces this wholesale, so the default has to stay
// byte-identical or every existing index silently drifts from its content.
const DefaultContextTemplate = "{{ .Headings }}"

// contextHookTimeout bounds a single hook call. Chunking runs on the embed
// worker pool, which already holds a 60s budget for the whole file; a slow
// hook must not eat it, so each call gets a short leash and falls back to the
// deterministic template on expiry.
const contextHookTimeout = 3 * time.Second

// ChunkContext is the data a context template renders against. Fields are
// document-level except Headings/HeadingPath, which describe the section the
// chunk was cut from.
type ChunkContext struct {
	// Path is the knowledge-base path of the source file.
	Path string
	// Title is the page title: frontmatter `title` when present, otherwise
	// the first level-1 heading, otherwise empty.
	Title string
	// HeadingPath is the section's heading ancestry, outermost first, with
	// empty levels removed.
	HeadingPath []string
	// Headings is HeadingPath joined by " > " — the shape the default
	// template needs, precomputed so the common case needs no template funcs.
	Headings string
	// Frontmatter is the page's parsed YAML frontmatter. Nil for documents
	// that have none; `index` on a nil map is a no-op, not an error.
	Frontmatter map[string]any
}

// contextBuilder renders the per-chunk context prefix. It is compiled once
// per Service so a malformed template fails at construction rather than
// silently degrading every index pass.
type contextBuilder struct {
	tmpl    *template.Template
	hookURL string
	client  *http.Client
}

// defaultContextBuilder serves callers that chunk without a configured
// Service (the plain chunkMarkdown entry point, and tests). Compiled at init
// because DefaultContextTemplate is a constant that must always parse.
var defaultContextBuilder = mustContextBuilder(DefaultContextTemplate)

func mustContextBuilder(tmplText string) *contextBuilder {
	b, err := newContextBuilder(tmplText, "")
	if err != nil {
		panic(fmt.Sprintf("vectorstore: default context template: %v", err))
	}
	return b
}

// newContextBuilder compiles tmplText. An empty template means "use the
// default"; hookURL is optional and, when set, takes precedence over the
// template with the template as the fallback.
func newContextBuilder(tmplText, hookURL string) (*contextBuilder, error) {
	if strings.TrimSpace(tmplText) == "" {
		tmplText = DefaultContextTemplate
	}
	tmpl, err := template.New("chunkcontext").Option("missingkey=zero").Parse(tmplText)
	if err != nil {
		return nil, fmt.Errorf("parse context template: %w", err)
	}
	b := &contextBuilder{tmpl: tmpl, hookURL: strings.TrimSpace(hookURL)}
	if b.hookURL != "" {
		b.client = &http.Client{Timeout: contextHookTimeout}
	}
	return b, nil
}

// prefix renders the context string for one section and normalises it to the
// "<context>\n\n" shape the chunker splices in front of the body. An empty
// render yields an empty prefix so unheaded, untitled sections are untouched.
//
// body is passed to the hook only; the template deliberately cannot see it,
// which keeps the template a pure function of page metadata and therefore
// cacheable per section.
func (b *contextBuilder) prefix(ctx context.Context, cc ChunkContext, body string) string {
	if b == nil {
		b = defaultContextBuilder
	}
	rendered := b.render(cc)
	if b.hookURL != "" {
		if hooked, err := b.callHook(ctx, cc, body); err != nil {
			log.Printf("vectorstore: context hook %s: %v (falling back to template)", cc.Path, err)
		} else if strings.TrimSpace(hooked) != "" {
			rendered = hooked
		}
	}
	return normalizePrefix(rendered)
}

func (b *contextBuilder) render(cc ChunkContext) string {
	var buf bytes.Buffer
	if err := b.tmpl.Execute(&buf, cc); err != nil {
		// A template that parses but fails at execution (a bad `index` call,
		// say) must not drop the chunk — degrade to no context.
		log.Printf("vectorstore: context template %s: %v", cc.Path, err)
		return ""
	}
	// `index .Frontmatter "absent"` yields an invalid reflect.Value, which
	// text/template prints as the literal "<no value>" regardless of the
	// missingkey option (that option only governs direct field access). A
	// template referencing a key some pages lack is the normal case, not an
	// error, so the marker is dropped rather than embedded.
	return strings.ReplaceAll(buf.String(), "<no value>", "")
}

// normalizePrefix collapses whatever the template or hook produced into
// either "" or "<text>\n\n". Fixing the separator here is what lets the
// default template be a bare "{{ .Headings }}" and still match the historical
// buildHeadingPrefix output byte for byte.
func normalizePrefix(s string) string {
	s = strings.TrimRight(s, " \t\r\n")
	if s == "" {
		return ""
	}
	return s + "\n\n"
}

// contextHookRequest is the POST body sent to context_hook_url.
type contextHookRequest struct {
	Path        string         `json:"path"`
	Title       string         `json:"title"`
	HeadingPath []string       `json:"heading_path"`
	Headings    string         `json:"headings"`
	Frontmatter map[string]any `json:"frontmatter,omitempty"`
	Chunk       string         `json:"chunk"`
}

// contextHookResponse accepts either {"context": "..."} or a bare JSON
// string, so a trivial hook can be a one-liner.
type contextHookResponse struct {
	Context string `json:"context"`
}

func (b *contextBuilder) callHook(ctx context.Context, cc ChunkContext, body string) (string, error) {
	payload, err := json.Marshal(contextHookRequest{
		Path:        cc.Path,
		Title:       cc.Title,
		HeadingPath: cc.HeadingPath,
		Headings:    cc.Headings,
		Frontmatter: cc.Frontmatter,
		Chunk:       body,
	})
	if err != nil {
		return "", err
	}
	if ctx == nil {
		ctx = context.Background()
	}
	reqCtx, cancel := context.WithTimeout(ctx, contextHookTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, b.hookURL, bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := b.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return "", fmt.Errorf("hook returned %s", resp.Status)
	}
	var decoded contextHookResponse
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return "", fmt.Errorf("decode hook response: %w", err)
	}
	return decoded.Context, nil
}
