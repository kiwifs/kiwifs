package janitor

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/kiwifs/kiwifs/internal/config"
)

func TestExtractExternalURLs_SkipsFrontmatterAndCodeBlocks(t *testing.T) {
	content := []byte(`---
url: https://ignored.example.com/frontmatter
---

Visit https://docs.example.com/guide in prose.

` + "```" + `
curl https://code.example.com/hidden
` + "```" + `

See [API](https://link.example.com/api) for details.
`)
	urls := extractExternalURLs(content)
	if len(urls) != 2 {
		t.Fatalf("expected 2 URLs, got %v", urls)
	}
	if urls[0] != "https://docs.example.com/guide" {
		t.Fatalf("unexpected first URL: %q", urls[0])
	}
	if urls[1] != "https://link.example.com/api" {
		t.Fatalf("unexpected second URL: %q", urls[1])
	}
}

func TestExternalLinkChecker_FlagsBrokenLinks(t *testing.T) {
	okSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer okSrv.Close()

	brokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer brokenSrv.Close()

	root := t.TempDir()
	enabled := true
	cfg := config.ExternalLinkCheckConfig{
		Check:         &enabled,
		Timeout:       2 * time.Second,
		CacheTTL:      time.Hour,
		MaxConcurrent: 2,
		RequestDelay:  0,
		MaxRedirects:  3,
		UserAgent:     "KiwiFS-LinkChecker/1.0",
		Background:    false,
	}
	checker := newExternalLinkChecker(root, cfg)

	pages := []pageInfo{
		{
			path:    "docs/setup.md",
			content: []byte("See " + brokenSrv.URL + "/guide and " + okSrv.URL + "/ok for details that are long enough."),
		},
	}

	findings := checker.CheckPages(context.Background(), pages)
	if len(findings) != 1 {
		t.Fatalf("expected 1 broken link, got %+v", findings)
	}
	if findings[0].Path != "docs/setup.md" {
		t.Fatalf("unexpected path: %q", findings[0].Path)
	}
	if findings[0].Status != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", findings[0].Status)
	}
	if findings[0].Rule != externalLinkRotRule {
		t.Fatalf("unexpected rule: %q", findings[0].Rule)
	}
}

func TestExternalLinkChecker_RespectsIgnoreList(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	root := t.TempDir()
	enabled := true
	cfg := config.ExternalLinkCheckConfig{
		Check:         &enabled,
		Timeout:       2 * time.Second,
		CacheTTL:      time.Hour,
		MaxConcurrent: 1,
		RequestDelay:  0,
		IgnoreHosts:   []string{"127.0.0.1", "localhost"},
		Background:    false,
	}
	checker := newExternalLinkChecker(root, cfg)

	pages := []pageInfo{{
		path:    "page.md",
		content: []byte("Link: " + srv.URL),
	}}
	findings := checker.CheckPages(context.Background(), pages)
	if len(findings) != 0 {
		t.Fatalf("expected ignored host to produce no findings, got %+v", findings)
	}
}

func TestExternalLinkChecker_UsesCache(t *testing.T) {
	callCount := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	root := t.TempDir()
	enabled := true
	cfg := config.ExternalLinkCheckConfig{
		Check:         &enabled,
		Timeout:       2 * time.Second,
		CacheTTL:      time.Hour,
		MaxConcurrent: 1,
		RequestDelay:  0,
		Background:    false,
	}
	checker := newExternalLinkChecker(root, cfg)
	checker.client = srv.Client()

	pages := []pageInfo{{path: "page.md", content: []byte(srv.URL + " is referenced here with enough text.")}}

	findings := checker.CheckPages(context.Background(), pages)
	if len(findings) != 1 {
		t.Fatalf("expected cached broken link, got %+v", findings)
	}
	firstCalls := callCount

	findings = checker.CheckPages(context.Background(), pages)
	if len(findings) != 1 {
		t.Fatalf("expected cached finding on second pass, got %+v", findings)
	}
	if callCount != firstCalls {
		t.Fatalf("expected cache hit (calls=%d, first=%d)", callCount, firstCalls)
	}
}

func TestExternalLinkChecker_HEADFallbackToGET(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	root := t.TempDir()
	enabled := true
	cfg := config.ExternalLinkCheckConfig{
		Check:         &enabled,
		Timeout:       2 * time.Second,
		CacheTTL:      time.Hour,
		MaxConcurrent: 1,
		RequestDelay:  0,
		Background:    false,
	}
	checker := newExternalLinkChecker(root, cfg)
	checker.client = srv.Client()

	pages := []pageInfo{{path: "page.md", content: []byte("See " + srv.URL + " for working docs with enough characters.")}}
	findings := checker.CheckPages(context.Background(), pages)
	if len(findings) != 0 {
		t.Fatalf("expected healthy link, got %+v", findings)
	}
}

func TestScan_IncludesExternalLinksWhenEnabled(t *testing.T) {
	brokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusGone)
	}))
	defer brokenSrv.Close()

	store, root := buildStore(t, map[string]string{
		"docs/setup.md": strings.Join([]string{
			"---",
			"title: Setup",
			"owner: alice",
			"status: verified",
			"reviewed: 2030-01-01",
			"next-review: 2040-01-01",
			"---",
			"",
			"Old guide at " + brokenSrv.URL + "/guide — update this link soon please.",
		}, "\n"),
	})

	enabled := true
	cfg := config.ExternalLinkCheckConfig{
		Check:         &enabled,
		Timeout:       2 * time.Second,
		CacheTTL:      time.Hour,
		MaxConcurrent: 2,
		RequestDelay:  0,
		Background:    false,
	}
	checker := newExternalLinkChecker(root, cfg)
	checker.client = brokenSrv.Client()

	sc := New(root, store, nil, 90, WithExternalLinkChecker(checker))
	res, err := sc.Scan(context.Background())
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if len(res.ExternalLinks) != 1 {
		t.Fatalf("expected 1 external link finding, got %+v", res.ExternalLinks)
	}
	if res.ExternalLinks[0].Status != http.StatusGone {
		t.Fatalf("expected 410, got %d", res.ExternalLinks[0].Status)
	}
}
