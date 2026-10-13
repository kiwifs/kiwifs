package cmd

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/kiwifs/kiwifs/internal/bootstrap"
	"github.com/kiwifs/kiwifs/internal/config"
	"github.com/kiwifs/kiwifs/internal/lockdir"
	"github.com/kiwifs/kiwifs/internal/refactor"
	"github.com/kiwifs/kiwifs/internal/storage"
	"github.com/spf13/cobra"
)

var refactorCmd = &cobra.Command{
	Use:   "refactor",
	Short: "Move and merge pages without breaking links",
	Long: `Restructure a knowledge base from a manifest of moves and merges.

Every reference to a moved page is rewritten in the style it was written in
(full path, short name, relative, markdown link, table cell), comments and
personal state follow their pages, and the plan is checked so that every link
that worked before still reaches the same page afterwards.

Manifest (YAML or JSON):

  moves:
    - from: guides/old-name.md      # a file
      to:   guides/new-name.md
    - from: drafts                  # a folder and everything in it
      to:   archive/drafts/
    - from: notes/*-meeting.md      # a glob, into a folder
      to:   meetings/
  merges:
    - from: faq/duplicate.md        # deleted; links, comments, state go to into
      into: faq/canonical.md
  delete_empty_dirs: true`,
}

var refactorPlanCmd = &cobra.Command{
	Use:   "plan MANIFEST",
	Short: "Preview a restructuring without writing anything",
	Args:  cobra.ExactArgs(1),
	RunE:  runRefactorPlan,
}

var refactorApplyCmd = &cobra.Command{
	Use:   "apply MANIFEST",
	Short: "Apply a restructuring as one commit",
	Long: `Builds the plan, shows it, asks for confirmation, and applies it.

If a kiwifs server is serving --root, the change is sent to that server so its
index and live readers stay consistent; otherwise it is applied directly.`,
	Args: cobra.ExactArgs(1),
	RunE: runRefactorApply,
}

func init() {
	for _, c := range []*cobra.Command{refactorPlanCmd, refactorApplyCmd} {
		c.Flags().StringP("root", "r", "./knowledge", "knowledge root directory")
		c.Flags().Bool("json", false, "print the plan as JSON")
		c.Flags().BoolP("verbose", "v", false, "list every rewritten link")
	}
	refactorApplyCmd.Flags().BoolP("yes", "y", false, "apply without asking")
	refactorApplyCmd.Flags().String("server", "", "server URL (default: http://127.0.0.1:<port from config>)")
	refactorApplyCmd.Flags().String("api-key", os.Getenv("KIWI_API_KEY"), "API key for the server")
	refactorApplyCmd.Flags().String("actor", "cli:refactor", "actor recorded in the commit")
	refactorCmd.AddCommand(refactorPlanCmd, refactorApplyCmd)
	rootCmd.AddCommand(refactorCmd)
}

func loadRefactorPlan(cmd *cobra.Command, manifestPath string) (string, *refactor.Manifest, *refactor.Plan, error) {
	root, _ := cmd.Flags().GetString("root")
	abs, err := filepath.Abs(root)
	if err != nil {
		return "", nil, nil, err
	}
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		return "", nil, nil, err
	}
	m, err := refactor.ParseManifest(data)
	if err != nil {
		return "", nil, nil, err
	}
	store, err := storage.NewLocal(abs)
	if err != nil {
		return "", nil, nil, err
	}
	plan, err := refactor.BuildPlan(cmd.Context(), refactor.Workspace{Root: abs, Store: store}, m)
	if err != nil {
		return "", nil, nil, err
	}
	return abs, m, plan, nil
}

func showPlan(cmd *cobra.Command, plan *refactor.Plan) error {
	asJSON, _ := cmd.Flags().GetBool("json")
	verbose, _ := cmd.Flags().GetBool("verbose")
	out := cmd.OutOrStdout()
	if asJSON {
		enc := json.NewEncoder(out)
		enc.SetIndent("", "  ")
		return enc.Encode(plan)
	}
	printPlan(out, plan, verbose)
	return nil
}

func printPlan(w io.Writer, plan *refactor.Plan, verbose bool) {
	if len(plan.Errors) > 0 {
		fmt.Fprintf(w, "The plan has %d error(s) and cannot be applied:\n", len(plan.Errors))
		for _, e := range plan.Errors {
			fmt.Fprintf(w, "  %s\n", e)
		}
		return
	}
	if len(plan.Moves) > 0 {
		fmt.Fprintf(w, "Move (%d):\n", len(plan.Moves))
		for _, m := range plan.Moves {
			fmt.Fprintf(w, "  %s → %s\n", m.From, m.To)
		}
	}
	if len(plan.Merges) > 0 {
		fmt.Fprintf(w, "Merge (%d):\n", len(plan.Merges))
		for _, m := range plan.Merges {
			fmt.Fprintf(w, "  %s → %s\n", m.From, m.To)
		}
	}
	if len(plan.Edits) > 0 {
		fmt.Fprintf(w, "Relink %d links in %d pages:\n", plan.Stats.Rewritten, len(plan.Edits))
		for _, e := range plan.Edits {
			fmt.Fprintf(w, "  %s (%d)\n", e.Path, len(e.Links))
			if verbose {
				for _, l := range e.Links {
					fmt.Fprintf(w, "    %d: %s → %s\n", l.Line, l.Old, l.New)
				}
			}
		}
	}
	if len(plan.Comments) > 0 {
		fmt.Fprintf(w, "Comments follow %d pages.\n", len(plan.Comments))
	}
	for _, s := range plan.State {
		fmt.Fprintf(w, "Personal state %s: %d paths updated\n", s.File, s.Changes)
		for _, c := range s.Conflicts {
			fmt.Fprintf(w, "  conflict: %s\n", c)
		}
	}
	if len(plan.RemovedDirs) > 0 {
		fmt.Fprintf(w, "Remove empty folders: %s\n", strings.Join(plan.RemovedDirs, ", "))
	}
	fmt.Fprintf(w, "Checked %d links in %d pages (%d already pointed nowhere and are left as written). Plan %s.\n",
		plan.Stats.Links, plan.Stats.Pages, plan.Stats.Unresolved, plan.Digest)
}

func runRefactorPlan(cmd *cobra.Command, args []string) error {
	_, _, plan, err := loadRefactorPlan(cmd, args[0])
	if err != nil {
		return err
	}
	if err := showPlan(cmd, plan); err != nil {
		return err
	}
	if len(plan.Errors) > 0 {
		os.Exit(1)
	}
	return nil
}

func runRefactorApply(cmd *cobra.Command, args []string) error {
	abs, m, plan, err := loadRefactorPlan(cmd, args[0])
	if err != nil {
		return err
	}
	if err := showPlan(cmd, plan); err != nil {
		return err
	}
	if len(plan.Errors) > 0 {
		os.Exit(1)
	}
	if yes, _ := cmd.Flags().GetBool("yes"); !yes {
		fmt.Fprint(cmd.OutOrStdout(), "Apply this plan? [y/N] ")
		answer, _ := bufio.NewReader(cmd.InOrStdin()).ReadString('\n')
		if a := strings.ToLower(strings.TrimSpace(answer)); a != "y" && a != "yes" {
			return fmt.Errorf("not applied")
		}
	}
	actor, _ := cmd.Flags().GetString("actor")

	lock, lockErr := lockdir.Acquire(abs)
	if lockErr != nil {
		return applyViaServer(cmd, abs, m, plan.Digest, actor)
	}
	defer lock.Release()

	cfg, err := config.Load(abs)
	if err != nil {
		cfg = &config.Config{}
		cfg.Storage.Root = abs
	}
	stack, err := bootstrap.Build("refactor", abs, cfg)
	if err != nil {
		return fmt.Errorf("bootstrap: %w", err)
	}
	defer stack.Close()
	fresh, err := refactor.BuildPlan(cmd.Context(), refactor.Workspace{Root: abs, Store: stack.Pipeline.Store}, m)
	if err != nil {
		return err
	}
	if fresh.Digest != plan.Digest {
		return fmt.Errorf("the workspace changed while you were reviewing; run plan again")
	}
	res, err := stack.Pipeline.ApplyRefactor(cmd.Context(), fresh, actor)
	if err != nil {
		return err
	}
	fmt.Fprintf(cmd.OutOrStdout(), "Applied: %d files written, %d removed, %d comment/state files updated, %d folders removed.\n",
		res.Written, res.Deleted, res.Side, res.Dirs)
	return nil
}

func applyViaServer(cmd *cobra.Command, root string, m *refactor.Manifest, digest, actor string) error {
	server, _ := cmd.Flags().GetString("server")
	if server == "" {
		port := 3333
		if cfg, err := config.Load(root); err == nil && cfg.Server.Port != 0 {
			port = cfg.Server.Port
		}
		server = fmt.Sprintf("http://127.0.0.1:%d", port)
	}
	body, err := json.Marshal(map[string]any{"manifest": m, "digest": digest})
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(cmd.Context(), 5*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(server, "/")+"/api/kiwi/refactor/apply", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Actor", actor)
	if key, _ := cmd.Flags().GetString("api-key"); key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("a kiwifs server holds %s but %s did not answer: %w", root, server, err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("server refused (%s): %s", resp.Status, strings.TrimSpace(string(respBody)))
	}
	var out struct {
		Applied struct {
			Written int `json:"written"`
			Deleted int `json:"deleted"`
			Side    int `json:"side_files"`
			Dirs    int `json:"removed_dirs"`
		} `json:"applied"`
	}
	_ = json.Unmarshal(respBody, &out)
	fmt.Fprintf(cmd.OutOrStdout(), "Applied by %s: %d files written, %d removed, %d comment/state files updated, %d folders removed.\n",
		server, out.Applied.Written, out.Applied.Deleted, out.Applied.Side, out.Applied.Dirs)
	return nil
}
