package cmd

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/kiwifs/kiwifs/internal/embed"
	"github.com/spf13/cobra"
)

const modelDownloadTimeout = 30 * time.Minute

var modelCmd = &cobra.Command{
	Use:   "model",
	Short: "Download embedding model artifacts for offline vector search",
}

var modelDownloadCmd = &cobra.Command{
	Use:   "download [model]",
	Short: "Download ONNX model and tokenizer files from HuggingFace",
	Long: `Download ONNX embedding model artifacts into ~/.kiwi/models/.

Supported models:
  all-minilm-l6-v2         English baseline (384-dim, ~80MB)
  multilingual-e5-small  Multilingual/CJK default (384-dim, needs query/passage prefixes)

After download, configure vector search with type = "onnx" and the printed paths.`,
	Args: cobra.MaximumNArgs(1),
	RunE: runModelDownload,
}

var modelDownloadDir string

func init() {
	modelDownloadCmd.Flags().StringVar(&modelDownloadDir, "dir", "", "output directory (default: ~/.kiwi/models/<model>)")
	modelCmd.AddCommand(modelDownloadCmd)
}

type modelArtifact struct {
	name     string
	files    map[string]string // local name -> HuggingFace URL
	subdir   string
	hintTOML string
}

var onnxModelCatalog = map[string]modelArtifact{
	"all-minilm-l6-v2": {
		name:   "sentence-transformers/all-MiniLM-L6-v2",
		subdir: "all-MiniLM-L6-v2",
		files: map[string]string{
			"onnx/model.onnx": "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx",
			"tokenizer.json":  "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/tokenizer.json",
		},
		hintTOML: `[search.vector.embedder]
type = "onnx"
model_path = "%s/onnx/model.onnx"
dimensions = 384
# tokenizer_path optional — auto-discovered from parent dir`,
	},
	"multilingual-e5-small": {
		name:   "intfloat/multilingual-e5-small",
		subdir: "multilingual-e5-small",
		files: map[string]string{
			"onnx/model.onnx": "https://huggingface.co/intfloat/multilingual-e5-small/resolve/main/onnx/model.onnx",
			"tokenizer.json":  "https://huggingface.co/intfloat/multilingual-e5-small/resolve/main/tokenizer.json",
		},
		hintTOML: `[search.vector.embedder]
type = "onnx"
model_path = "%s/onnx/model.onnx"
dimensions = 384
query_prefix = "query: "
passage_prefix = "passage: "
# tokenizer_path optional — auto-discovered from parent dir`,
	},
}

func runModelDownload(cmd *cobra.Command, args []string) error {
	modelKey := "all-minilm-l6-v2"
	if len(args) > 0 {
		modelKey = strings.ToLower(args[0])
	}
	artifact, ok := onnxModelCatalog[modelKey]
	if !ok {
		keys := make([]string, 0, len(onnxModelCatalog))
		for k := range onnxModelCatalog {
			keys = append(keys, k)
		}
		return fmt.Errorf("unknown model %q (want %s)", modelKey, strings.Join(keys, " | "))
	}
	outDir := embed.ExpandUserPath(modelDownloadDir)
	if outDir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return fmt.Errorf("home dir: %w", err)
		}
		outDir = filepath.Join(home, ".kiwi", "models", artifact.subdir)
	}
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return fmt.Errorf("create output dir: %w", err)
	}
	client := &http.Client{Timeout: modelDownloadTimeout}
	for relPath, url := range artifact.files {
		dest := filepath.Join(outDir, relPath)
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			return err
		}
		if _, err := os.Stat(dest); err == nil {
			fmt.Fprintf(cmd.OutOrStdout(), "skip %s (already exists)\n", relPath)
			continue
		}
		fmt.Fprintf(cmd.OutOrStdout(), "download %s\n", relPath)
		if err := downloadFile(client, url, dest); err != nil {
			return fmt.Errorf("download %s: %w", relPath, err)
		}
	}
	fmt.Fprintf(cmd.OutOrStdout(), "\nDownloaded %s to %s\n\nExample config:\n%s\n\nBuild with ONNX support:\n  go build -tags onnx -o kiwifs .\n",
		artifact.name, outDir, fmt.Sprintf(artifact.hintTOML, outDir))
	return nil
}

func downloadFile(client *http.Client, url, dest string) error {
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d from %s", resp.StatusCode, url)
	}
	tmp := dest + ".part"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, resp.Body); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, dest)
}
