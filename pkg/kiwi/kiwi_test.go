package kiwi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/kiwifs/kiwifs/pkg/kiwi"
)

func TestNewAndHandler(t *testing.T) {
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, ".kiwi"), 0755)
	os.WriteFile(filepath.Join(root, ".kiwi", "config.toml"), []byte("[search]\nengine = \"grep\"\n[versioning]\nstrategy = \"none\"\n"), 0644)

	srv, err := kiwi.New(root,
		kiwi.WithSearch("grep"),
		kiwi.WithVersioning("none"),
	)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer srv.Close()

	ctx := context.Background()
	if _, err := srv.Pipeline().Write(ctx, "hello.md", []byte("# Hello"), "test"); err != nil {
		t.Fatalf("Write: %v", err)
	}

	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/health")
	if err != nil {
		t.Fatalf("health: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("health: got %d", resp.StatusCode)
	}

	resp, err = http.Get(ts.URL + "/api/kiwi/tree?path=/")
	if err != nil {
		t.Fatalf("tree: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("tree: got %d", resp.StatusCode)
	}
	var tree map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&tree)
	children, ok := tree["children"].([]interface{})
	if !ok || len(children) == 0 {
		t.Fatal("tree should have children after writing hello.md")
	}
}
