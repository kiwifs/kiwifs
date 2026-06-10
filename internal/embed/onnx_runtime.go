//go:build onnx

package embed

import (
	"context"
	"fmt"
	"math"
	"strings"
	"sync"

	tok "github.com/sugarme/tokenizer"
	"github.com/sugarme/tokenizer/pretrained"
	ort "github.com/yalue/onnxruntime_go"
)

var (
	onnxEnvMu          sync.Mutex
	onnxEnvInitialized bool
)

type onnxRuntimeRunner struct {
	options   ONNXOptions
	tokenizer *tok.Tokenizer
	session   *ort.DynamicAdvancedSession
	mu        sync.Mutex
}

func newONNXRunner(options ONNXOptions) (onnxRunner, error) {
	if err := initONNXEnvironment(options.RuntimePath); err != nil {
		return nil, err
	}
	tokenizer, err := loadTokenizerSafe(options.TokenizerPath)
	if err != nil {
		return nil, err
	}
	inputNames, resolvedOptions, err := resolveONNXNames(options)
	if err != nil {
		return nil, err
	}
	options = resolvedOptions
	session, err := ort.NewDynamicAdvancedSession(options.ModelPath, inputNames, []string{options.OutputName}, nil)
	if err != nil {
		return nil, fmt.Errorf("onnx: create runtime session: %w", err)
	}
	return &onnxRuntimeRunner{options: options, tokenizer: tokenizer, session: session}, nil
}

func resolveONNXNames(options ONNXOptions) ([]string, ONNXOptions, error) {
	inputs, outputs, err := ort.GetInputOutputInfo(options.ModelPath)
	if err != nil {
		return nil, options, fmt.Errorf("onnx: inspect model inputs/outputs: %w", err)
	}
	availableInputs := map[string]bool{}
	for _, input := range inputs {
		availableInputs[input.Name] = true
	}
	for _, required := range []string{options.InputIDsName, options.AttentionName} {
		if !availableInputs[required] {
			return nil, options, fmt.Errorf("onnx: model does not expose required input %q", required)
		}
	}
	inputNames := []string{options.InputIDsName, options.AttentionName}
	if options.TokenTypeName != "" {
		if !availableInputs[options.TokenTypeName] {
			return nil, options, fmt.Errorf("onnx: model does not expose token_type input %q", options.TokenTypeName)
		}
		inputNames = append(inputNames, options.TokenTypeName)
	} else if availableInputs["token_type_ids"] {
		options.TokenTypeName = "token_type_ids"
		inputNames = append(inputNames, options.TokenTypeName)
	}
	availableOutputs := map[string]bool{}
	for _, output := range outputs {
		availableOutputs[output.Name] = true
	}
	if availableOutputs[options.OutputName] {
		return inputNames, options, nil
	}
	if len(outputs) == 1 {
		options.OutputName = outputs[0].Name
		return inputNames, options, nil
	}
	return nil, options, fmt.Errorf("onnx: model does not expose output %q", options.OutputName)
}

// loadTokenizerSafe wraps pretrained.FromFile with panic recovery.
// The sugarme/tokenizer library panics on malformed tokenizer.json
// (e.g. missing "model" field) instead of returning an error.
func loadTokenizerSafe(path string) (tokenizer *tok.Tokenizer, err error) {
	defer func() {
		if r := recover(); r != nil {
			tokenizer = nil
			err = fmt.Errorf("onnx: tokenizer at %s is malformed or incompatible: %v", path, r)
		}
	}()
	tokenizer, err = pretrained.FromFile(path)
	if err != nil {
		return nil, fmt.Errorf("onnx: load tokenizer: %w", err)
	}
	return tokenizer, nil
}

func initONNXEnvironment(runtimePath string) error {
	onnxEnvMu.Lock()
	defer onnxEnvMu.Unlock()
	if onnxEnvInitialized {
		return nil
	}
	if runtimePath != "" {
		ort.SetSharedLibraryPath(runtimePath)
	}
	if err := ort.InitializeEnvironment(); err != nil {
		return fmt.Errorf("onnx: initialize runtime: %w", err)
	}
	onnxEnvInitialized = true
	return nil
}

func (r *onnxRuntimeRunner) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.session == nil {
		return nil
	}
	err := r.session.Destroy()
	r.session = nil
	return err
}

func (r *onnxRuntimeRunner) Embed(ctx context.Context, texts []string) ([][]float32, error) {
	if len(texts) == 0 {
		return nil, nil
	}
	inputIDs, attention, tokenTypes, batchSize, seqLen, err := r.encodeBatch(texts)
	if err != nil {
		return nil, err
	}
	shape := ort.NewShape(int64(batchSize), int64(seqLen))
	inputIDsTensor, err := ort.NewTensor(shape, inputIDs)
	if err != nil {
		return nil, fmt.Errorf("onnx: create input_ids tensor: %w", err)
	}
	defer inputIDsTensor.Destroy()
	attentionTensor, err := ort.NewTensor(shape, attention)
	if err != nil {
		return nil, fmt.Errorf("onnx: create attention_mask tensor: %w", err)
	}
	defer attentionTensor.Destroy()
	inputs := []ort.Value{inputIDsTensor, attentionTensor}
	var tokenTypeTensor *ort.Tensor[int64]
	if r.options.TokenTypeName != "" {
		tokenTypeTensor, err = ort.NewTensor(shape, tokenTypes)
		if err != nil {
			return nil, fmt.Errorf("onnx: create token_type_ids tensor: %w", err)
		}
		defer tokenTypeTensor.Destroy()
		inputs = append(inputs, tokenTypeTensor)
	}
	outputs := []ort.Value{nil}
	r.mu.Lock()
	if r.session == nil {
		r.mu.Unlock()
		return nil, fmt.Errorf("onnx: session is closed")
	}
	err = r.session.Run(inputs, outputs)
	r.mu.Unlock()
	if err != nil {
		return nil, fmt.Errorf("onnx: run inference: %w", err)
	}
	if outputs[0] == nil {
		return nil, fmt.Errorf("onnx: runtime did not return output %q", r.options.OutputName)
	}
	defer outputs[0].Destroy()
	outputTensor, ok := outputs[0].(*ort.Tensor[float32])
	if !ok {
		return nil, fmt.Errorf("onnx: output %q is %T, want float32 tensor", r.options.OutputName, outputs[0])
	}
	return r.pool(outputTensor, attention, batchSize, seqLen)
}

func (r *onnxRuntimeRunner) encodeBatch(texts []string) ([]int64, []int64, []int64, int, int, error) {
	encoded := make([]*tok.Encoding, len(texts))
	seqLen := 0
	for i, text := range texts {
		enc, err := r.tokenizer.EncodeSingle(text, true)
		if err != nil {
			return nil, nil, nil, 0, 0, fmt.Errorf("onnx: tokenize input %d: %w", i, err)
		}
		if len(enc.Ids) > r.options.MaxTokens {
			enc.Ids = enc.Ids[:r.options.MaxTokens]
			enc.AttentionMask = enc.AttentionMask[:r.options.MaxTokens]
			enc.TypeIds = enc.TypeIds[:r.options.MaxTokens]
		}
		if len(enc.Ids) > seqLen {
			seqLen = len(enc.Ids)
		}
		encoded[i] = enc
	}
	if seqLen == 0 {
		seqLen = 1
	}
	batchSize := len(texts)
	inputIDs := make([]int64, batchSize*seqLen)
	attention := make([]int64, batchSize*seqLen)
	tokenTypes := make([]int64, batchSize*seqLen)
	for i, enc := range encoded {
		for j, id := range enc.Ids {
			idx := i*seqLen + j
			inputIDs[idx] = int64(id)
			attention[idx] = maskAt(enc.AttentionMask, j)
			tokenTypes[idx] = int64(maskAt(enc.TypeIds, j))
		}
	}
	return inputIDs, attention, tokenTypes, batchSize, seqLen, nil
}

func maskAt(values []int, idx int) int64 {
	if idx >= 0 && idx < len(values) {
		return int64(values[idx])
	}
	return 0
}

func (r *onnxRuntimeRunner) pool(t *ort.Tensor[float32], attention []int64, batchSize, seqLen int) ([][]float32, error) {
	shape := t.GetShape()
	data := t.GetData()
	if len(shape) == 2 {
		if int(shape[0]) != batchSize || int(shape[1]) != r.options.Dimensions {
			return nil, fmt.Errorf("onnx: output shape %v does not match batch=%d dimensions=%d", shape, batchSize, r.options.Dimensions)
		}
		out := make([][]float32, batchSize)
		for i := range out {
			vec := append([]float32(nil), data[i*r.options.Dimensions:(i+1)*r.options.Dimensions]...)
			if *r.options.Normalize {
				normalize(vec)
			}
			out[i] = vec
		}
		return out, nil
	}
	if len(shape) != 3 {
		return nil, fmt.Errorf("onnx: output shape %v, want [batch, seq, hidden] or [batch, hidden]", shape)
	}
	hidden := int(shape[2])
	if int(shape[0]) != batchSize || int(shape[1]) != seqLen || hidden != r.options.Dimensions {
		return nil, fmt.Errorf("onnx: output shape %v does not match batch=%d seq=%d dimensions=%d", shape, batchSize, seqLen, r.options.Dimensions)
	}
	out := make([][]float32, batchSize)
	for b := 0; b < batchSize; b++ {
		vec := make([]float32, hidden)
		switch strings.ToLower(r.options.Pooling) {
		case "", "mean":
			var count float32
			for s := 0; s < seqLen; s++ {
				if attention[b*seqLen+s] == 0 {
					continue
				}
				count++
				base := (b*seqLen + s) * hidden
				for h := 0; h < hidden; h++ {
					vec[h] += data[base+h]
				}
			}
			if count == 0 {
				return nil, fmt.Errorf("onnx: input %d has no unmasked tokens", b)
			}
			for h := 0; h < hidden; h++ {
				vec[h] /= count
			}
		case "cls":
			copy(vec, data[(b*seqLen)*hidden:(b*seqLen+1)*hidden])
		default:
			return nil, fmt.Errorf("onnx: unsupported pooling %q (want mean or cls)", r.options.Pooling)
		}
		if *r.options.Normalize {
			normalize(vec)
		}
		out[b] = vec
	}
	return out, nil
}

func normalize(vec []float32) {
	var sum float64
	for _, v := range vec {
		sum += float64(v * v)
	}
	if sum == 0 || math.IsNaN(sum) || math.IsInf(sum, 0) {
		return
	}
	norm := float32(math.Sqrt(sum))
	for i := range vec {
		vec[i] /= norm
	}
}
