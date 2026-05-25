package cmd

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	"github.com/kiwifs/kiwifs/internal/webhooks"
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
