package api

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/labstack/echo/v4"
)

// AuditEntry is one line in the JSONL audit file.
type AuditEntry struct {
	Timestamp  string `json:"ts"`
	Method     string `json:"method"`
	Path       string `json:"path"`
	Space      string `json:"space,omitempty"`
	Actor      string `json:"actor"`
	TokenHash  string `json:"token_hash,omitempty"` // first 8 chars of SHA256
	IP         string `json:"ip"`
	StatusCode int    `json:"status"`
	DurationMs int64  `json:"duration_ms"`
}

// AuditLogger writes append-only JSONL files to .kiwi/audit/YYYY-MM-DD.jsonl.
type AuditLogger struct {
	root string
	mu   sync.Mutex
	file *os.File
	day  string
}

// NewAuditLogger creates a new audit logger writing to root/.kiwi/audit/.
func NewAuditLogger(root string) (*AuditLogger, error) {
	dir := filepath.Join(root, ".kiwi", "audit")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("audit: mkdir: %w", err)
	}
	return &AuditLogger{root: root}, nil
}

// Log writes a single audit entry. Thread-safe.
func (a *AuditLogger) Log(entry AuditEntry) {
	data, err := json.Marshal(entry)
	if err != nil {
		log.Printf("audit: marshal: %v", err)
		return
	}
	data = append(data, '\n')

	day := time.Now().UTC().Format("2006-01-02")
	a.mu.Lock()
	defer a.mu.Unlock()

	if a.day != day || a.file == nil {
		if a.file != nil {
			a.file.Close()
		}
		path := filepath.Join(a.root, ".kiwi", "audit", day+".jsonl")
		f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
		if err != nil {
			log.Printf("audit: open %s: %v", path, err)
			return
		}
		a.file = f
		a.day = day
	}
	a.file.Write(data)
}

// Close flushes and closes the current file.
func (a *AuditLogger) Close() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.file != nil {
		a.file.Close()
		a.file = nil
	}
}

// ReadEntries reads audit entries since a given timestamp (for the API).
func (a *AuditLogger) ReadEntries(since time.Time, limit int) ([]AuditEntry, error) {
	dir := filepath.Join(a.root, ".kiwi", "audit")
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	sinceDay := since.Format("2006-01-02")
	var result []AuditEntry

	for _, e := range entries {
		name := e.Name()
		if len(name) < 10 {
			continue
		}
		day := name[:10]
		if day < sinceDay {
			continue
		}

		data, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			continue
		}
		// Parse JSONL
		for len(data) > 0 {
			idx := 0
			for idx < len(data) && data[idx] != '\n' {
				idx++
			}
			line := data[:idx]
			if idx < len(data) {
				data = data[idx+1:]
			} else {
				data = nil
			}
			if len(line) == 0 {
				continue
			}
			var entry AuditEntry
			if err := json.Unmarshal(line, &entry); err != nil {
				continue
			}
			ts, _ := time.Parse(time.RFC3339Nano, entry.Timestamp)
			if ts.Before(since) {
				continue
			}
			result = append(result, entry)
			if limit > 0 && len(result) >= limit {
				return result, nil
			}
		}
	}
	return result, nil
}

// auditMiddleware returns an Echo middleware that logs every API request
// to the AuditLogger after the response is sent.
func auditMiddleware(logger *AuditLogger) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			req := c.Request()
			p := req.URL.Path
			if p == "/health" || p == "/healthz" || p == "/readyz" || p == "/metrics" {
				return next(c)
			}

			start := time.Now()
			err := next(c)
			duration := time.Since(start)

			status := c.Response().Status
			if err != nil {
				if he, ok := err.(*echo.HTTPError); ok {
					status = he.Code
				}
			}

			// Extract actor and token hash
			actor := req.Header.Get("X-Actor")
			if actor == "" {
				actor = "anonymous"
			}
			tokenHash := ""
			if auth := req.Header.Get("Authorization"); len(auth) > 7 {
				raw := auth[7:] // strip "Bearer "
				h := sha256.Sum256([]byte(raw))
				tokenHash = fmt.Sprintf("%x", h[:4])
			}

			space := req.Header.Get("X-Space")

			logger.Log(AuditEntry{
				Timestamp:  start.UTC().Format(time.RFC3339Nano),
				Method:     req.Method,
				Path:       p,
				Space:      space,
				Actor:      actor,
				TokenHash:  tokenHash,
				IP:         c.RealIP(),
				StatusCode: status,
				DurationMs: duration.Milliseconds(),
			})
			return err
		}
	}
}

// AuditEndpoint handles GET /api/kiwi/audit?since=<RFC3339>&limit=100.
func (h *Handlers) AuditEndpoint(c echo.Context) error {
	if h.auditLogger == nil {
		return echo.NewHTTPError(http.StatusNotImplemented, "audit logging not enabled")
	}

	sinceStr := c.QueryParam("since")
	since := time.Now().Add(-24 * time.Hour) // default: last 24h
	if sinceStr != "" {
		t, err := time.Parse(time.RFC3339, sinceStr)
		if err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "invalid since timestamp — use RFC3339")
		}
		since = t
	}

	limitStr := c.QueryParam("limit")
	limit := 100
	if limitStr != "" {
		fmt.Sscanf(limitStr, "%d", &limit)
		if limit <= 0 || limit > 10000 {
			limit = 100
		}
	}

	entries, err := h.auditLogger.ReadEntries(since, limit)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	if entries == nil {
		entries = []AuditEntry{}
	}
	return c.JSON(http.StatusOK, entries)
}
