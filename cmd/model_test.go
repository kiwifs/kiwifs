package cmd

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDownloadFile(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("payload"))
	}))
	defer srv.Close()

	dest := filepath.Join(t.TempDir(), "model.onnx")
	if err := downloadFile(srv.Client(), srv.URL, dest); err != nil {
		t.Fatalf("downloadFile: %v", err)
	}
	data, err := os.ReadFile(dest)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "payload" {
		t.Fatalf("data = %q, want payload", data)
	}
}

func TestRunModelDownloadUnknownModel(t *testing.T) {
	err := runModelDownload(modelDownloadCmd, []string{"not-a-model"})
	if err == nil || !strings.Contains(err.Error(), "unknown model") {
		t.Fatalf("err = %v, want unknown model error", err)
	}
}
