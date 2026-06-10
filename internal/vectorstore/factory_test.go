package vectorstore

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kiwifs/kiwifs/internal/config"
)

func TestBuildEmbedderONNXWithoutRuntimeSupport(t *testing.T) {
	dir := t.TempDir()
	modelPath := dir + "/model.onnx"
	tokenizerPath := dir + "/tokenizer.json"
	if err := os.WriteFile(modelPath, []byte("stub"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(tokenizerPath, []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := buildEmbedder(context.Background(), config.EmbedderConfig{
		Provider:      "onnx",
		ModelPath:     modelPath,
		TokenizerPath: tokenizerPath,
	})
	if err == nil {
		t.Fatal("buildEmbedder succeeded without ONNX runtime build tag")
	}
	if !strings.Contains(err.Error(), "onnx") {
		t.Fatalf("err = %v, want onnx-related message", err)
	}
}

func TestBuildEmbedderONNXTypeAlias(t *testing.T) {
	dir := t.TempDir()
	modelPath := filepath.Join(dir, "onnx", "model.onnx")
	tokenizerPath := filepath.Join(dir, "tokenizer.json")
	if err := os.MkdirAll(filepath.Dir(modelPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(modelPath, []byte("stub"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(tokenizerPath, []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	// Issue #102 uses type = "onnx" without provider; factory must accept Type alone.
	_, err := buildEmbedder(context.Background(), config.EmbedderConfig{
		Type:      "onnx",
		ModelPath: modelPath,
	})
	if err == nil {
		t.Fatal("buildEmbedder succeeded without ONNX runtime build tag")
	}
	if strings.Contains(err.Error(), "unknown embedder provider") {
		t.Fatalf("type alias not resolved, got: %v", err)
	}
	if !strings.Contains(err.Error(), "onnx") {
		t.Fatalf("err = %v, want onnx-related message", err)
	}
}

func TestBuildEmbedderUnknownProviderUsesResolvedType(t *testing.T) {
	_, err := buildEmbedder(context.Background(), config.EmbedderConfig{
		Type: "not-a-real-provider",
	})
	if err == nil {
		t.Fatal("buildEmbedder succeeded with unknown provider")
	}
	if !strings.Contains(err.Error(), `unknown embedder provider "not-a-real-provider"`) {
		t.Fatalf("err = %v, want resolved type in unknown-provider message", err)
	}
}

func TestBuildEmbedderONNXInfersTokenizerPath(t *testing.T) {
	dir := t.TempDir()
	modelPath := filepath.Join(dir, "onnx", "model.onnx")
	tokenizerPath := filepath.Join(dir, "tokenizer.json")
	if err := os.MkdirAll(filepath.Dir(modelPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(modelPath, []byte("stub"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(tokenizerPath, []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := buildEmbedder(context.Background(), config.EmbedderConfig{
		Provider:  "onnx",
		ModelPath: modelPath,
	})
	if err == nil {
		t.Fatal("buildEmbedder succeeded without ONNX runtime build tag")
	}
	if strings.Contains(err.Error(), "tokenizer_path is required") {
		t.Fatalf("tokenizer should be inferred from parent dir, got: %v", err)
	}
	if !strings.Contains(err.Error(), "onnx") {
		t.Fatalf("err = %v, want onnx-related message", err)
	}
}
