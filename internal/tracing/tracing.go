package tracing

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"sync"
	"time"
)

type EventKind string

const (
	KindRead        EventKind = "read"
	KindSearch      EventKind = "search"
	KindWrite       EventKind = "write"
	KindDelete      EventKind = "delete"
	KindLinkResolve EventKind = "link_resolve"
	KindVersions    EventKind = "versions"
	KindDQL         EventKind = "dql_query"
)

type Event struct {
	Kind     EventKind `json:"kind"`
	Path     string    `json:"path,omitempty"`
	Query    string    `json:"query,omitempty"`
	ETag     string    `json:"etag,omitempty"`
	FromPath string    `json:"from_path,omitempty"`
	ToPath   string    `json:"to_path,omitempty"`
	Duration string    `json:"duration,omitempty"`
	HitCount int       `json:"hit_count,omitempty"`
	Detail   string    `json:"detail,omitempty"`
}

type TraceRecord struct {
	ID        string    `json:"id"`
	Source    string    `json:"source"`
	Operation string   `json:"operation"`
	Query     string    `json:"query,omitempty"`
	StartedAt time.Time `json:"started_at"`
	Duration  string    `json:"duration"`
	Events    []Event   `json:"events"`
	Error     string    `json:"error,omitempty"`
}

type trace struct {
	mu        sync.Mutex
	id        string
	source    string
	operation string
	query     string
	startedAt time.Time
	events    []Event
}

type contextKey struct{}

func Start(ctx context.Context, source, operation string) context.Context {
	t := &trace{
		id:        generateID(),
		source:    source,
		operation: operation,
		startedAt: time.Now(),
	}
	return context.WithValue(ctx, contextKey{}, t)
}

func SetQuery(ctx context.Context, query string) {
	t := fromContext(ctx)
	if t == nil {
		return
	}
	t.mu.Lock()
	t.query = query
	t.mu.Unlock()
}

func Record(ctx context.Context, e Event) {
	t := fromContext(ctx)
	if t == nil {
		return
	}
	t.mu.Lock()
	t.events = append(t.events, e)
	t.mu.Unlock()
}

func Finish(ctx context.Context, err error) *TraceRecord {
	t := fromContext(ctx)
	if t == nil {
		return nil
	}
	t.mu.Lock()
	defer t.mu.Unlock()

	rec := &TraceRecord{
		ID:        t.id,
		Source:    t.source,
		Operation: t.operation,
		Query:     t.query,
		StartedAt: t.startedAt,
		Duration:  time.Since(t.startedAt).Round(time.Microsecond).String(),
		Events:    t.events,
	}
	if err != nil {
		rec.Error = err.Error()
	}
	if rec.Events == nil {
		rec.Events = []Event{}
	}
	return rec
}

func fromContext(ctx context.Context) *trace {
	t, _ := ctx.Value(contextKey{}).(*trace)
	return t
}

func generateID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

// Emitter receives completed trace records.
type Emitter interface {
	Emit(TraceRecord)
}

type NoopEmitter struct{}

func (NoopEmitter) Emit(TraceRecord) {}

type StderrEmitter struct {
	logger *log.Logger
}

func NewStderrEmitter() *StderrEmitter {
	return &StderrEmitter{logger: log.New(os.Stderr, "", 0)}
}

func (e *StderrEmitter) Emit(rec TraceRecord) {
	b, err := json.Marshal(rec)
	if err != nil {
		return
	}
	e.logger.Println(string(b))
}

type FileEmitter struct {
	mu sync.Mutex
	w  io.WriteCloser
}

func NewFileEmitter(path string) (*FileEmitter, error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return nil, fmt.Errorf("open trace file: %w", err)
	}
	return &FileEmitter{w: f}, nil
}

func (e *FileEmitter) Emit(rec TraceRecord) {
	b, err := json.Marshal(rec)
	if err != nil {
		return
	}
	b = append(b, '\n')
	e.mu.Lock()
	defer e.mu.Unlock()
	_, _ = e.w.Write(b)
}

func (e *FileEmitter) Close() error {
	return e.w.Close()
}

// NewEmitter creates an Emitter based on the enabled/output/file settings.
// Returns NoopEmitter when tracing is disabled.
func NewEmitter(enabled bool, output, file string) Emitter {
	if !enabled {
		return NoopEmitter{}
	}
	switch output {
	case "file":
		if file == "" {
			log.Printf("tracing: output=file but no file path configured, falling back to stderr")
			return NewStderrEmitter()
		}
		em, err := NewFileEmitter(file)
		if err != nil {
			log.Printf("tracing: failed to open file %s (%v), falling back to stderr", file, err)
			return NewStderrEmitter()
		}
		return em
	default:
		return NewStderrEmitter()
	}
}
