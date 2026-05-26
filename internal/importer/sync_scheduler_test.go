package importer

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/kiwifs/kiwifs/internal/events"
	"github.com/kiwifs/kiwifs/internal/pipeline"
	"github.com/kiwifs/kiwifs/internal/search"
	"github.com/kiwifs/kiwifs/internal/storage"
	"github.com/kiwifs/kiwifs/internal/versioning"
)

func TestSyncScheduler_IsDue_EmptyNextSync(t *testing.T) {
	store := newTestStore(t)
	conn := &ConnectionMeta{From: "pg", Name: "a", Prefix: "a/", SyncEnabled: true}
	store.Save(conn)

	sched := NewSyncScheduler(store, nil, nil)
	if !sched.isDue(conn, time.Now()) {
		t.Fatal("connection with empty NextSync should be due")
	}
}

func TestSyncScheduler_IsDue_PastNextSync(t *testing.T) {
	store := newTestStore(t)
	past := time.Now().Add(-1 * time.Hour).UTC().Format(time.RFC3339)
	conn := &ConnectionMeta{From: "pg", Name: "a", Prefix: "a/", SyncEnabled: true, NextSync: past}
	store.Save(conn)

	sched := NewSyncScheduler(store, nil, nil)
	if !sched.isDue(conn, time.Now()) {
		t.Fatal("connection with past NextSync should be due")
	}
}

func TestSyncScheduler_IsDue_FutureNextSync(t *testing.T) {
	store := newTestStore(t)
	future := time.Now().Add(1 * time.Hour).UTC().Format(time.RFC3339)
	conn := &ConnectionMeta{From: "pg", Name: "a", Prefix: "a/", SyncEnabled: true, NextSync: future}
	store.Save(conn)

	sched := NewSyncScheduler(store, nil, nil)
	if sched.isDue(conn, time.Now()) {
		t.Fatal("connection with future NextSync should not be due")
	}
}

func TestSyncScheduler_SkipsDisabledConnections(t *testing.T) {
	store := newTestStore(t)
	store.Save(&ConnectionMeta{From: "pg", Name: "disabled", Prefix: "d/", SyncEnabled: false})

	var called bool
	buildSrc := func(conn *ConnectionMeta) (Source, error) {
		called = true
		return nil, nil
	}

	pipe := testSyncPipeline(t)
	sched := NewSyncScheduler(store, pipe, buildSrc)
	sched.checkAndRunDueSyncs(context.Background())
	time.Sleep(50 * time.Millisecond)

	if called {
		t.Fatal("buildSrc should not be called for disabled connections")
	}
}

func TestSyncScheduler_SkipsRunningConnections(t *testing.T) {
	store := newTestStore(t)
	conn := &ConnectionMeta{From: "pg", Name: "busy", Prefix: "b/", SyncEnabled: true, SyncStatus: "running"}
	store.Save(conn)

	var called bool
	buildSrc := func(conn *ConnectionMeta) (Source, error) {
		called = true
		return nil, nil
	}

	pipe := testSyncPipeline(t)
	sched := NewSyncScheduler(store, pipe, buildSrc)
	sched.checkAndRunDueSyncs(context.Background())
	time.Sleep(50 * time.Millisecond)

	if called {
		t.Fatal("buildSrc should not be called for running connections")
	}
}

func TestSyncScheduler_RunSync_SourceBuildError(t *testing.T) {
	store := newTestStore(t)
	conn := &ConnectionMeta{From: "pg", Name: "broken", Prefix: "br/", SyncEnabled: true}
	store.Save(conn)

	buildSrc := func(c *ConnectionMeta) (Source, error) {
		return nil, fmt.Errorf("connection refused")
	}

	pipe := testSyncPipeline(t)
	sched := NewSyncScheduler(store, pipe, buildSrc)
	sched.runSync(context.Background(), conn)

	got, _ := store.Get(conn.ID)
	if got.SyncStatus != "error" {
		t.Fatalf("SyncStatus = %q, want error", got.SyncStatus)
	}
	if got.SyncError == "" {
		t.Fatal("expected SyncError to be set")
	}
	if got.NextSync == "" {
		t.Fatal("expected NextSync to be scheduled after failure")
	}
}

func TestSyncScheduler_RunSync_Success(t *testing.T) {
	store := newTestStore(t)
	conn := &ConnectionMeta{From: "pg", Name: "ok", Prefix: "ok/", SyncEnabled: true, SyncInterval: "5m"}
	store.Save(conn)

	buildSrc := func(c *ConnectionMeta) (Source, error) {
		return &mockSource{records: []Record{
			{PrimaryKey: "1", Fields: map[string]any{"title": "Test"}},
		}}, nil
	}

	pipe := testSyncPipeline(t)
	sched := NewSyncScheduler(store, pipe, buildSrc)
	sched.runSync(context.Background(), conn)

	got, _ := store.Get(conn.ID)
	if got.SyncStatus != "idle" {
		t.Fatalf("SyncStatus = %q, want idle", got.SyncStatus)
	}
	if got.LastRun == "" {
		t.Fatal("expected LastRun to be set")
	}
	if got.LastStats == nil || got.LastStats.Imported != 1 {
		t.Fatalf("LastStats = %+v", got.LastStats)
	}
	if got.NextSync == "" {
		t.Fatal("expected NextSync to be set")
	}
}

func TestSyncScheduler_ScheduleNext(t *testing.T) {
	store := newTestStore(t)
	conn := &ConnectionMeta{From: "pg", Name: "sn", Prefix: "sn/", SyncInterval: "2h"}
	store.Save(conn)

	pipe := testSyncPipeline(t)
	sched := NewSyncScheduler(store, pipe, nil)
	sched.scheduleNext(conn)

	got, _ := store.Get(conn.ID)
	next, err := time.Parse(time.RFC3339, got.NextSync)
	if err != nil {
		t.Fatalf("parse NextSync: %v", err)
	}
	expectedMin := time.Now().Add(1*time.Hour + 50*time.Minute)
	if next.Before(expectedMin) {
		t.Fatalf("NextSync too soon: %v (expected ~2h from now)", next)
	}
}

func TestParseSyncInterval(t *testing.T) {
	tests := []struct {
		input string
		want  time.Duration
	}{
		{"5m", 5 * time.Minute},
		{"1h", 1 * time.Hour},
		{"24h", 24 * time.Hour},
		{"", 1 * time.Hour},
		{"invalid", 1 * time.Hour},
	}
	for _, tt := range tests {
		got := parseSyncInterval(tt.input)
		if got != tt.want {
			t.Errorf("parseSyncInterval(%q) = %v, want %v", tt.input, got, tt.want)
		}
	}
}

// --- helpers ---

type mockSource struct {
	records []Record
	closed  bool
}

func (m *mockSource) Name() string { return "mock" }

func (m *mockSource) Stream(ctx context.Context) (<-chan Record, <-chan error) {
	ch := make(chan Record, len(m.records))
	errs := make(chan error)
	for _, r := range m.records {
		ch <- r
	}
	close(ch)
	close(errs)
	return ch, errs
}

func (m *mockSource) Close() error {
	m.closed = true
	return nil
}

func testSyncPipeline(t *testing.T) *pipeline.Pipeline {
	t.Helper()
	dir := t.TempDir()
	store, err := storage.NewLocal(dir)
	if err != nil {
		t.Fatal(err)
	}
	ver := versioning.NewNoop()
	searcher := search.NewGrep(dir)
	hub := events.NewHub()
	return pipeline.New(store, ver, searcher, nil, hub, nil, "")
}
