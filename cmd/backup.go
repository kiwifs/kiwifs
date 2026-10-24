package cmd

import (
	"errors"
	"fmt"
	"io/fs"
	"log"

	"github.com/kiwifs/kiwifs/internal/backup"
	"github.com/kiwifs/kiwifs/internal/config"
	"github.com/kiwifs/kiwifs/internal/spaces"
	"github.com/spf13/cobra"
)

var backupCmd = &cobra.Command{
	Use:   "backup",
	Short: "Push the knowledge repo to a git remote",
	Example: `  kiwifs backup --root /data/knowledge
  kiwifs backup --root /data/knowledge --remote git@github.com:user/kb.git
  kiwifs backup --root /data/knowledge --space agent-a`,
	RunE: runBackup,
}

func init() {
	backupCmd.Flags().StringP("root", "r", "./knowledge", "knowledge root directory")
	backupCmd.Flags().String("space", "", "back up this space instead of the primary (looked up in [[spaces]] or .kiwi/spaces.json under --root)")
	backupCmd.Flags().String("remote", "", "git remote URL (overrides config)")
	backupCmd.Flags().String("branch", "", "branch to push (default: current branch)")
	backupCmd.Flags().Bool("rebase-before-push", true, "fetch and rebase onto the backup branch before pushing")
}

func runBackup(cmd *cobra.Command, args []string) error {
	root, _ := cmd.Flags().GetString("root")
	spaceName, _ := cmd.Flags().GetString("space")
	remote, _ := cmd.Flags().GetString("remote")
	branch, _ := cmd.Flags().GetString("branch")
	rebaseBeforePush, _ := cmd.Flags().GetBool("rebase-before-push")

	cfg, err := config.Load(root)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			log.Printf("warning: could not load config (%v)", err)
		}
		cfg = nil
	}

	var bc config.BackupConfig
	if spaceName != "" {
		spaceRoot, spaceBackup, err := spaces.LookupBackup(root, cfg, spaceName)
		if err != nil {
			return err
		}
		if err := backup.RequireRepoRoot(spaceRoot); err != nil {
			return fmt.Errorf("space %q: %w", spaceName, err)
		}
		root, bc = spaceRoot, spaceBackup
	} else if cfg != nil {
		bc = cfg.Backup
	}

	if remote == "" {
		remote = bc.Remote
		if branch == "" {
			branch = bc.Branch
		}
		if !cmd.Flags().Changed("rebase-before-push") {
			rebaseBeforePush = bc.IsRebaseBeforePush()
		}
	}
	if remote == "" {
		if spaceName != "" {
			return fmt.Errorf("no backup remote configured for space %q — pass --remote, or set [spaces.backup] remote or [backup] remote in the space's .kiwi/config.toml", spaceName)
		}
		return fmt.Errorf("no backup remote configured — pass --remote or set [backup] remote in .kiwi/config.toml")
	}

	syncer, err := backup.New(root, remote, branch, "", rebaseBeforePush)
	if err != nil {
		return err
	}
	return syncer.Push(branch)
}
