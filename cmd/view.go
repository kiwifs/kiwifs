package cmd

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/kiwifs/kiwifs/internal/config"
	"github.com/kiwifs/kiwifs/internal/dataview"
	"github.com/kiwifs/kiwifs/internal/search"
	"github.com/kiwifs/kiwifs/internal/storage"
	"github.com/spf13/cobra"
)

var viewCmd = &cobra.Command{
	Use:   "view",
	Short: "Manage computed view files",
}

var viewRefreshCmd = &cobra.Command{
	Use:   "refresh <path>",
	Short: "Regenerate a computed view file",
	Long: `Force-regenerate a computed view file by re-running its kiwi-query
and replacing the body below the <!-- kiwi:auto --> marker.`,
	Example: `  kiwifs view refresh dashboards/struggling.md
  kiwifs view refresh --root ~/knowledge reports/active-students.md`,
	Args: cobra.ExactArgs(1),
	RunE: runViewRefresh,
}

var viewListCmd = &cobra.Command{
	Use:   "list",
	Short: "List all computed view files",
	Long:  `Scan the file_meta index for files with kiwi-view: true in frontmatter.`,
	RunE:  runViewList,
}

var viewCreateCmd = &cobra.Command{
	Use:   "create",
	Short: "Create a new computed view file",
	Long: `Create a markdown file with kiwi-view: true and the given query in
its frontmatter, then regenerate it immediately.`,
	Example: `  kiwifs view create --query 'TABLE name, status FROM "students/" WHERE status = "active"' --name "Active Students"
  kiwifs view create --query 'COUNT WHERE _word_count < 50' --name "Stub Pages" --path reports/`,
	RunE: runViewCreate,
}

func init() {
	viewCmd.PersistentFlags().StringP("root", "r", "./knowledge", "knowledge root directory")
	viewCreateCmd.Flags().String("query", "", "DQL query for the view (required)")
	viewCreateCmd.Flags().String("name", "", "view name (used as filename)")
	viewCreateCmd.Flags().String("path", "", "directory to create the view in (default: root)")
	viewCmd.AddCommand(viewRefreshCmd, viewListCmd, viewCreateCmd)
	rootCmd.AddCommand(viewCmd)
}

func openViewDeps(cmd *cobra.Command) (storage.Storage, *search.SQLite, *dataview.Executor, error) {
	root, _ := cmd.Flags().GetString("root")
	store, err := storage.NewLocal(root)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("open storage: %w", err)
	}
	sq, err := search.NewSQLite(root, store)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("open sqlite index: %w", err)
	}
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
	return store, sq, exec, nil
}

func runViewRefresh(cmd *cobra.Command, args []string) error {
	store, sq, exec, err := openViewDeps(cmd)
	if err != nil {
		return err
	}
	_ = store
	defer sq.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	changed, err := dataview.RegenerateView(ctx, store, exec, args[0])
	if err != nil {
		return fmt.Errorf("regenerate: %w", err)
	}
	if changed {
		fmt.Printf("Regenerated %s\n", args[0])
	} else {
		fmt.Printf("No changes to %s\n", args[0])
	}
	return nil
}

func runViewList(cmd *cobra.Command, args []string) error {
	store, sq, exec, err := openViewDeps(cmd)
	if err != nil {
		return err
	}
	_ = store
	defer sq.Close()

	reg := dataview.NewRegistry(exec, store)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := reg.Scan(ctx); err != nil {
		return fmt.Errorf("scan views: %w", err)
	}

	views := reg.ListViews()
	sort.Strings(views)
	if len(views) == 0 {
		fmt.Println("No computed views found.")
		return nil
	}
	for _, v := range views {
		fmt.Println(v)
	}
	return nil
}

func runViewCreate(cmd *cobra.Command, args []string) error {
	query, _ := cmd.Flags().GetString("query")
	name, _ := cmd.Flags().GetString("name")
	dir, _ := cmd.Flags().GetString("path")

	if query == "" {
		return fmt.Errorf("--query is required")
	}
	if name == "" {
		return fmt.Errorf("--name is required")
	}

	// Validate the query parses
	if _, err := dataview.ParseQuery(query); err != nil {
		return fmt.Errorf("invalid query: %w", err)
	}

	slug := strings.ToLower(strings.ReplaceAll(name, " ", "-"))
	filename := slug + ".md"
	if dir != "" {
		filename = strings.TrimSuffix(dir, "/") + "/" + filename
	}

	content := fmt.Sprintf(`---
kiwi-view: true
title: %s
kiwi-query: |
  %s
---
%s
`, name, query, dataview.ViewMarker())

	store, sq, exec, err := openViewDeps(cmd)
	if err != nil {
		return err
	}
	defer sq.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := store.Write(ctx, filename, []byte(content)); err != nil {
		return fmt.Errorf("write view file: %w", err)
	}
	fmt.Printf("Created view %s\n", filename)

	changed, err := dataview.RegenerateView(ctx, store, exec, filename)
	if err != nil {
		fmt.Fprintf(os.Stderr, "warning: regeneration failed: %v\n", err)
		return nil
	}
	if changed {
		fmt.Printf("Regenerated %s\n", filename)
	}
	return nil
}
