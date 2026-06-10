package cmd

import (
	"fmt"
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

func TestRunModelDownloadWritesArtifacts(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "model.onnx"):
			_, _ = w.Write([]byte("onnx-model"))
		case strings.HasSuffix(r.URL.Path, "tokenizer.json"):
			_, _ = w.Write([]byte("{}"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	orig := onnxModelCatalog["all-minilm-l6-v2"]
	t.Cleanup(func() {
		onnxModelCatalog["all-minilm-l6-v2"] = orig
	})
	catalog := orig
	catalog.files = map[string]string{
		"onnx/model.onnx": srv.URL + "/onnx/model.onnx",
		"tokenizer.json":  srv.URL + "/tokenizer.json",
	}
	onnxModelCatalog["all-minilm-l6-v2"] = catalog

	outDir := t.TempDir()
	modelDownloadDir = outDir
	t.Cleanup(func() { modelDownloadDir = "" })

	if err := runModelDownload(modelDownloadCmd, []string{"all-minilm-l6-v2"}); err != nil {
		t.Fatalf("runModelDownload: %v", err)
	}
	for _, rel := range []string{"onnx/model.onnx", "tokenizer.json"} {
		path := filepath.Join(outDir, rel)
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("missing %s: %v", rel, err)
		}
	}
}

func TestRunModelDownloadExpandsTildeDir(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "model.onnx"):
			_, _ = w.Write([]byte("onnx-model"))
		case strings.HasSuffix(r.URL.Path, "tokenizer.json"):
			_, _ = w.Write([]byte("{}"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	orig := onnxModelCatalog["all-minilm-l6-v2"]
	t.Cleanup(func() {
		onnxModelCatalog["all-minilm-l6-v2"] = orig
	})
	catalog := orig
	catalog.files = map[string]string{
		"onnx/model.onnx": srv.URL + "/onnx/model.onnx",
		"tokenizer.json":  srv.URL + "/tokenizer.json",
	}
	onnxModelCatalog["all-minilm-l6-v2"] = catalog

	modelDownloadDir = "~/.kiwi/models/custom"
	t.Cleanup(func() { modelDownloadDir = "" })

	if err := runModelDownload(modelDownloadCmd, []string{"all-minilm-l6-v2"}); err != nil {
		t.Fatalf("runModelDownload: %v", err)
	}
	wantDir := filepath.Join(home, ".kiwi", "models", "custom")
	for _, rel := range []string{"onnx/model.onnx", "tokenizer.json"} {
		path := filepath.Join(wantDir, rel)
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("missing %s under expanded dir: %v", rel, err)
		}
	}
}

func TestRunModelDownloadUnknownModel(t *testing.T) {
	err := runModelDownload(modelDownloadCmd, []string{"not-a-model"})
	if err == nil || !strings.Contains(err.Error(), "unknown model") {
		t.Fatalf("err = %v, want unknown model error", err)
	}
}

func TestModelDownloadHintUsesTypeAlias(t *testing.T) {
	artifact := onnxModelCatalog["all-minilm-l6-v2"]
	hint := fmt.Sprintf(artifact.hintTOML, "/tmp/models/all-MiniLM-L6-v2")
	if !strings.Contains(hint, `type = "onnx"`) {
		t.Fatalf("hint should use type alias from issue #102:\n%s", hint)
	}
	if strings.Contains(hint, `provider = "onnx"`) {
		t.Fatalf("hint should prefer type over provider:\n%s", hint)
	}
}
