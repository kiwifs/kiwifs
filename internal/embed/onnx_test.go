package embed

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"strings"
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

func TestONNXEmbedVectorDimensions(t *testing.T) {
	const dims = 384
	runner := &dimensionONNXRunner{dims: dims}
	emb := &ONNX{options: ONNXOptions{Dimensions: dims}, runner: runner}
	sentences := []string{
		"The quick brown fox jumps over the lazy dog.",
		"Semantic search works offline with ONNX.",
		"한국어 문서도 임베딩할 수 있습니다.",
	}
	vecs, err := emb.Embed(context.Background(), sentences)
	if err != nil {
		t.Fatalf("Embed: %v", err)
	}
	if len(vecs) != len(sentences) {
		t.Fatalf("vector count = %d, want %d", len(vecs), len(sentences))
	}
	for i, vec := range vecs {
		if len(vec) != dims {
			t.Fatalf("vector %d dimensions = %d, want %d", i, len(vec), dims)
		}
	}
	if emb.Dimensions() != dims {
		t.Fatalf("Dimensions() = %d, want %d", emb.Dimensions(), dims)
	}
}

type dimensionONNXRunner struct {
	dims int
}

func (r *dimensionONNXRunner) Embed(_ context.Context, texts []string) ([][]float32, error) {
	out := make([][]float32, len(texts))
	for i := range out {
		vec := make([]float32, r.dims)
		vec[0] = float32(i + 1)
		out[i] = vec
	}
	return out, nil
}

func (r *dimensionONNXRunner) Close() error { return nil }

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

func TestNewONNXInfersTokenizerPath(t *testing.T) {
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
	_, err := NewONNX(ONNXOptions{ModelPath: modelPath, Dimensions: 384})
	if err == nil {
		t.Fatal("expected error without onnx build tag")
	}
	if strings.Contains(err.Error(), "tokenizer_path is required") {
		t.Fatalf("tokenizer should be inferred, got: %v", err)
	}
}
