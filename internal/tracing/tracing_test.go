package tracing

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStartRecordFinish(t *testing.T) {
	ctx := Start(context.Background(), "mcp", "kiwi_read")

	Record(ctx, Event{Kind: KindRead, Path: "concepts/auth.md", ETag: "abc123"})
	Record(ctx, Event{Kind: KindLinkResolve, Detail: "wiki-links resolved"})

	rec := Finish(ctx, nil)
	if rec == nil {
		t.Fatal("expected non-nil TraceRecord")
	}
	if rec.Source != "mcp" {
		t.Errorf("source = %q, want mcp", rec.Source)
	}
	if rec.Operation != "kiwi_read" {
		t.Errorf("operation = %q, want kiwi_read", rec.Operation)
	}
	if rec.ID == "" {
		t.Error("expected non-empty ID")
	}
	if rec.Duration == "" {
		t.Error("expected non-empty Duration")
	}
	if rec.Error != "" {
		t.Errorf("unexpected error: %s", rec.Error)
	}
	if len(rec.Events) != 2 {
		t.Fatalf("events len = %d, want 2", len(rec.Events))
	}
	if rec.Events[0].Kind != KindRead {
		t.Errorf("events[0].kind = %q, want read", rec.Events[0].Kind)
	}
	if rec.Events[0].Path != "concepts/auth.md" {
		t.Errorf("events[0].path = %q, want concepts/auth.md", rec.Events[0].Path)
	}
	if rec.Events[1].Kind != KindLinkResolve {
		t.Errorf("events[1].kind = %q, want link_resolve", rec.Events[1].Kind)
	}
}

func TestSetQuery(t *testing.T) {
	ctx := Start(context.Background(), "api", "GET /api/kiwi/search")
	SetQuery(ctx, "auth bug")

	rec := Finish(ctx, nil)
	if rec.Query != "auth bug" {
		t.Errorf("query = %q, want %q", rec.Query, "auth bug")
	}
}

func TestFinishWithError(t *testing.T) {
	ctx := Start(context.Background(), "mcp", "kiwi_write")
	rec := Finish(ctx, errors.New("permission denied"))

	if rec.Error != "permission denied" {
		t.Errorf("error = %q, want %q", rec.Error, "permission denied")
	}
}

func TestFinishEmptyEvents(t *testing.T) {
	ctx := Start(context.Background(), "mcp", "kiwi_tree")
	rec := Finish(ctx, nil)

	if rec.Events == nil {
		t.Error("events should be non-nil empty slice, not nil")
	}
	if len(rec.Events) != 0 {
		t.Errorf("events len = %d, want 0", len(rec.Events))
	}
}

func TestNoopWhenNotStarted(t *testing.T) {
	ctx := context.Background()

	// Should not panic.
	Record(ctx, Event{Kind: KindRead, Path: "test.md"})
	SetQuery(ctx, "test")
	rec := Finish(ctx, nil)

	if rec != nil {
		t.Error("expected nil TraceRecord from un-traced context")
	}
}

func TestNoopEmitter(t *testing.T) {
	em := NoopEmitter{}
	em.Emit(TraceRecord{ID: "test"})
}

func TestStderrEmitter(t *testing.T) {
	var buf bytes.Buffer
	em := &StderrEmitter{logger: log.New(&buf, "", 0)}

	rec := TraceRecord{
		ID:        "test-123",
		Source:    "mcp",
		Operation: "kiwi_search",
		Events:    []Event{{Kind: KindSearch, Query: "auth", HitCount: 5}},
	}
	em.Emit(rec)

	line := buf.String()
	if !strings.Contains(line, `"id":"test-123"`) {
		t.Errorf("stderr output missing id: %s", line)
	}
	if !strings.Contains(line, `"source":"mcp"`) {
		t.Errorf("stderr output missing source: %s", line)
	}

	var parsed TraceRecord
	trimmed := strings.TrimSpace(line)
	if err := json.Unmarshal([]byte(trimmed), &parsed); err != nil {
		t.Fatalf("stderr output is not valid JSON: %v\nline: %s", err, trimmed)
	}
	if parsed.ID != "test-123" {
		t.Errorf("parsed ID = %q, want test-123", parsed.ID)
	}
}

func TestFileEmitter(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "traces.jsonl")

	em, err := NewFileEmitter(path)
	if err != nil {
		t.Fatalf("NewFileEmitter: %v", err)
	}

	em.Emit(TraceRecord{ID: "a", Source: "mcp", Operation: "kiwi_read", Events: []Event{}})
	em.Emit(TraceRecord{ID: "b", Source: "api", Operation: "GET /search", Events: []Event{}})

	if err := em.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}

	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != 2 {
		t.Fatalf("expected 2 lines, got %d", len(lines))
	}

	for i, line := range lines {
		var rec TraceRecord
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			t.Errorf("line %d is not valid JSON: %v", i, err)
		}
	}
}

func TestNewEmitterDisabled(t *testing.T) {
	em := NewEmitter(false, "", "")
	if _, ok := em.(NoopEmitter); !ok {
		t.Errorf("expected NoopEmitter when disabled, got %T", em)
	}
}

func TestNewEmitterStderr(t *testing.T) {
	em := NewEmitter(true, "stderr", "")
	if _, ok := em.(*StderrEmitter); !ok {
		t.Errorf("expected *StderrEmitter, got %T", em)
	}
}

func TestNewEmitterFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.jsonl")

	em := NewEmitter(true, "file", path)
	fe, ok := em.(*FileEmitter)
	if !ok {
		t.Fatalf("expected *FileEmitter, got %T", em)
	}
	fe.Close()
}
