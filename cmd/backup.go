package cmd

import (
	"fmt"
	"log"

	"github.com/kiwifs/kiwifs/internal/backup"
	"github.com/kiwifs/kiwifs/internal/config"
	"github.com/spf13/cobra"
)

var backupCmd = &cobra.Command{
	Use:   "backup",
	Short: "Push the knowledge repo to a git remote",
	Example: `  kiwifs backup --root /data/knowledge
  kiwifs backup --root /data/knowledge --remote git@github.com:user/kb.git`,
	RunE: runBackup,
}

func init() {
	backupCmd.Flags().StringP("root", "r", "./knowledge", "knowledge root directory")
	backupCmd.Flags().String("remote", "", "git remote URL (overrides config)")
	backupCmd.Flags().String("branch", "", "branch to push (default: current branch)")
}

func runBackup(cmd *cobra.Command, args []string) error {
	root, _ := cmd.Flags().GetString("root")
	remote, _ := cmd.Flags().GetString("remote")
	branch, _ := cmd.Flags().GetString("branch")

	if remote == "" {
		cfg, err := config.Load(root)
		if err != nil {
			log.Printf("warning: could not load config (%v)", err)
		} else {
			if cfg.Backup.Remote != "" {
				remote = cfg.Backup.Remote
			}
			if branch == "" && cfg.Backup.Branch != "" {
				branch = cfg.Backup.Branch
			}
		}
	}
	if remote == "" {
		return fmt.Errorf("no backup remote configured — pass --remote or set [backup] remote in .kiwi/config.toml")
	}

	syncer, err := backup.New(root, remote, branch, "")
	if err != nil {
		return err
	}
	return syncer.Push(branch)
}
