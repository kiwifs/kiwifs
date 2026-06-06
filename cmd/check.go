package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/kiwifs/kiwifs/internal/janitor"
	"github.com/kiwifs/kiwifs/internal/search"
	"github.com/kiwifs/kiwifs/internal/storage"
	"github.com/spf13/cobra"
)

var checkCmd = &cobra.Command{
	Use:   "check",
	Short: "CI-friendly knowledge base hygiene scan",
	Long: `Run the janitor scan with stable exit codes for CI pipelines.

Exit codes:
  0 — no error-severity issues (and no warnings when --fail-on-warn)
  1 — hygiene issues found
  2 — scan failure (bad root, unreadable files)

Delegates to the same checks as kiwifs janitor: stale pages, orphans,
broken links, missing metadata, expired memory, and more.`,
	Example: `  kiwifs check --root ./knowledge
  kiwifs check --root ./knowledge --json
  kiwifs check --root ./knowledge --fail-on-warn`,
	RunE: runCheck,
}

func init() {
	checkCmd.Flags().StringP("root", "r", "./knowledge", "knowledge root directory")
	checkCmd.Flags().Int("stale-days", 90, "days before a page is considered stale")
	checkCmd.Flags().Bool("json", false, "emit JSON instead of the human summary")
	checkCmd.Flags().Bool("fail-on-warn", false, "exit 1 when warnings are present, not only errors")
	rootCmd.AddCommand(checkCmd)
}

func runKnowledgeScan(cmd *cobra.Command) (*janitor.ScanResult, string, int, bool, error) {
	root, _ := cmd.Flags().GetString("root")
	staleDays, _ := cmd.Flags().GetInt("stale-days")
	asJSON, _ := cmd.Flags().GetBool("json")

	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, "", 0, asJSON, fmt.Errorf("check: %w", err)
	}

	if info, statErr := os.Stat(abs); statErr != nil || !info.IsDir() {
		return nil, abs, 0, asJSON, fmt.Errorf("check: root directory does not exist or is not a directory: %s", abs)
	}

	store, err := storage.NewLocal(abs)
	if err != nil {
		return nil, "", 0, asJSON, fmt.Errorf("check: open storage: %w", err)
	}
	var searcher search.Searcher
	sq, sqerr := search.NewSQLite(abs, store)
	if sqerr == nil {
		defer sq.Close()
		searcher = sq
	}

	scanner := janitor.New(abs, store, searcher, staleDays)
	result, err := scanner.Scan(cmd.Context())
	if err != nil {
		return nil, abs, staleDays, asJSON, fmt.Errorf("check: %w", err)
	}
	return result, abs, staleDays, asJSON, nil
}

func runCheck(cmd *cobra.Command, args []string) error {
	result, _, _, asJSON, err := runKnowledgeScan(cmd)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}

	failOnWarn, _ := cmd.Flags().GetBool("fail-on-warn")

	if asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(result); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(2)
		}
	} else {
		fmt.Print(result.Summary())
	}

	if result.HasErrors() || (failOnWarn && result.HasWarnings()) {
		os.Exit(1)
	}
	return nil
}
