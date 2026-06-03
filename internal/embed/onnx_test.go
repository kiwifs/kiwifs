package embed

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

type recordingONNXRunner struct {
	texts []string
}

func (r *recordingONNXRunner) Embed(_ context.Context, texts []string) ([][]float32, error) {
	r.texts = append([]string(nil), texts...)
	out := make([][]float32, len(texts))
	for i := range out {
		out[i] = []float32{1, 0, 0}
	}
	return out, nil
}

func (r *recordingONNXRunner) Close() error { return nil }

func TestONNXAppliesE5Prefixes(t *testing.T) {
	runner := &recordingONNXRunner{}
	normalize := false
	emb := &ONNX{
		options: ONNXOptions{
			Dimensions:    3,
			Normalize:     &normalize,
			QueryPrefix:   "query: ",
			PassagePrefix: "passage: ",
		},
		runner: runner,
	}
	if _, err := emb.EmbedDocuments(context.Background(), []string{"한국어 문서", "中文文档"}); err != nil {
		t.Fatalf("EmbedDocuments: %v", err)
	}
	if want := []string{"passage: 한국어 문서", "passage: 中文文档"}; !reflect.DeepEqual(runner.texts, want) {
		t.Fatalf("document texts = %#v, want %#v", runner.texts, want)
	}
	if _, err := emb.EmbedQuery(context.Background(), "검색어"); err != nil {
		t.Fatalf("EmbedQuery: %v", err)
	}
	if want := []string{"query: 검색어"}; !reflect.DeepEqual(runner.texts, want) {
		t.Fatalf("query texts = %#v, want %#v", runner.texts, want)
	}
}

func TestNewONNXRequiresTokenizerPath(t *testing.T) {
	dir := t.TempDir()
	modelPath := filepath.Join(dir, "model.onnx")
	if err := os.WriteFile(modelPath, []byte("stub"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := NewONNX(ONNXOptions{ModelPath: modelPath}); err == nil {
		t.Fatal("NewONNX succeeded without tokenizer_path")
	}
}
