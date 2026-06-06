package cmd

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var janitorCmd = &cobra.Command{
	Use:   "janitor",
	Short: "Scan a knowledge base for stale, orphaned, or broken pages",
	Long: `Scan the knowledge folder at --root for hygiene issues.

Reports:
  - stale          — page not reviewed within --stale-days
  - orphan         — page with no inbound wiki links
  - duplicate      — pages with identical titles
  - contradiction  — conflicting source-of-truth claims
  - missing-owner  — page without an owner field
  - missing-status — page without a status field
  - empty-page     — page with < 50 chars of content
  - broken-link    — wiki link target doesn't exist
  - no-review-date — has owner but no next-review
  - decision-found — meeting note contains decision language

Exits 0 on a clean run, 1 if any error-severity issues are found.`,
	Example: `  kiwifs janitor --root ~/my-knowledge
  kiwifs janitor --root /data/knowledge --stale-days 60 --json`,
	RunE: runJanitor,
}

func init() {
	janitorCmd.Flags().StringP("root", "r", "./knowledge", "knowledge root directory")
	janitorCmd.Flags().Int("stale-days", 90, "days before a page is considered stale")
	janitorCmd.Flags().Bool("json", false, "emit JSON instead of the human summary")
	rootCmd.AddCommand(janitorCmd)
}

func runJanitor(cmd *cobra.Command, args []string) error {
	result, _, _, asJSON, err := runKnowledgeScan(cmd)
	if err != nil {
		return err
	}

	if asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(result); err != nil {
			return err
		}
	} else {
		fmt.Print(result.Summary())
	}

	if result.HasErrors() {
		errCount := 0
		for _, is := range result.Issues {
			if is.Severity == "error" {
				errCount++
			}
		}
		return fmt.Errorf("janitor: %d error-severity issue(s) found", errCount)
	}
	return nil
}
