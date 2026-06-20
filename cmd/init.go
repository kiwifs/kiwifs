package cmd

import (
	"fmt"

	"github.com/kiwifs/kiwifs/internal/workspace"
	"github.com/spf13/cobra"
)

var initCmd = &cobra.Command{
	Use:   "init",
	Short: "Initialize a knowledge directory",
	Example: `  kiwifs init --root ~/my-kb --template kb
  kiwifs init --root ~/my-wiki --template wiki
  kiwifs init --root ~/my-blog --template cms`,
	RunE: runInit,
}

func init() {
	initCmd.Flags().StringP("root", "r", "./knowledge", "directory to initialize")
	initCmd.Flags().String("template", "kb", "template: kb | wiki | data | cms | memory | runbook | adr | prompt | research | log | tasks | blank")
}

func runInit(cmd *cobra.Command, args []string) error {
	root, _ := cmd.Flags().GetString("root")
	template, _ := cmd.Flags().GetString("template")

	if err := workspace.Init(root, template); err != nil {
		return err
	}

	fmt.Printf("Initialized knowledge at %s (template: %s)\n", root, template)
	fmt.Printf("Run: kiwifs serve --root %s\n", root)
	return nil
}
