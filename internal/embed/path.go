package embed

import (
	"os"
	"path/filepath"
	"strings"
)

// ExpandUserPath replaces a leading ~/ with the user's home directory.
func ExpandUserPath(path string) string {
	if path == "" || !strings.HasPrefix(path, "~/") {
		return path
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return path
	}
	return strings.Replace(path, "~", home, 1)
}

// resolveTokenizerPath returns an explicit tokenizer path or infers tokenizer.json
// next to the ONNX model (same directory, then parent — matches kiwifs model download layout).
func resolveTokenizerPath(modelPath, tokenizerPath string) (string, error) {
	tokenizerPath = ExpandUserPath(tokenizerPath)
	if tokenizerPath != "" {
		return tokenizerPath, nil
	}
	modelPath = ExpandUserPath(modelPath)
	if modelPath == "" {
		return "", nil
	}
	candidates := []string{
		filepath.Join(filepath.Dir(modelPath), "tokenizer.json"),
		filepath.Join(filepath.Dir(filepath.Dir(modelPath)), "tokenizer.json"),
	}
	for _, candidate := range candidates {
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
	}
	return "", nil
}
