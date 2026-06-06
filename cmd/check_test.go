package cmd

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/kiwifs/kiwifs/internal/janitor"
)

func TestRunKnowledgeScan_DetectsBrokenLinks(t *testing.T) {
	root := t.TempDir()
	content := `---
title: Broken
owner: alice
status: verified
reviewed: 2030-01-01
next-review: 2040-01-01
---

This page links to [[missing-page]] and has enough text to avoid empty-page.
`
	if err := os.WriteFile(filepath.Join(root, "broken.md"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}

	args := []string{"--root", root}
	checkCmd.SetContext(context.Background())
	checkCmd.SetArgs(args)
	if err := checkCmd.ParseFlags(args); err != nil {
		t.Fatalf("parse flags: %v", err)
	}

	result, _, _, _, err := runKnowledgeScan(checkCmd)
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	if !result.HasErrors() {
		t.Fatalf("expected broken link error, got %+v", result.Issues)
	}
}

func TestScanResult_HasWarnings(t *testing.T) {
	r := &janitor.ScanResult{Issues: []janitor.Issue{{Severity: "warning"}}}
	if !r.HasWarnings() {
		t.Fatal("expected warnings")
	}
}
