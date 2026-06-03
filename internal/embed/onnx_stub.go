//go:build !onnx

package embed

import "fmt"

type onnxStubRunner struct{}

func newONNXRunner(_ ONNXOptions) (onnxRunner, error) {
	return nil, fmt.Errorf("onnx: this KiwiFS binary was built without ONNX Runtime support; rebuild with -tags onnx and provide model_path/tokenizer_path")
}
