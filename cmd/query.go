package cmd

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/kiwifs/kiwifs/internal/config"
	"github.com/kiwifs/kiwifs/internal/dataview"
	"github.com/kiwifs/kiwifs/internal/search"
	"github.com/kiwifs/kiwifs/internal/storage"
	"github.com/spf13/cobra"
)

var queryCmd = &cobra.Command{
	Use:   "query",
	Short: "Run a DQL query against the knowledge base",
	Long: `Execute a Dataview Query Language (DQL) statement against the file_meta
index. Supports TABLE, LIST, COUNT, DISTINCT queries with WHERE filters,
SORT, GROUP BY, FLATTEN, and pagination.

The query runs against the SQLite index at <root>/.kiwi/state/search.db.
If the index is empty, run 'kiwifs reindex' first.`,
	Example: `  kiwifs query 'TABLE name, status FROM "students/" WHERE status = "active"'
  kiwifs query 'COUNT WHERE status = "active"'
  kiwifs query 'DISTINCT status' --format list
  kiwifs query 'LIST FROM "concepts/" SORT _updated DESC' --limit 10`,
	Args: cobra.ExactArgs(1),
	RunE: runQuery,
}

func init() {
	queryCmd.Flags().StringP("root", "r", "./knowledge", "knowledge root directory")
	queryCmd.Flags().String("format", "table", "output format: table, list, json, count")
	queryCmd.Flags().Int("limit", 0, "max results (overrides query LIMIT)")
	queryCmd.Flags().String("sort", "", "sort field (overrides query SORT)")
	queryCmd.Flags().String("order", "", "sort order: asc or desc")
	rootCmd.AddCommand(queryCmd)
}

func runQuery(cmd *cobra.Command, args []string) error {
	root, _ := cmd.Flags().GetString("root")
	format, _ := cmd.Flags().GetString("format")
	limit, _ := cmd.Flags().GetInt("limit")

	store, err := storage.NewLocal(root)
	if err != nil {
		return fmt.Errorf("open storage: %w", err)
	}
	sq, err := search.NewSQLite(root, store)
	if err != nil {
		return fmt.Errorf("open sqlite index: %w", err)
	}
	defer sq.Close()

	exec := dataview.NewExecutor(sq.ReadDB())

	timeout := 5 * time.Second
	maxRows := 10000
	if cfg, err := config.Load(root); err == nil {
		if t, err := time.ParseDuration(cfg.Dataview.QueryTimeout); err == nil && t > 0 {
			timeout = t
		}
		if cfg.Dataview.MaxScanRows > 0 {
			maxRows = cfg.Dataview.MaxScanRows
		}
	}
	exec.SetLimits(maxRows, timeout)

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	dql := strings.TrimSpace(args[0])
	result, err := exec.Query(ctx, dql, limit, 0)
	if err != nil {
		return fmt.Errorf("query: %w", err)
	}

	// Auto-detect format from query type if not specified
	if format == "" || format == "table" {
		plan, perr := dataview.ParseQuery(dql)
		if perr == nil {
			switch plan.Type {
			case "count":
				format = "count"
			case "distinct":
				format = "distinct"
			default:
				format = "table"
			}
		}
	}

	fmt.Print(dataview.Render(result, format))
	return nil
}
