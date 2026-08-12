package cmd

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/kiwifs/kiwifs/internal/config"
	"github.com/kiwifs/kiwifs/internal/links"
	"github.com/kiwifs/kiwifs/internal/search"
	"github.com/kiwifs/kiwifs/internal/storage"
	"github.com/kiwifs/kiwifs/internal/vectorstore"
	"github.com/spf13/cobra"
)

var reindexCmd = &cobra.Command{
	Use:   "reindex",
	Short: "Rebuild the search index from files",
	Long: `Rebuild the SQLite FTS5 search index at <root>/.kiwi/state/search.db
and, when vector search is configured, the vector index too.

Safety net for corruption or migration: walks every .md file under --root,
truncates the index, and re-inserts. The knowledge files on disk are the
source of truth — the index is fully rebuildable from them.`,
	Example: `  kiwifs reindex --root ~/my-knowledge
  kiwifs reindex --root /data/knowledge
  kiwifs reindex --root /data/knowledge --vector   # also rebuild vector index`,
	RunE: runReindex,
}

func init() {
	reindexCmd.Flags().StringP("root", "r", "./knowledge", "knowledge root directory")
	reindexCmd.Flags().Bool("vector", false, "also rebuild the vector index (requires [search.vector] in config)")
	reindexCmd.Flags().Bool("fts-only", false, "skip the vector index even if configured")
	rootCmd.AddCommand(reindexCmd)
}

func runReindex(cmd *cobra.Command, args []string) error {
	root, _ := cmd.Flags().GetString("root")
	wantVector, _ := cmd.Flags().GetBool("vector")
	ftsOnly, _ := cmd.Flags().GetBool("fts-only")

	store, err := storage.NewLocal(root)
	if err != nil {
		return fmt.Errorf("open storage: %w", err)
	}

	// Load config before building the index, not just for the vector phase
	// below: typed link fields and custom computed fields come from it, and
	// building without them writes a thinner file_meta/links than the server
	// would for the same files.
	cfg, cerr := config.Load(root)
	if cerr != nil {
		if wantVector {
			return fmt.Errorf("load config: %w", cerr)
		}
		cfg = &config.Config{}
	}
	if dropped := links.InvalidTypedFieldNames(cfg.Links.TypedFields); len(dropped) > 0 {
		log.Printf("[links] typed_fields: ignoring invalid name(s) %s", strings.Join(dropped, ", "))
	}

	sq, err := search.NewSQLiteWithTypedFields(root, store, cfg.Links.TypedLinkFields(), cfg.Dataview.CustomFields)
	if err != nil {
		return fmt.Errorf("open sqlite index: %w", err)
	}
	defer sq.Close()

	start := time.Now()
	// Same 10-minute ceiling as the vector reindex below — a CLI
	// invocation lacks a request deadline, so we cap explicitly.
	ftsCtx, ftsCancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer ftsCancel()
	n, err := sq.Reindex(ftsCtx)
	if err != nil {
		return fmt.Errorf("reindex: %w", err)
	}
	fmt.Printf("FTS5: reindexed %d files in %s\n", n, time.Since(start).Round(time.Millisecond))

	if ftsOnly {
		return nil
	}

	// A config that failed to load cannot describe a vector store; --vector
	// already errored out above in that case.
	if cerr != nil {
		return nil
	}
	if !cfg.Search.Vector.Enabled {
		if wantVector {
			return fmt.Errorf("--vector set but [search.vector].enabled = false in config.toml")
		}
		return nil
	}
	vs, verr := vectorstore.Build(root, store, cfg.Search.Vector)
	if verr != nil {
		if wantVector {
			return fmt.Errorf("build vector store: %w", verr)
		}
		log.Printf("vector: skipped — build failed (%v)", verr)
		return nil
	}
	if vs == nil {
		return nil
	}
	defer vs.Close()

	vStart := time.Now()
	// Give the vector reindex a generous timeout: a network embedder
	// (OpenAI, Cohere, Bedrock) can take many minutes for a large
	// knowledge base, and a CLI invocation doesn't have a request
	// deadline. 10 minutes covers realistic bases; users on larger
	// corpora can break it up by running targeted Index calls.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	count, verr := vs.Reindex(ctx)
	if verr != nil {
		return fmt.Errorf("vector reindex: %w", verr)
	}
	fmt.Printf("vector: reindexed %d files in %s\n", count, time.Since(vStart).Round(time.Millisecond))
	return nil
}
