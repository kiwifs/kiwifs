package cmd

import (
	"fmt"

	"github.com/kiwifs/kiwifs/internal/mcpserver"
	"github.com/spf13/cobra"
)

var mcpCmd = &cobra.Command{
	Use:   "mcp",
	Short: "Start the KiwiFS MCP server (stdio transport)",
	Long: `Start a Model Context Protocol server for KiwiFS.

The MCP server gives any AI agent (Claude, Cursor, custom) a structured
tool interface to KiwiFS — read, write, search, query metadata — over
the standard MCP protocol.

Two modes:
  --root  <path>   In-process mode — opens the knowledge directory directly
  --remote <url>   Proxy mode — talks to a running KiwiFS server over REST`,
	Example: `  kiwifs mcp --root ~/knowledge
  kiwifs mcp --remote http://localhost:3333
  kiwifs mcp --remote http://kiwifs.example.com:3333 --api-key $KIWI_API_KEY`,
	RunE: runMCP,
}

func init() {
	mcpCmd.Flags().String("root", "", "knowledge root directory (in-process mode)")
	mcpCmd.Flags().String("remote", "", "KiwiFS server URL (proxy mode)")
	mcpCmd.Flags().String("api-key", "", "API key for remote server")
	mcpCmd.Flags().String("space", "default", "space to scope operations to")
}

func runMCP(cmd *cobra.Command, args []string) error {
	root, _ := cmd.Flags().GetString("root")
	remote, _ := cmd.Flags().GetString("remote")
	apiKey, _ := cmd.Flags().GetString("api-key")
	space, _ := cmd.Flags().GetString("space")

	if root == "" && remote == "" {
		return fmt.Errorf("exactly one of --root or --remote is required")
	}
	if root != "" && remote != "" {
		return fmt.Errorf("--root and --remote are mutually exclusive — pick one")
	}
	if root != "" && space != "default" && cmd.Flags().Changed("space") {
		return fmt.Errorf("--space is only meaningful with --remote; local mode operates on the --root directory directly")
	}

	return mcpserver.Serve(mcpserver.Options{
		Remote: remote,
		Root:   root,
		APIKey: apiKey,
		Space:  space,
	})
}
