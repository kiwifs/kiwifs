package cmd

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"text/tabwriter"

	"github.com/BurntSushi/toml"
	"github.com/spf13/cobra"
)

var tokenCmd = &cobra.Command{
	Use:   "token",
	Short: "Manage API tokens for KiwiFS spaces",
}

var tokenCreateCmd = &cobra.Command{
	Use:   "create",
	Short: "Create a new API token and append it to config.toml",
	Example: `  kiwifs token create --root ~/my-knowledge --space docs --scope read --actor ci-reader
  kiwifs token create --root ~/my-knowledge --space secure --scope read --prefix docs/ --actor ci-bot`,
	RunE: runTokenCreate,
}

var tokenListCmd = &cobra.Command{
	Use:     "list",
	Short:   "List all API tokens (shows key prefix, scope, space, actor)",
	Example: `  kiwifs token list --root ~/my-knowledge`,
	RunE:    runTokenList,
}

var tokenRevokeCmd = &cobra.Command{
	Use:     "revoke <key-prefix>",
	Short:   "Revoke a token by its key prefix (first 12 characters)",
	Example: `  kiwifs token revoke kiwi_ro_abc1`,
	Args:    cobra.ExactArgs(1),
	RunE:    runTokenRevoke,
}

func init() {
	tokenCreateCmd.Flags().StringP("root", "r", "./knowledge", "knowledge root directory")
	tokenCreateCmd.Flags().String("space", "", "space name the token is scoped to")
	tokenCreateCmd.Flags().String("scope", "read", "token scope: read | write | admin")
	tokenCreateCmd.Flags().String("prefix", "", "optional path prefix restriction")
	tokenCreateCmd.Flags().String("actor", "", "actor name recorded in audit logs")

	tokenListCmd.Flags().StringP("root", "r", "./knowledge", "knowledge root directory")

	tokenRevokeCmd.Flags().StringP("root", "r", "./knowledge", "knowledge root directory")

	tokenCmd.AddCommand(tokenCreateCmd)
	tokenCmd.AddCommand(tokenListCmd)
	tokenCmd.AddCommand(tokenRevokeCmd)

	rootCmd.AddCommand(tokenCmd)
}

// rawConfig is a minimal representation for TOML round-tripping.
// We read/write with map[string]any to preserve existing fields.

func loadRawConfig(root string) (map[string]any, string, error) {
	path := filepath.Join(root, ".kiwi", "config.toml")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, path, fmt.Errorf("read config: %w", err)
	}
	var raw map[string]any
	if _, err := toml.Decode(string(data), &raw); err != nil {
		return nil, path, fmt.Errorf("parse config: %w", err)
	}
	return raw, path, nil
}

func saveRawConfig(path string, raw map[string]any) error {
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("write config: %w", err)
	}
	defer f.Close()
	return toml.NewEncoder(f).Encode(raw)
}

func generateTokenKey(scope string) string {
	b := make([]byte, 24)
	rand.Read(b)
	prefix := "kiwi_"
	switch scope {
	case "read":
		prefix = "kiwi_ro_"
	case "write":
		prefix = "kiwi_rw_"
	case "admin":
		prefix = "kiwi_adm_"
	}
	return prefix + hex.EncodeToString(b)
}

func runTokenCreate(cmd *cobra.Command, args []string) error {
	root, _ := cmd.Flags().GetString("root")
	space, _ := cmd.Flags().GetString("space")
	scope, _ := cmd.Flags().GetString("scope")
	prefix, _ := cmd.Flags().GetString("prefix")
	actor, _ := cmd.Flags().GetString("actor")

	switch scope {
	case "read", "write", "admin":
		// ok
	default:
		return fmt.Errorf("invalid scope %q — must be read, write, or admin", scope)
	}

	if actor == "" {
		actor = scope + "-token"
	}

	key := generateTokenKey(scope)

	raw, path, err := loadRawConfig(root)
	if err != nil {
		return err
	}

	// Build the new key entry as a map for TOML encoding.
	entry := map[string]any{
		"key":   key,
		"actor": actor,
		"scope": scope,
	}
	if space != "" {
		entry["space"] = space
	}
	if prefix != "" {
		entry["prefix"] = prefix
	}

	// Get or create [auth] section.
	auth, ok := raw["auth"].(map[string]any)
	if !ok {
		auth = map[string]any{}
	}
	// Ensure auth type is "perspace" for per-key authentication.
	if auth["type"] == nil || auth["type"] == "" || auth["type"] == "none" {
		auth["type"] = "perspace"
	}

	// Append to [[auth.api_keys]].
	existingKeys, _ := auth["api_keys"].([]any)
	existingKeys = append(existingKeys, entry)
	auth["api_keys"] = existingKeys
	raw["auth"] = auth

	if err := saveRawConfig(path, raw); err != nil {
		return err
	}

	fmt.Println("Token created successfully. Save this key — it will not be shown again.")
	fmt.Println()
	fmt.Printf("  Key:    %s\n", key)
	fmt.Printf("  Scope:  %s\n", scope)
	if space != "" {
		fmt.Printf("  Space:  %s\n", space)
	}
	if prefix != "" {
		fmt.Printf("  Prefix: %s\n", prefix)
	}
	fmt.Printf("  Actor:  %s\n", actor)
	fmt.Println()
	fmt.Println("Use: Authorization: Bearer", key)
	fmt.Println()
	fmt.Println("Reload the server (SIGHUP or restart) for the new token to take effect.")

	return nil
}

func runTokenList(cmd *cobra.Command, args []string) error {
	root, _ := cmd.Flags().GetString("root")

	raw, _, err := loadRawConfig(root)
	if err != nil {
		return err
	}

	auth, _ := raw["auth"].(map[string]any)
	keys, _ := auth["api_keys"].([]any)

	if len(keys) == 0 {
		fmt.Println("No API tokens configured.")
		return nil
	}

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "KEY PREFIX\tSCOPE\tSPACE\tACTOR\tPREFIX")
	fmt.Fprintln(w, "----------\t-----\t-----\t-----\t------")

	for _, k := range keys {
		entry, ok := k.(map[string]any)
		if !ok {
			continue
		}
		key, _ := entry["key"].(string)
		scope, _ := entry["scope"].(string)
		space, _ := entry["space"].(string)
		actor, _ := entry["actor"].(string)
		pfx, _ := entry["prefix"].(string)

		if scope == "" {
			scope = "admin"
		}
		if space == "" {
			space = "*"
		}
		if pfx == "" {
			pfx = "*"
		}

		// Show only first 12 chars of key
		keyPrefix := key
		if len(keyPrefix) > 12 {
			keyPrefix = keyPrefix[:12] + "..."
		}

		fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\n", keyPrefix, scope, space, actor, pfx)
	}
	w.Flush()
	return nil
}

func runTokenRevoke(cmd *cobra.Command, args []string) error {
	root, _ := cmd.Flags().GetString("root")
	keyPrefix := args[0]

	raw, path, err := loadRawConfig(root)
	if err != nil {
		return err
	}

	auth, _ := raw["auth"].(map[string]any)
	keys, _ := auth["api_keys"].([]any)

	if len(keys) == 0 {
		return fmt.Errorf("no API tokens configured")
	}

	found := false
	var remaining []any
	for _, k := range keys {
		entry, ok := k.(map[string]any)
		if !ok {
			remaining = append(remaining, k)
			continue
		}
		key, _ := entry["key"].(string)
		if strings.HasPrefix(key, keyPrefix) {
			found = true
			actor, _ := entry["actor"].(string)
			scope, _ := entry["scope"].(string)
			fmt.Printf("Revoking token: %s... (actor=%s, scope=%s)\n", keyPrefix, actor, scope)
			continue
		}
		remaining = append(remaining, k)
	}

	if !found {
		return fmt.Errorf("no token found with prefix %q", keyPrefix)
	}

	auth["api_keys"] = remaining
	raw["auth"] = auth

	if err := saveRawConfig(path, raw); err != nil {
		return err
	}

	fmt.Println("Token revoked. Reload the server (SIGHUP or restart) for the change to take effect.")
	return nil
}
