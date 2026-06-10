package vectorstore

import (
	"context"
	"fmt"
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

func TestBuildEmbedderONNXFromLoadedConfig(t *testing.T) {
	root := t.TempDir()
	cfgDir := filepath.Join(root, ".kiwi")
	if err := os.MkdirAll(cfgDir, 0o755); err != nil {
		t.Fatal(err)
	}
	modelDir := filepath.Join(root, "models", "all-MiniLM-L6-v2", "onnx")
	tokenizerPath := filepath.Join(root, "models", "all-MiniLM-L6-v2", "tokenizer.json")
	modelPath := filepath.Join(modelDir, "model.onnx")
	if err := os.MkdirAll(modelDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(modelPath, []byte("stub"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(tokenizerPath, []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	body := fmt.Sprintf(`
[search.vector.embedder]
type = "onnx"
model_path = %q
`, modelPath)
	if err := os.WriteFile(filepath.Join(cfgDir, "config.toml"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg, err := config.Load(root)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	_, err = buildEmbedder(context.Background(), cfg.Search.Vector.Embedder)
	if err == nil {
		t.Fatal("buildEmbedder succeeded without ONNX runtime build tag")
	}
	if strings.Contains(err.Error(), "unknown embedder provider") {
		t.Fatalf("loaded type alias not resolved in factory, got: %v", err)
	}
	if !strings.Contains(err.Error(), "onnx") {
		t.Fatalf("err = %v, want onnx-related message", err)
	}
}

func TestBuildONNXFromLoadedConfig(t *testing.T) {
	root := t.TempDir()
	cfgDir := filepath.Join(root, ".kiwi")
	if err := os.MkdirAll(cfgDir, 0o755); err != nil {
		t.Fatal(err)
	}
	modelDir := filepath.Join(root, "models", "all-MiniLM-L6-v2", "onnx")
	tokenizerPath := filepath.Join(root, "models", "all-MiniLM-L6-v2", "tokenizer.json")
	modelPath := filepath.Join(modelDir, "model.onnx")
	if err := os.MkdirAll(modelDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(modelPath, []byte("stub"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(tokenizerPath, []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	body := fmt.Sprintf(`
[search.vector]
enabled = true

[search.vector.embedder]
type = "onnx"
model_path = %q
`, modelPath)
	if err := os.WriteFile(filepath.Join(cfgDir, "config.toml"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg, err := config.Load(root)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	_, err = Build(root, nil, cfg.Search.Vector)
	if err == nil {
		t.Fatal("Build succeeded without ONNX runtime build tag")
	}
	if !strings.Contains(err.Error(), "embedder:") {
		t.Fatalf("err = %v, want embedder wrapper from Build", err)
	}
	if strings.Contains(err.Error(), "unknown embedder provider") {
		t.Fatalf("loaded type alias not resolved in Build, got: %v", err)
	}
	if !strings.Contains(err.Error(), "onnx") {
		t.Fatalf("err = %v, want onnx-related message", err)
	}
}

func TestBuildONNXExpandsTildeModelPath(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	modelDir := filepath.Join(home, ".kiwi", "models", "all-MiniLM-L6-v2", "onnx")
	tokenizerPath := filepath.Join(home, ".kiwi", "models", "all-MiniLM-L6-v2", "tokenizer.json")
	modelPath := filepath.Join(modelDir, "model.onnx")
	if err := os.MkdirAll(modelDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(modelPath, []byte("stub"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(tokenizerPath, []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	cfgDir := filepath.Join(root, ".kiwi")
	if err := os.MkdirAll(cfgDir, 0o755); err != nil {
		t.Fatal(err)
	}
	body := `
[search.vector]
enabled = true

[search.vector.embedder]
type = "onnx"
model_path = "~/.kiwi/models/all-MiniLM-L6-v2/onnx/model.onnx"
`
	if err := os.WriteFile(filepath.Join(cfgDir, "config.toml"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg, err := config.Load(root)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	_, err = Build(root, nil, cfg.Search.Vector)
	if err == nil {
		t.Fatal("Build succeeded without ONNX runtime build tag")
	}
	if !strings.Contains(err.Error(), "embedder:") {
		t.Fatalf("err = %v, want embedder wrapper from Build", err)
	}
	if strings.Contains(err.Error(), "unknown embedder provider") {
		t.Fatalf("loaded type alias not resolved in Build, got: %v", err)
	}
	if strings.Contains(err.Error(), "model not found") {
		t.Fatalf("tilde path not expanded in Build, got: %v", err)
	}
	if !strings.Contains(err.Error(), "onnx") {
		t.Fatalf("err = %v, want onnx-related message", err)
	}
}

func TestBuildEmbedderONNXExpandsTildeModelPath(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	modelDir := filepath.Join(home, ".kiwi", "models", "all-MiniLM-L6-v2", "onnx")
	tokenizerPath := filepath.Join(home, ".kiwi", "models", "all-MiniLM-L6-v2", "tokenizer.json")
	modelPath := filepath.Join(modelDir, "model.onnx")
	if err := os.MkdirAll(modelDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(modelPath, []byte("stub"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(tokenizerPath, []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	// Issue #102 example uses model_path under ~/.kiwi/models/...
	_, err := buildEmbedder(context.Background(), config.EmbedderConfig{
		Type:      "onnx",
		ModelPath: "~/.kiwi/models/all-MiniLM-L6-v2/onnx/model.onnx",
	})
	if err == nil {
		t.Fatal("buildEmbedder succeeded without ONNX runtime build tag")
	}
	if strings.Contains(err.Error(), "unknown embedder provider") {
		t.Fatalf("type alias not resolved, got: %v", err)
	}
	if strings.Contains(err.Error(), "model not found") {
		t.Fatalf("tilde path not expanded, got: %v", err)
	}
	if !strings.Contains(err.Error(), "onnx") {
		t.Fatalf("err = %v, want onnx-related message", err)
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
