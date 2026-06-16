package preferences

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Preferences holds per-user UI settings persisted under .kiwi/users/.
type Preferences struct {
	Theme             string `json:"theme,omitempty"`
	SidebarCollapsed  *bool  `json:"sidebar_collapsed,omitempty"`
	DefaultView       string `json:"default_view,omitempty"`
	FontSize          string `json:"font_size,omitempty"`
	EditorLineNumbers *bool  `json:"editor_line_numbers,omitempty"`
	VimMode           *bool  `json:"vim_mode,omitempty"`
}

var (
	validDefaultViews = map[string]struct{}{
		"editor": {},
		"source": {},
	}
	validFontSizes = map[string]struct{}{
		"base": {},
		"sm":   {},
		"lg":   {},
	}
)

// IsPersistableUser reports whether actor identity is specific enough to store
// server-side preferences. Anonymous and default web-ui actors use localStorage.
func IsPersistableUser(actor string) bool {
	switch strings.TrimSpace(actor) {
	case "", "anonymous", "human:web-ui", "kiwifs":
		return false
	default:
		return true
	}
}

// UserID converts an actor string into a filesystem-safe user directory name.
func UserID(actor string) string {
	actor = strings.TrimSpace(actor)
	if actor == "" {
		return ""
	}
	actor = strings.ReplaceAll(actor, "@", "_at_")
	actor = strings.ReplaceAll(actor, ":", "_")

	var b strings.Builder
	for _, r := range actor {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '.', r == '-', r == '_':
			b.WriteRune(r)
		default:
			b.WriteRune('_')
		}
	}
	s := strings.Trim(b.String(), "_")
	if len(s) > 128 {
		s = s[:128]
	}
	return s
}

// RelPath returns the git-tracked preferences path for a user.
func RelPath(userID string) string {
	return filepath.ToSlash(filepath.Join(".kiwi", "users", userID, "preferences.json"))
}

// Load reads preferences for userID. Missing file returns zero Preferences.
func Load(root, userID string) (Preferences, error) {
	if userID == "" {
		return Preferences{}, fmt.Errorf("empty user id")
	}
	p := filepath.Join(root, RelPath(userID))
	data, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return Preferences{}, nil
		}
		return Preferences{}, err
	}
	var prefs Preferences
	if err := json.Unmarshal(data, &prefs); err != nil {
		return Preferences{}, fmt.Errorf("invalid preferences.json: %w", err)
	}
	return prefs, nil
}

// Merge overlays patch onto base. Nil pointer fields in patch are ignored.
func Merge(base, patch Preferences) Preferences {
	out := base
	if patch.Theme != "" {
		out.Theme = patch.Theme
	}
	if patch.SidebarCollapsed != nil {
		out.SidebarCollapsed = patch.SidebarCollapsed
	}
	if patch.DefaultView != "" {
		out.DefaultView = patch.DefaultView
	}
	if patch.FontSize != "" {
		out.FontSize = patch.FontSize
	}
	if patch.EditorLineNumbers != nil {
		out.EditorLineNumbers = patch.EditorLineNumbers
	}
	if patch.VimMode != nil {
		out.VimMode = patch.VimMode
	}
	return out
}

// Validate checks preference field values.
func Validate(p Preferences) error {
	if p.DefaultView != "" {
		if _, ok := validDefaultViews[p.DefaultView]; !ok {
			return fmt.Errorf("invalid default_view %q", p.DefaultView)
		}
	}
	if p.FontSize != "" {
		if _, ok := validFontSizes[p.FontSize]; !ok {
			return fmt.Errorf("invalid font_size %q", p.FontSize)
		}
	}
	return nil
}

// Save writes preferences to disk and returns the relative path for git commit.
func Save(root, userID string, prefs Preferences) (string, error) {
	if userID == "" {
		return "", fmt.Errorf("empty user id")
	}
	if err := Validate(prefs); err != nil {
		return "", err
	}
	rel := RelPath(userID)
	abs := filepath.Join(root, rel)
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return "", err
	}
	formatted, err := json.MarshalIndent(prefs, "", "  ")
	if err != nil {
		return "", err
	}
	formatted = append(formatted, '\n')
	if err := os.WriteFile(abs, formatted, 0o644); err != nil {
		return "", err
	}
	return rel, nil
}
