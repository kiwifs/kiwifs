package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/kiwifs/kiwifs/internal/config"
	"github.com/kiwifs/kiwifs/internal/eval"
	"github.com/kiwifs/kiwifs/internal/search"
	"github.com/kiwifs/kiwifs/internal/storage"
	"github.com/kiwifs/kiwifs/internal/vectorstore"
	"github.com/spf13/cobra"
)

var evalCmd = &cobra.Command{
	Use:   "eval",
	Short: "Measure retrieval quality against a golden set",
	Long: `Run a held-out retrieval evaluation and print Hit Rate, MRR, Precision@K
and nDCG@K for the FTS5 index and, when configured, the vector index.

Golden sets live in <root>/.kiwi/eval/ as a pair of files:

  <name>.qrels    TREC relevance judgements — "query_id 0 doc_path relevance"
                  (the three-column "query_id doc_path relevance" form also works)
  <name>.topics   query text — "query_id<TAB>the question"

TREC qrels is the interchange format ranx, trec_eval and pytrec_eval already
read, so the same files score runs from outside kiwifs with no converter.

--exclude-prefix hides a subtree from retrieval before ranking, which is what
makes leave-one-out evaluation meaningful: the held-out material cannot be
retrieved, and the K result slots are filled by the next-best eligible pages
rather than left short. Repeat the flag for each subtree — material about one
topic rarely lives under a single directory. Queries whose entire relevant set
is excluded are skipped and reported, not scored as failures.

Exits non-zero if a metric threshold is set and not met, so this gates CI.`,
	Example: `  kiwifs eval --set leave-one-out
  kiwifs eval --set leave-one-out --exclude-prefix competitions/playground-series-s5e4/
  kiwifs eval --set leave-one-out -x competitions/s5e4/ -x sources/kaggle-writeups/ --top-k 10
  kiwifs eval --list
  kiwifs eval --set leave-one-out --format json --min-hit-rate 0.6`,
	RunE: runEval,
}

func init() {
	evalCmd.Flags().StringP("root", "r", "./knowledge", "knowledge root directory")
	evalCmd.Flags().String("set", "", "golden set name under .kiwi/eval/")
	evalCmd.Flags().StringSliceP("exclude-prefix", "x", nil, "path prefix to hide from retrieval before ranking (repeatable)")
	evalCmd.Flags().Int("top-k", eval.DefaultTopK, "rank cutoff for every metric")
	evalCmd.Flags().String("format", "text", "output format: text or json")
	evalCmd.Flags().Bool("list", false, "list the golden sets under .kiwi/eval/ and exit")
	evalCmd.Flags().Float64("min-hit-rate", 0, "exit non-zero if the best engine's hit rate falls below this")
	evalCmd.Flags().Float64("min-mrr", 0, "exit non-zero if the best engine's MRR falls below this")
	evalCmd.Flags().Float64("min-ndcg", 0, "exit non-zero if the best engine's nDCG falls below this")
	rootCmd.AddCommand(evalCmd)
}

func runEval(cmd *cobra.Command, args []string) error {
	root, _ := cmd.Flags().GetString("root")
	setName, _ := cmd.Flags().GetString("set")
	excludePrefix, _ := cmd.Flags().GetStringSlice("exclude-prefix")
	topK, _ := cmd.Flags().GetInt("top-k")
	format, _ := cmd.Flags().GetString("format")
	listOnly, _ := cmd.Flags().GetBool("list")

	if listOnly {
		sets, err := eval.ListSets(root)
		if err != nil {
			return fmt.Errorf("list eval sets: %w", err)
		}
		if len(sets) == 0 {
			fmt.Printf("No golden sets in %s/%s\n", root, eval.EvalDir)
			return nil
		}
		for _, s := range sets {
			fmt.Println(s)
		}
		return nil
	}

	queries, err := eval.Resolve(root, eval.Request{Set: setName})
	if err != nil {
		return err
	}

	store, err := storage.NewLocal(root)
	if err != nil {
		return fmt.Errorf("open storage: %w", err)
	}
	cfg, cerr := config.Load(root)
	if cerr != nil {
		cfg = &config.Config{}
	}
	sq, err := search.NewSQLiteWithTypedFields(root, store, cfg.Links.TypedLinkFields(), cfg.Dataview.CustomFields)
	if err != nil {
		return fmt.Errorf("open sqlite index: %w", err)
	}
	defer sq.Close()

	// A missing vector index is not an error: the FTS numbers are still worth
	// having, and CI on a machine without an embedding provider should not
	// fail the build over it.
	var vectors *vectorstore.Service
	if cerr == nil && cfg.Search.Vector.Enabled {
		vs, verr := vectorstore.Build(root, store, cfg.Search.Vector)
		if verr != nil {
			log.Printf("vector: skipped — build failed (%v)", verr)
		} else if vs != nil {
			defer vs.Close()
			vectors = vs
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	report, err := eval.Run(ctx, queries, eval.DefaultEngines(sq, vectors), eval.Options{
		TopK:            topK,
		ExcludePrefixes: excludePrefix,
	})
	if err != nil {
		return fmt.Errorf("eval: %w", err)
	}

	if format == "json" {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(report); err != nil {
			return err
		}
	} else {
		fmt.Print(renderEvalReport(report, setName))
	}
	return checkEvalThresholds(cmd, report)
}

func renderEvalReport(report *eval.Report, setName string) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "Golden set: %s\n", setName)
	fmt.Fprintf(&sb, "top_k: %d\n", report.TopK)
	if len(report.ExcludePrefixes) > 0 {
		fmt.Fprintf(&sb, "excluded before ranking: %s\n", strings.Join(report.ExcludePrefixes, ", "))
	}
	sb.WriteString("\n")
	fmt.Fprintf(&sb, "%-10s %8s %8s %10s %8s %8s\n", "engine", "hit", "mrr", fmt.Sprintf("p@%d", report.TopK), "ndcg", "queries")
	for _, name := range report.EngineOrder {
		m := report.Metrics(name)
		fmt.Fprintf(&sb, "%-10s %8.4f %8.4f %10.4f %8.4f %8d\n", name, m.HitRate, m.MRR, m.PrecisionAtK, m.NDCG, m.Queries)
	}
	if len(report.Skipped) > 0 {
		fmt.Fprintf(&sb, "\nSkipped %d queries:\n", len(report.Skipped))
		for _, s := range report.Skipped {
			fmt.Fprintf(&sb, "  %s — %s\n", s.Question, s.Reason)
		}
	}
	if report.Errors > 0 {
		fmt.Fprintf(&sb, "\n%d search errors (scored as misses)\n", report.Errors)
	}
	return sb.String()
}

// checkEvalThresholds compares the best engine against the --min-* floors.
// Best rather than every engine: the point of a CI gate is that retrieval as
// a whole still works, and an unconfigured vector index scoring 0 should not
// fail a build that never had one.
func checkEvalThresholds(cmd *cobra.Command, report *eval.Report) error {
	type threshold struct {
		flag string
		name string
		get  func(eval.Metrics) float64
	}
	checks := []threshold{
		{"min-hit-rate", "hit rate", func(m eval.Metrics) float64 { return m.HitRate }},
		{"min-mrr", "MRR", func(m eval.Metrics) float64 { return m.MRR }},
		{"min-ndcg", "nDCG", func(m eval.Metrics) float64 { return m.NDCG }},
	}
	for _, c := range checks {
		floor, _ := cmd.Flags().GetFloat64(c.flag)
		if floor <= 0 {
			continue
		}
		best := 0.0
		bestEngine := ""
		for _, name := range report.EngineOrder {
			if v := c.get(report.Metrics(name)); v > best || bestEngine == "" {
				best, bestEngine = v, name
			}
		}
		if best < floor {
			return fmt.Errorf("%s %.4f (%s) is below --%s %.4f", c.name, best, bestEngine, c.flag, floor)
		}
	}
	return nil
}
