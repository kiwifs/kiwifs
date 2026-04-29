//go:build windows

package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
)

var mountCmd = &cobra.Command{
	Use:   "mount",
	Short: "Mount is unavailable on Windows builds",
	RunE: func(cmd *cobra.Command, args []string) error {
		return fmt.Errorf("mount is not supported on Windows; run kiwifs serve instead")
	},
}
