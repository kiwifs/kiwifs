package tests

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kiwifs/kiwifs/internal/mcpserver"
	"github.com/kiwifs/kiwifs/pkg/kiwi"
	"github.com/mark3labs/mcp-go/client"
	"github.com/mark3labs/mcp-go/mcp"
)

// setupMCPIntegration boots an embeddable KiwiFS workspace and an in-process MCP
// client (same protocol as stdio transport). Closes #156.
func setupMCPIntegration(t *testing.T) (*client.Client, string) {
	t.Helper()
	root := t.TempDir()
	kiwiDir := filepath.Join(root, ".kiwi")
	if err := os.MkdirAll(kiwiDir, 0o755); err != nil {
		t.Fatal(err)
	}
	config := `[search]
engine = "grep"
[versioning]
strategy = "none"
`
	if err := os.WriteFile(filepath.Join(kiwiDir, "config.toml"), []byte(config), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "index.md"), []byte("# Index\n\nSeed page.\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	embed, err := kiwi.New(root, kiwi.WithSearch("grep"), kiwi.WithVersioning("none"))
	if err != nil {
		t.Fatalf("kiwi.New: %v", err)
	}
	t.Cleanup(func() { _ = embed.Close() })

	mcpSrv, _, err := mcpserver.New(mcpserver.Options{Root: root})
	if err != nil {
		t.Fatalf("mcpserver.New: %v", err)
	}

	cli, err := client.NewInProcessClient(mcpSrv)
	if err != nil {
		t.Fatalf("NewInProcessClient: %v", err)
	}
	t.Cleanup(func() { _ = cli.Close() })

	ctx := context.Background()
	if err := cli.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}

	initReq := mcp.InitializeRequest{}
	initReq.Params.ProtocolVersion = mcp.LATEST_PROTOCOL_VERSION
	initReq.Params.ClientInfo = mcp.Implementation{Name: "kiwifs-integration-test", Version: "1.0.0"}
	if _, err := cli.Initialize(ctx, initReq); err != nil {
		t.Fatalf("Initialize: %v", err)
	}

	return cli, root
}

func mcpCallText(t *testing.T, cli *client.Client, name string, args map[string]any) string {
	t.Helper()
	req := mcp.CallToolRequest{}
	req.Params.Name = name
	req.Params.Arguments = args
	res, err := cli.CallTool(context.Background(), req)
	if err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	if res.IsError {
		t.Fatalf("%s: tool error: %v", name, res.Content)
	}
	if len(res.Content) == 0 {
		return ""
	}
	tc, ok := res.Content[0].(mcp.TextContent)
	if !ok {
		t.Fatalf("%s: unexpected content type", name)
	}
	return tc.Text
}

func TestMCPIntegrationWriteReadSearchRoundTrip(t *testing.T) {
	cli, _ := setupMCPIntegration(t)

	body := "# MCP integration\n\nUniqueToken: kiwifs-mcp-harness-156\n"
	writeOut := mcpCallText(t, cli, "kiwi_write", map[string]any{
		"path":    "notes/harness.md",
		"content": body,
	})
	if !strings.Contains(writeOut, "notes/harness.md") {
		t.Fatalf("write: %q", writeOut)
	}

	readOut := mcpCallText(t, cli, "kiwi_read", map[string]any{"path": "notes/harness.md"})
	if !strings.Contains(readOut, "kiwifs-mcp-harness-156") {
		t.Fatalf("read missing content: %q", readOut)
	}

	searchOut := mcpCallText(t, cli, "kiwi_search", map[string]any{"query": "kiwifs-mcp-harness-156"})
	if !strings.Contains(searchOut, "notes/harness.md") {
		t.Fatalf("search: %q", searchOut)
	}
}

func TestMCPIntegrationTreeDeleteRename(t *testing.T) {
	cli, _ := setupMCPIntegration(t)

	mcpCallText(t, cli, "kiwi_write", map[string]any{
		"path":    "alpha.md",
		"content": "# Alpha\n",
	})

	treeOut := mcpCallText(t, cli, "kiwi_tree", map[string]any{"path": "/"})
	if !strings.Contains(treeOut, "alpha.md") {
		t.Fatalf("tree: %q", treeOut)
	}

	mcpCallText(t, cli, "kiwi_rename", map[string]any{
		"from": "alpha.md",
		"to":   "beta.md",
	})

	readOut := mcpCallText(t, cli, "kiwi_read", map[string]any{"path": "beta.md"})
	if !strings.Contains(readOut, "Alpha") {
		t.Fatalf("rename read: %q", readOut)
	}

	mcpCallText(t, cli, "kiwi_delete", map[string]any{"path": "beta.md"})
	treeAfter := mcpCallText(t, cli, "kiwi_tree", map[string]any{"path": "/"})
	if strings.Contains(treeAfter, "beta.md") {
		t.Fatalf("expected beta.md deleted, tree: %q", treeAfter)
	}
}
