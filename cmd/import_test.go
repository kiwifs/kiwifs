package cmd

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/spf13/cobra"
)

func TestInferSchema_SaveSchema_WritesFile(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	prev, _ := os.Getwd()
	_ = os.Chdir(dir)
	t.Cleanup(func() { _ = os.Chdir(prev) })

	// minimal CSV with header + one row
	if err := os.WriteFile("data.csv", []byte("id,name\n1,Alice\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	c := &cobra.Command{}
	c.Flags().String("file", "", "")
	c.Flags().Bool("save-schema", false, "")
	_ = c.Flags().Set("file", "data.csv")
	_ = c.Flags().Set("save-schema", "true")

	if err := runInferSchema(c, "csv"); err != nil {
		t.Fatalf("runInferSchema: %v", err)
	}

	outPath := filepath.Join(".kiwi", "schemas", "data.json")
	if _, err := os.Stat(outPath); err != nil {
		t.Fatalf("expected schema written at %s: %v", outPath, err)
	}
}
