package cmd

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/kiwifs/kiwifs/internal/webhooks"
	"gopkg.in/yaml.v3"
)

func TestExportFiresWebhookAfterDataExport(t *testing.T) {
	root := t.TempDir()
	pagePath := filepath.Join(root, "pages", "hello.md")
	if err := os.MkdirAll(filepath.Dir(pagePath), 0755); err != nil {
		t.Fatal(err)
	}
	content := `---
title: Hello
---
# Hello
`
	if err := os.WriteFile(pagePath, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	secret := "integration-export-secret"
	var postCount atomic.Int32
	var got webhooks.ExportNotification

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		postCount.Add(1)
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read body: %v", err)
		}
		if err := json.Unmarshal(body, &got); err != nil {
			t.Errorf("unmarshal: %v", err)
		}
		if r.Header.Get("webhook-signature") == "" {
			t.Error("missing webhook-signature")
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer ts.Close()

	outPath := filepath.Join(root, "out.jsonl")
	args := []string{
		"--root", root,
		"--format", "jsonl",
		"--output", outPath,
		"--webhook", ts.URL,
		"--webhook-secret", secret,
	}
	cmd := exportCmd
	cmd.SetContext(context.Background())
	cmd.SetArgs(args)
	if err := cmd.ParseFlags(args); err != nil {
		t.Fatalf("parse flags: %v", err)
	}
	if err := runDataExport(cmd); err != nil {
		t.Fatalf("export: %v", err)
	}

	if postCount.Load() != 1 {
		t.Fatalf("webhook POST count = %d, want 1", postCount.Load())
	}
	if got.Type != webhooks.ExportCompletedType {
		t.Errorf("type = %q, want %q", got.Type, webhooks.ExportCompletedType)
	}
	if got.Format != "jsonl" {
		t.Errorf("format = %q, want jsonl", got.Format)
	}
	if got.FileCount != 1 {
		t.Errorf("file_count = %d, want 1", got.FileCount)
	}
	if got.Output != outPath {
		t.Errorf("output = %q, want %q", got.Output, outPath)
	}
	if got.Timestamp == "" {
		t.Error("timestamp is empty")
	}

	if _, err := os.Stat(outPath); err != nil {
		t.Fatalf("export output missing: %v", err)
	}
}

func TestRunMkDocsExport(t *testing.T) {
	root := t.TempDir()
	pagePath := filepath.Join(root, "pages", "hello.md")
	if err := os.MkdirAll(filepath.Dir(pagePath), 0o755); err != nil {
		t.Fatal(err)
	}
	content := `---
title: Hello
nav_order: 1
memory_kind: semantic
---
# Hello

See [[world]] for more.
`
	if err := os.WriteFile(pagePath, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	worldPath := filepath.Join(root, "pages", "world.md")
	if err := os.WriteFile(worldPath, []byte(`---
title: World
---
# World
`), 0o644); err != nil {
		t.Fatal(err)
	}

	outDir := filepath.Join(root, "site")
	args := []string{
		"--root", root,
		"--format", "mkdocs",
		"--output", outDir,
		"--site-name", "CLI Test KB",
		"--site-url", "https://example.com/docs/",
	}
	cmd := exportCmd
	cmd.SetContext(context.Background())
	cmd.SetArgs(args)
	if err := cmd.ParseFlags(args); err != nil {
		t.Fatalf("parse flags: %v", err)
	}
	if err := runMkDocsExport(cmd); err != nil {
		t.Fatalf("mkdocs export: %v", err)
	}

	cfgBytes, err := os.ReadFile(filepath.Join(outDir, "mkdocs.yml"))
	if err != nil {
		t.Fatalf("mkdocs.yml: %v", err)
	}
	var cfg map[string]any
	if err := yaml.Unmarshal(cfgBytes, &cfg); err != nil {
		t.Fatalf("parse mkdocs.yml: %v", err)
	}
	if cfg["site_name"] != "CLI Test KB" {
		t.Fatalf("site_name = %v, want CLI Test KB", cfg["site_name"])
	}

	hello, err := os.ReadFile(filepath.Join(outDir, "docs", "pages", "hello.md"))
	if err != nil {
		t.Fatalf("hello.md: %v", err)
	}
	body := string(hello)
	if !strings.Contains(body, "[world](world.md)") {
		t.Fatalf("wiki link not converted: %q", body)
	}
	if strings.Contains(body, "memory_kind") {
		t.Fatalf("kiwi frontmatter should be stripped: %q", body)
	}
}
