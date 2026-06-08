package exporter

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kiwifs/kiwifs/internal/storage"
	"gopkg.in/yaml.v3"
)

func TestConvertWikiLinksForMkDocs(t *testing.T) {
	idx := buildMkdocsWikiIndex([]string{
		"guides/getting-started.md",
		"pages/world.md",
	})

	tests := []struct {
		name   string
		input  string
		source string
		want   string
	}{
		{
			name:   "aliased same directory",
			input:  "See [[getting-started|Start here]] for details.",
			source: "guides/index.md",
			want:   "See [Start here](getting-started.md) for details.",
		},
		{
			name:   "bare target same directory",
			input:  "See [[world]] for more.",
			source: "pages/hello.md",
			want:   "See [world](world.md) for more.",
		},
		{
			name:   "fuzzy stem match",
			input:  "Read [[getting-started]] next.",
			source: "guides/index.md",
			want:   "Read [getting-started](getting-started.md) next.",
		},
		{
			name:   "unresolved left intact",
			input:  "See [[missing-page]] later.",
			source: "pages/hello.md",
			want:   "See [[missing-page]] later.",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := convertWikiLinksForMkDocs(tc.input, tc.source, idx)
			if got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestExportMkDocsSampleWorkspace(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	store, err := storage.NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}

	if err := store.Write(ctx, "pages/hello.md", []byte(`---
title: Hello
nav_order: 1
memory_kind: semantic
---
# Hello

See [[world]] and [[world|the world page]].
`)); err != nil {
		t.Fatal(err)
	}
	if err := store.Write(ctx, "pages/world.md", []byte(`---
title: World
nav_order: 2
---
# World

Back to [[hello]].
`)); err != nil {
		t.Fatal(err)
	}
	if err := store.Write(ctx, "guides/intro.md", []byte(`---
title: Intro Guide
---
# Intro

See [[hello]] from another folder.
`)); err != nil {
		t.Fatal(err)
	}

	outDir := filepath.Join(t.TempDir(), "site")
	count, err := ExportMkDocs(ctx, store, MkDocsOptions{
		OutputDir: outDir,
		SiteName:  "Test KB",
		SiteURL:   "https://example.com/docs/",
		RepoURL:   "https://github.com/example/kb",
	})
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	if count != 3 {
		t.Fatalf("count=%d, want 3", count)
	}

	mkdocsPath := filepath.Join(outDir, "mkdocs.yml")
	cfgBytes, err := os.ReadFile(mkdocsPath)
	if err != nil {
		t.Fatalf("mkdocs.yml: %v", err)
	}
	var cfg map[string]any
	if err := yaml.Unmarshal(cfgBytes, &cfg); err != nil {
		t.Fatalf("parse mkdocs.yml: %v", err)
	}
	if cfg["site_name"] != "Test KB" {
		t.Fatalf("site_name=%v, want Test KB", cfg["site_name"])
	}
	if cfg["site_url"] != "https://example.com/docs/" {
		t.Fatalf("site_url=%v", cfg["site_url"])
	}
	if cfg["repo_url"] != "https://github.com/example/kb" {
		t.Fatalf("repo_url=%v", cfg["repo_url"])
	}
	nav, ok := cfg["nav"].([]any)
	if !ok || len(nav) == 0 {
		t.Fatalf("nav missing or empty: %v", cfg["nav"])
	}

	helloPath := filepath.Join(outDir, "docs", "pages", "hello.md")
	body, err := os.ReadFile(helloPath)
	if err != nil {
		t.Fatalf("hello.md: %v", err)
	}
	hello := string(body)
	if !strings.Contains(hello, "[world](world.md)") {
		t.Fatalf("wiki link not converted: %q", hello)
	}
	if !strings.Contains(hello, "[the world page](world.md)") {
		t.Fatalf("aliased wiki link not converted: %q", hello)
	}
	if strings.Contains(hello, "memory_kind") {
		t.Fatalf("kiwi frontmatter should be stripped: %q", hello)
	}

	introPath := filepath.Join(outDir, "docs", "guides", "intro.md")
	intro, err := os.ReadFile(introPath)
	if err != nil {
		t.Fatalf("intro.md: %v", err)
	}
	if !strings.Contains(string(intro), "../pages/hello.md") {
		t.Fatalf("cross-folder link should be relative: %q", string(intro))
	}
}

func TestMkdocsRelativeLink(t *testing.T) {
	got := mkdocsRelativeLink("guides/intro.md", "pages/hello.md")
	if got != "../pages/hello.md" {
		t.Fatalf("got %q, want ../pages/hello.md", got)
	}
}
