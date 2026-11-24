package mcpserver

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/kiwifs/kiwifs/internal/versioning"
)

func TestTimelineAndVelocity_NonASCIIPath(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not in PATH")
	}
	ctx := context.Background()
	b, root := setupTestBackend(t)
	defer b.Close()

	g, err := versioning.NewGit(root)
	if err != nil {
		t.Fatal(err)
	}
	const path = "日本/café.md"
	if err := os.MkdirAll(filepath.Join(root, "日本"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, path), []byte("body\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := g.Commit(ctx, path, "alice", "add page"); err != nil {
		t.Fatal(err)
	}

	tl, err := b.Timeline(ctx, 10, 0, "", "", "日本/")
	if err != nil {
		t.Fatal(err)
	}
	if len(tl.Events) != 1 || tl.Events[0].Path != path {
		t.Errorf("timeline events = %+v, want %s", tl.Events, path)
	}

	v, err := b.Velocity(ctx, "30d", 10, "日本/")
	if err != nil {
		t.Fatal(err)
	}
	if len(v.HotSpots) != 1 || v.HotSpots[0].Path != path {
		t.Errorf("hot spots = %+v, want %s", v.HotSpots, path)
	}
}
