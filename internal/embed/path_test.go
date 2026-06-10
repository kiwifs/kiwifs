package embed

import (
	"os"
	"path/filepath"
	"testing"
)

func TestExpandUserPath(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	got := ExpandUserPath("~/models/model.onnx")
	want := filepath.Join(home, "models/model.onnx")
	if got != want {
		t.Fatalf("expandUserPath = %q, want %q", got, want)
	}
	if ExpandUserPath("/abs/path") != "/abs/path" {
		t.Fatal("absolute path should be unchanged")
	}
}

func TestResolveTokenizerPathExplicit(t *testing.T) {
	got, err := resolveTokenizerPath("/models/onnx/model.onnx", "/custom/tokenizer.json")
	if err != nil {
		t.Fatal(err)
	}
	if got != "/custom/tokenizer.json" {
		t.Fatalf("got %q, want explicit path", got)
	}
}

func TestResolveTokenizerPathInfersSibling(t *testing.T) {
	dir := t.TempDir()
	modelPath := filepath.Join(dir, "onnx", "model.onnx")
	tokenizerPath := filepath.Join(dir, "tokenizer.json")
	if err := os.MkdirAll(filepath.Dir(modelPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(modelPath, []byte("onnx"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(tokenizerPath, []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := resolveTokenizerPath(modelPath, "")
	if err != nil {
		t.Fatal(err)
	}
	if got != tokenizerPath {
		t.Fatalf("got %q, want %q", got, tokenizerPath)
	}
}

func TestResolveTokenizerPathInfersSameDirectory(t *testing.T) {
	dir := t.TempDir()
	modelPath := filepath.Join(dir, "model.onnx")
	tokenizerPath := filepath.Join(dir, "tokenizer.json")
	if err := os.WriteFile(modelPath, []byte("onnx"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(tokenizerPath, []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := resolveTokenizerPath(modelPath, "")
	if err != nil {
		t.Fatal(err)
	}
	if got != tokenizerPath {
		t.Fatalf("got %q, want %q", got, tokenizerPath)
	}
}
