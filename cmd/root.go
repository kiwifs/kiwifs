package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

// Version is set by main.go during initialization
var Version = "dev"

var rootCmd = &cobra.Command{
	Use:   "kiwifs",
	Short: "KiwiFS — markdown filesystem for agents and teams",
	Long: `KiwiFS is a markdown filesystem for agents and teams.
Searchable. Structured. Versioned. One binary, zero config.

Agents write markdown. Humans read in the web UI. Git versions everything.`,
}

func Execute() {
	// Set version here to ensure it's picked up after ldflags have been applied
	rootCmd.Version = Version
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func init() {
	rootCmd.PersistentPreRun = func(cmd *cobra.Command, args []string) {
		// Async version check on every invocation (non-blocking, cached 24h)
		if cmd.Name() != "update" {
			CheckVersionAsync()
		}
	}

	rootCmd.AddCommand(serveCmd)
	rootCmd.AddCommand(initCmd)
	rootCmd.AddCommand(mountCmd)
	rootCmd.AddCommand(mcpCmd)
	rootCmd.AddCommand(backupCmd)
	rootCmd.AddCommand(restoreCmd)
	rootCmd.AddCommand(rulesCmd)
	rootCmd.AddCommand(connectCmd)
	rootCmd.AddCommand(loginCmd)
	rootCmd.AddCommand(logoutCmd)
	rootCmd.AddCommand(whoamiCmd)
	rootCmd.AddCommand(updateCmd)
	rootCmd.AddCommand(modelCmd)
}
