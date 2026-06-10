package embed

import (
	"os"
	"path/filepath"
	"testing"
)

func TestExpandUserPath(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	got := expandUserPath("~/models/model.onnx")
	want := filepath.Join(home, "models/model.onnx")
	if got != want {
		t.Fatalf("expandUserPath = %q, want %q", got, want)
	}
	if expandUserPath("/abs/path") != "/abs/path" {
		t.Fatal("absolute path should be unchanged")
	}
}
