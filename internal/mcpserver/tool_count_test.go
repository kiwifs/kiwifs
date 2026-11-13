package mcpserver

import (
	"context"
	"testing"

	"github.com/mark3labs/mcp-go/mcp"
)

// The tool count appears in AGENTS.md and docs/FAQ.md, where it goes stale
// silently. Assert it here so adding a tool forces the docs to be updated.
const documentedToolCount = 79

func TestToolCountMatchesTheDocs(t *testing.T) {
	dir := t.TempDir()
	s, _, err := New(Options{Root: dir})
	if err != nil {
		t.Fatal(err)
	}
	res := s.HandleMessage(context.Background(), []byte(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`))
	resp, ok := res.(mcp.JSONRPCResponse)
	if !ok {
		t.Fatalf("unexpected response %T: %v", res, res)
	}
	list, ok := resp.Result.(mcp.ListToolsResult)
	if !ok {
		t.Fatalf("unexpected result %T", resp.Result)
	}
	if len(list.Tools) != documentedToolCount {
		t.Errorf("the server exposes %d tools but the docs say %d; update AGENTS.md and docs/FAQ.md",
			len(list.Tools), documentedToolCount)
	}
}
