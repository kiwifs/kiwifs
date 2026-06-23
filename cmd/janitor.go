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
  - external-link-rot — external URL returned 4xx/5xx (when enabled)
  - no-review-date — has owner but no next-review
  - decision-found — meeting note contains decision language

  - expired-memory — memory past expires_at or ttl
  - execution-stale — runbook not executed recently or last run failed

Runbook execution staleness is opt-in via .kiwi/config.toml:

  [janitor.execution_staleness]
  directory = "runbooks/"
  date_field = "last_executed"
  max_age_days = 90

  [janitor.execution_staleness.flag_values]
  last_outcome = "failure"

Files under directory with date_field older than max_age_days are flagged.
Any flag_values match (e.g. last_outcome = failure) is flagged regardless of
age. max_age_days falls back to stale_days when unset; date_field defaults to
last_executed. The same rule applies to kiwifs check and GET /api/kiwi/janitor.

External link rot is opt-in via .kiwi/config.toml:

  external_link_check = true
  external_link_timeout = "5s"
  external_link_ignore = ["localhost", "127.0.0.1", "example.com"]
  external_link_cache_ttl = "24h"

Broken outbound URLs appear in external_links on GET /api/kiwi/janitor (not mixed
into issues). Use ?fresh=true for a synchronous recheck.

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
