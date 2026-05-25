package webhooks

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestPostExportNotification(t *testing.T) {
	secret := "export-test-secret"
	var got ExportNotification
	var gotSignature string

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read body: %v", err)
		}
		if err := json.Unmarshal(body, &got); err != nil {
			t.Errorf("unmarshal: %v", err)
		}
		gotSignature = r.Header.Get("X-Kiwi-Signature-256")
		if gotSignature == "" {
			t.Error("missing X-Kiwi-Signature-256")
		}
		if r.Header.Get("webhook-signature") == "" {
			t.Error("missing webhook-signature")
		}
		want := expectedBodySignature(secret, body)
		if gotSignature != want {
			t.Errorf("signature = %q, want %q", gotSignature, want)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer ts.Close()

	tsTime := time.Date(2026, 5, 25, 12, 0, 0, 0, time.UTC)
	notification := ExportNotification{
		Type:      ExportCompletedType,
		Format:    "jsonl",
		FileCount: 3,
		Timestamp: tsTime.Format(time.RFC3339),
		Output:    "data.jsonl",
	}

	if _, err := Post(context.Background(), ts.URL, secret, notification, nil); err != nil {
		t.Fatalf("Post: %v", err)
	}

	if got.Type != ExportCompletedType {
		t.Errorf("type = %q, want %q", got.Type, ExportCompletedType)
	}
	if got.Format != "jsonl" {
		t.Errorf("format = %q, want jsonl", got.Format)
	}
	if got.FileCount != 3 {
		t.Errorf("file_count = %d, want 3", got.FileCount)
	}
	if got.Timestamp != tsTime.Format(time.RFC3339) {
		t.Errorf("timestamp = %q, want %q", got.Timestamp, tsTime.Format(time.RFC3339))
	}
	if got.Output != "data.jsonl" {
		t.Errorf("output = %q, want data.jsonl", got.Output)
	}
}

func TestPostUnsignedWhenNoSecret(t *testing.T) {
	var gotSignature string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotSignature = r.Header.Get("X-Kiwi-Signature-256")
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	if _, err := Post(context.Background(), ts.URL, "", ExportNotification{
		Type:      ExportCompletedType,
		Format:    "csv",
		FileCount: 1,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}, nil); err != nil {
		t.Fatalf("Post: %v", err)
	}
	if gotSignature != "" {
		t.Errorf("expected no signature header, got %q", gotSignature)
	}
}

func TestPostFailsOnNon2xx(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer ts.Close()

	_, err := Post(context.Background(), ts.URL, "", ExportNotification{
		Type: ExportCompletedType,
	}, nil)
	if err == nil {
		t.Fatal("expected error for 500 response")
	}
}
