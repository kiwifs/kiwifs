package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/kiwifs/kiwifs/internal/config"
	"github.com/kiwifs/kiwifs/internal/janitor"
	"github.com/kiwifs/kiwifs/internal/pipeline"
	"github.com/kiwifs/kiwifs/internal/search"
	"github.com/kiwifs/kiwifs/internal/storage"
	"github.com/spf13/cobra"
)

var checkCmd = &cobra.Command{
	Use:   "check",
	Short: "CI-friendly knowledge base hygiene and integrity scan",
	Long: `Run integrity checks against the knowledge base at --root.

Hygiene (janitor): stale pages, orphans, broken links, missing metadata,
expired memory, and more.

Sequences: when [sequences] is configured in .kiwi/config.toml, scans for
<!-- seq:N --> markers and reports gaps in configured directories.

Exit codes:
  0 — no error-severity issues (and no warnings when --fail-on-warn)
  1 — hygiene or sequence issues found
  2 — scan failure (bad root, unreadable files)`,
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

	scanner := janitor.New(abs, store, searcher, staleDays, janitorOptsFromConfig(abs)...)
	result, err := scanner.Scan(cmd.Context())
	if err != nil {
		return nil, abs, staleDays, asJSON, fmt.Errorf("check: %w", err)
	}
	return result, abs, staleDays, asJSON, nil
}

func janitorOptsFromConfig(root string) []janitor.Option {
	cfg, err := config.Load(root)
	if err != nil {
		return nil
	}
	var opts []janitor.Option
	if cfg.Janitor.ExecutionStaleness.Enabled() {
		es := cfg.Janitor.ExecutionStaleness
		opts = append(opts, janitor.OptionsFromExecutionStaleness(es.Directory, es.DateField, es.MaxAgeDays, es.FlagValues)...)
	}
	if cfg.Janitor.ExternalLinkCheckEnabled() {
		linkCfg := janitor.ExternalLinkCheckConfigFromJanitor(cfg.Janitor)
		linkCfg.Background = false
		opts = append(opts, janitor.WithExternalLinks(root, linkCfg))
	}
	return opts
}

type checkOutput struct {
	Janitor   *janitor.ScanResult `json:"janitor"`
	Sequences []string            `json:"sequences,omitempty"`
}

func runCheck(cmd *cobra.Command, args []string) error {
	code := runCheckWithCode(cmd, args)
	if code != 0 {
		os.Exit(code)
	}
	return nil
}

// runCheckWithCode runs hygiene + sequence checks and returns an exit code
// (0 ok, 1 issues found, 2 scan failure). Tests use this instead of runCheck
// to avoid os.Exit.
func runCheckWithCode(cmd *cobra.Command, args []string) int {
	result, abs, _, asJSON, err := runKnowledgeScan(cmd)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}

	directories := []string(nil)
	cfg, cfgErr := config.Load(abs)
	if cfgErr == nil {
		directories = cfg.Sequences.Directories
	}

	var seqIssues []string
	if len(directories) > 0 {
		seqIssues, err = pipeline.CheckSequenceGaps(abs, directories)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 2
		}
	}

	failOnWarn, _ := cmd.Flags().GetBool("fail-on-warn")

	if asJSON {
		out := checkOutput{Janitor: result}
		if len(seqIssues) > 0 {
			out.Sequences = seqIssues
		}
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(out); err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 2
		}
	} else {
		fmt.Print(result.Summary())
		if len(seqIssues) > 0 {
			fmt.Println("Sequence gaps:")
			for _, issue := range seqIssues {
				fmt.Println(issue)
			}
		}
	}

	janitorFailed := result.HasErrors() || (failOnWarn && result.HasWarnings())
	seqFailed := len(seqIssues) > 0
	if janitorFailed || seqFailed {
		return 1
	}
	return 0
}
