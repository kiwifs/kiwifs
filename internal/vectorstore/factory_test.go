package vectorstore

import (
	"context"
	"os"
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
