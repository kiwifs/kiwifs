package cmd

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"time"

	"github.com/spf13/cobra"
)

var restoreCmd = &cobra.Command{
	Use:   "restore",
	Short: "Restore a knowledge base from a git remote",
	Example: `  kiwifs restore --from git@github.com:user/kb.git --to /data/knowledge
  kiwifs restore --from git@github.com:user/kb.git --to /data/knowledge --branch main`,
	RunE: runRestore,
}

func init() {
	restoreCmd.Flags().String("from", "", "git remote URL to clone from (required)")
	restoreCmd.Flags().String("to", "", "local directory to restore into (required)")
	restoreCmd.Flags().String("branch", "", "branch to check out (default: remote default)")
	restoreCmd.MarkFlagRequired("from")
	restoreCmd.MarkFlagRequired("to")
}

func runRestore(cmd *cobra.Command, args []string) error {
	from, _ := cmd.Flags().GetString("from")
	to, _ := cmd.Flags().GetString("to")
	branch, _ := cmd.Flags().GetString("branch")

	if _, err := os.Stat(to); err == nil {
		entries, _ := os.ReadDir(to)
		if len(entries) > 0 {
			return fmt.Errorf("target directory %s exists and is not empty", to)
		}
	}

	cloneArgs := []string{"clone"}
	if branch != "" {
		cloneArgs = append(cloneArgs, "--branch", branch)
	}
	cloneArgs = append(cloneArgs, from, to)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	c := exec.CommandContext(ctx, "git", cloneArgs...)
	c.Stdout = os.Stdout
	var stderr bytes.Buffer
	c.Stderr = &stderr
	if err := c.Run(); err != nil {
		return fmt.Errorf("git clone: %w\n%s", err, stderr.String())
	}

	// Remove .kiwi/state/ if cloned — it will be rebuilt on first serve.
	stateDir := fmt.Sprintf("%s/.kiwi/state", to)
	os.RemoveAll(stateDir)

	fmt.Printf("Restored knowledge base to %s\n", to)
	fmt.Printf("Run: kiwifs serve --root %s\n", to)
	return nil
}
