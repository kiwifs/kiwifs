package embed

import (
	"context"
	"fmt"
	"os"
)

const (
	defaultONNXDimensions    = 384
	defaultONNXMaxTokens     = 512
	defaultONNXPooling       = "mean"
	defaultONNXInputIDsName  = "input_ids"
	defaultONNXAttentionName = "attention_mask"
	defaultONNXOutputName    = "last_hidden_state"
)

// ONNXOptions configures the build-tagged in-process ONNX embedder. It is
// intentionally explicit instead of overloading base_url: ONNX inference needs
// both a model file and the matching HuggingFace tokenizer.json.
type ONNXOptions struct {
	ModelPath     string
	TokenizerPath string
	RuntimePath   string
	Dimensions    int
	MaxTokens     int
	Pooling       string // mean | cls
	Normalize     *bool
	QueryPrefix   string
	PassagePrefix string
	InputIDsName  string
	AttentionName string
	TokenTypeName string
	OutputName    string
}

func (o ONNXOptions) withDefaults() ONNXOptions {
	if o.Dimensions <= 0 {
		o.Dimensions = defaultONNXDimensions
	}
	if o.MaxTokens <= 0 {
		o.MaxTokens = defaultONNXMaxTokens
	}
	if o.Pooling == "" {
		o.Pooling = defaultONNXPooling
	}
	if o.InputIDsName == "" {
		o.InputIDsName = defaultONNXInputIDsName
	}
	if o.AttentionName == "" {
		o.AttentionName = defaultONNXAttentionName
	}
	if o.OutputName == "" {
		o.OutputName = defaultONNXOutputName
	}
	if o.Normalize == nil {
		v := true
		o.Normalize = &v
	}
	return o
}

// ONNX is an in-process embedder backed by an ONNX model file and tokenizer on
// disk. The default KiwiFS binary remains CGO-free; build with -tags onnx to
// include the onnxruntime-backed implementation in onnx_runtime.go.
type ONNX struct {
	options ONNXOptions
	runner  onnxRunner
}

type onnxRunner interface {
	Embed(ctx context.Context, texts []string) ([][]float32, error)
	Close() error
}

// NewONNX constructs an ONNX embedder. In non-onnx builds this returns a clear
// configuration error; in -tags onnx builds it loads the tokenizer and creates
// an onnxruntime session.
func NewONNX(options ONNXOptions) (*ONNX, error) {
	options = options.withDefaults()
	if options.ModelPath == "" {
		return nil, fmt.Errorf("onnx: model_path is required")
	}
	if options.TokenizerPath == "" {
		return nil, fmt.Errorf("onnx: tokenizer_path is required")
	}
	if _, err := os.Stat(options.ModelPath); err != nil {
		return nil, fmt.Errorf("onnx: model not found at %s: %w", options.ModelPath, err)
	}
	if _, err := os.Stat(options.TokenizerPath); err != nil {
		return nil, fmt.Errorf("onnx: tokenizer not found at %s: %w", options.TokenizerPath, err)
	}
	runner, err := newONNXRunner(options)
	if err != nil {
		return nil, err
	}
	return &ONNX{options: options, runner: runner}, nil
}

// Embed preserves the legacy Embedder interface. For E5-style models, callers
// that know whether text is a document or a query should prefer EmbedDocuments
// or EmbedQuery so prefixes are applied correctly.
func (o *ONNX) Embed(ctx context.Context, texts []string) ([][]float32, error) {
	return o.runner.Embed(ctx, texts)
}

// EmbedDocuments embeds indexed chunks with PassagePrefix, e.g. "passage: "
// for multilingual-e5 models.
func (o *ONNX) EmbedDocuments(ctx context.Context, texts []string) ([][]float32, error) {
	return o.runner.Embed(ctx, withPrefix(o.options.PassagePrefix, texts))
}

// EmbedQuery embeds a search query with QueryPrefix, e.g. "query: " for
// multilingual-e5 models.
func (o *ONNX) EmbedQuery(ctx context.Context, text string) ([]float32, error) {
	vecs, err := o.runner.Embed(ctx, withPrefix(o.options.QueryPrefix, []string{text}))
	if err != nil {
		return nil, err
	}
	if len(vecs) != 1 {
		return nil, fmt.Errorf("onnx: embedder returned %d vectors for 1 input", len(vecs))
	}
	return vecs[0], nil
}

func (o *ONNX) Dimensions() int { return o.options.Dimensions }

func (o *ONNX) Close() error { return o.runner.Close() }

func withPrefix(prefix string, texts []string) []string {
	if prefix == "" || len(texts) == 0 {
		return texts
	}
	out := make([]string, len(texts))
	for i, text := range texts {
		out[i] = prefix + text
	}
	return out
}
