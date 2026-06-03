//go:build onnx

package embed

import (
	"context"
	"math"
	"os"
	"testing"
)

func TestONNXRuntimeIntegration(t *testing.T) {
	modelPath := os.Getenv("KIWI_ONNX_TEST_MODEL")
	tokenizerPath := os.Getenv("KIWI_ONNX_TEST_TOKENIZER")
	if modelPath == "" || tokenizerPath == "" {
		t.Skip("set KIWI_ONNX_TEST_MODEL and KIWI_ONNX_TEST_TOKENIZER to run ONNX runtime integration test")
	}
	runtimePath := os.Getenv("KIWI_ONNX_RUNTIME_PATH")
	emb, err := NewONNX(ONNXOptions{
		ModelPath:     modelPath,
		TokenizerPath: tokenizerPath,
		RuntimePath:   runtimePath,
		Dimensions:    384,
		MaxTokens:     512,
		Pooling:       "mean",
		QueryPrefix:   "query: ",
		PassagePrefix: "passage: ",
	})
	if err != nil {
		t.Fatalf("NewONNX: %v", err)
	}
	defer emb.Close()
	vecs, err := emb.EmbedDocuments(context.Background(), []string{
		"한국어 문서 검색을 테스트합니다.",
		"日本語の文書検索をテストします。",
		"中文文档检索测试。",
	})
	if err != nil {
		t.Fatalf("EmbedDocuments: %v", err)
	}
	if len(vecs) != 3 {
		t.Fatalf("vector count = %d, want 3", len(vecs))
	}
	for i, vec := range vecs {
		if len(vec) != emb.Dimensions() {
			t.Fatalf("vector %d dimensions = %d, want %d", i, len(vec), emb.Dimensions())
		}
		var sum float64
		for _, v := range vec {
			if math.IsNaN(float64(v)) || math.IsInf(float64(v), 0) {
				t.Fatalf("vector %d contains non-finite value %v", i, v)
			}
			sum += float64(v * v)
		}
		if sum == 0 {
			t.Fatalf("vector %d is all zeros", i)
		}
		if math.Abs(math.Sqrt(sum)-1) > 0.01 {
			t.Fatalf("vector %d norm = %.4f, want ~1", i, math.Sqrt(sum))
		}
	}
	query, err := emb.EmbedQuery(context.Background(), "한국어 검색어")
	if err != nil {
		t.Fatalf("EmbedQuery: %v", err)
	}
	if len(query) != emb.Dimensions() {
		t.Fatalf("query dimensions = %d, want %d", len(query), emb.Dimensions())
	}
}
