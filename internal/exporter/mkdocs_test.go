package exporter

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestExportMkDocsSampleWorkspace(t *testing.T) {
	store := testStore(t)
	writeFile(t, store, "pages/intro.md", `---
title: Introduction
order: 1
type: page
published: true
---
See [[guide/setup]] for setup instructions.
`)
	writeFile(t, store, "pages/guide/setup.md", `---
title: Setup
nav_order: 1
---
# Setup instructions

Configure your environment.
`)
	writeFile(t, store, "pages/draft.md", `---
title: Draft
published: false
---
Hidden draft content.
`)

	outDir := t.TempDir()
	count, err := ExportMkDocs(context.Background(), store, MkDocsOptions{
		OutputDir:  outDir,
		PathPrefix: "pages",
		SiteName:   "Test Wiki",
		SiteURL:    "https://wiki.example.com",
	})
	if err != nil {
		t.Fatalf("ExportMkDocs: %v", err)
	}
	if count != 2 {
		t.Fatalf("count=%d, want 2 (intro + setup)", count)
	}

	mkdocsPath := filepath.Join(outDir, "mkdocs.yml")
	configData, err := os.ReadFile(mkdocsPath)
	if err != nil {
		t.Fatalf("read mkdocs.yml: %v", err)
	}

	var config map[string]any
	if err := yaml.Unmarshal(configData, &config); err != nil {
		t.Fatalf("unmarshal mkdocs.yml: %v", err)
	}
	if config["site_name"] != "Test Wiki" {
		t.Errorf("site_name = %v, want Test Wiki", config["site_name"])
	}
	if config["site_url"] != "https://wiki.example.com" {
		t.Errorf("site_url = %v", config["site_url"])
	}

	nav, ok := config["nav"].([]any)
	if !ok || len(nav) != 2 {
		t.Fatalf("nav = %#v, want 2 top-level entries", config["nav"])
	}

	introPath := filepath.Join(outDir, "docs", "intro.md")
	intro, err := os.ReadFile(introPath)
	if err != nil {
		t.Fatalf("read intro.md: %v", err)
	}
	introStr := string(intro)
	if strings.Contains(introStr, "type: page") {
		t.Error("kiwifs frontmatter fields should be stripped")
	}
	if !strings.Contains(introStr, "title: Introduction") {
		t.Error("title frontmatter should be kept")
	}
	if !strings.Contains(introStr, "[guide/setup](guide/setup.md)") {
		t.Errorf("wiki link not rewritten: %s", introStr)
	}

	if _, err := os.Stat(filepath.Join(outDir, "docs", "draft.md")); err == nil {
		t.Error("unpublished page should be excluded")
	}

	setupPath := filepath.Join(outDir, "docs", "guide", "setup.md")
	if _, err := os.Stat(setupPath); err != nil {
		t.Fatalf("setup.md missing: %v", err)
	}
}

func TestRewriteMkDocsWikiLinks(t *testing.T) {
	index := map[string]string{
		"auth":                    "guide/auth.md",
		"guide/auth.md":           "guide/auth.md",
		"concepts/authentication": "guide/auth.md",
	}

	tests := []struct {
		name      string
		content   string
		sourceRel string
		want      string
	}{
		{
			name:      "simple wiki link",
			content:   "See [[auth]] for details.",
			sourceRel: "intro.md",
			want:      "See [auth](guide/auth.md) for details.",
		},
		{
			name:      "wiki link with label",
			content:   "Read [[auth|Authentication]] now.",
			sourceRel: "guide/setup.md",
			want:      "Read [Authentication](auth.md) now.",
		},
		{
			name:      "unresolved link kept",
			content:   "Missing [[ghost]] page.",
			sourceRel: "intro.md",
			want:      "Missing [[ghost]] page.",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := rewriteMkDocsWikiLinks(tt.content, tt.sourceRel, index)
			if got != tt.want {
				t.Errorf("rewriteMkDocsWikiLinks() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestBuildMkDocsNav(t *testing.T) {
	pages := []mkdocsPage{
		{relPath: "intro.md", title: "Introduction", order: 1},
		{relPath: "guide/setup.md", title: "Setup", order: 1},
		{relPath: "guide/usage.md", title: "Usage", order: 2},
		{relPath: "reference.md", title: "Reference", order: 3},
	}

	nav := buildMkDocsNav(pages)
	if len(nav) != 3 {
		t.Fatalf("expected 3 top-level nav entries, got %d", len(nav))
	}
	if nav[0].title != "Introduction" || nav[0].path != "intro.md" {
		t.Errorf("first entry = %+v, want Introduction/intro.md", nav[0])
	}
	if nav[1].title != "Guide" || len(nav[1].children) != 2 {
		t.Errorf("guide category = %+v, want Guide with 2 children", nav[1])
	}
	if nav[2].title != "Reference" {
		t.Errorf("third entry = %+v, want Reference", nav[2])
	}
}

func TestExportMkDocsRequiresOutputDir(t *testing.T) {
	store := testStore(t)
	_, err := ExportMkDocs(context.Background(), store, MkDocsOptions{})
	if err == nil {
		t.Fatal("expected error for missing output directory")
	}
}
