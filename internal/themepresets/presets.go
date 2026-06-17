package themepresets

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// BuiltinSlugs are built-in preset identifiers served by the UI bundle.
// "default" is an alias for "kiwi".
var BuiltinSlugs = []string{"kiwi", "neutral", "ocean", "sunset", "forest"}

// Preset is one workspace theme preset loaded from JSON.
type Preset struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Description string            `json:"description,omitempty"`
	Light       map[string]string `json:"light"`
	Dark        map[string]string `json:"dark"`
	Source      string            `json:"source"` // "workspace"
}

// LoadError describes an invalid preset file on disk.
type LoadError struct {
	File    string `json:"file"`
	Message string `json:"message"`
}

// Resolved holds workspace presets plus filtering metadata for the UI.
type Resolved struct {
	Presets []Preset    `json:"presets"`
	Builtin []string    `json:"builtin"`
	Allowed []string    `json:"allowed,omitempty"`
	Errors  []LoadError `json:"errors,omitempty"`
}

// Options configures how workspace theme presets are loaded.
type Options struct {
	Root           string
	PresetsDir     string   // relative path, default .kiwi/themes
	AllowedPresets []string // from [ui.theme] allowed_presets
}

func presetsRelPath(rel string) string {
	rel = strings.TrimSpace(rel)
	if rel == "" {
		return ".kiwi/themes"
	}
	rel = filepath.ToSlash(filepath.Clean(rel))
	if filepath.IsAbs(rel) || strings.Contains(rel, "..") {
		return ".kiwi/themes"
	}
	return strings.TrimSuffix(rel, "/")
}

// NormalizeSlug canonicalizes preset identifiers for comparison.
func NormalizeSlug(slug string) string {
	s := strings.ToLower(strings.TrimSpace(slug))
	if s == "default" {
		return "kiwi"
	}
	return s
}

func slugFromFilename(name string) string {
	base := strings.TrimSuffix(name, filepath.Ext(name))
	return NormalizeSlug(base)
}

type rawPreset struct {
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Light       map[string]string `json:"light"`
	Dark        map[string]string `json:"dark"`
}

func validatePreset(data rawPreset) error {
	if strings.TrimSpace(data.Name) == "" {
		return fmt.Errorf("missing name")
	}
	if len(data.Light) == 0 {
		return fmt.Errorf("missing light tokens")
	}
	if len(data.Dark) == 0 {
		return fmt.Errorf("missing dark tokens")
	}
	return nil
}

// Resolve loads workspace presets and applies optional allowlist filtering.
func Resolve(opts Options) (Resolved, error) {
	dir := filepath.Join(opts.Root, presetsRelPath(opts.PresetsDir))

	out := Resolved{
		Presets: make([]Preset, 0),
		Builtin: append([]string(nil), BuiltinSlugs...),
	}

	allowed := normalizeAllowed(opts.AllowedPresets)
	if len(allowed) > 0 {
		out.Allowed = allowed
		out.Builtin = filterSlugs(out.Builtin, allowed)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return out, nil
		}
		return out, err
	}

	for _, ent := range entries {
		if ent.IsDir() {
			continue
		}
		if !strings.EqualFold(filepath.Ext(ent.Name()), ".json") {
			continue
		}
		id := slugFromFilename(ent.Name())
		if id == "" {
			out.Errors = append(out.Errors, LoadError{
				File:    ent.Name(),
				Message: "invalid filename",
			})
			continue
		}
		if len(allowed) > 0 && !containsSlug(allowed, id) {
			continue
		}

		data, err := os.ReadFile(filepath.Join(dir, ent.Name()))
		if err != nil {
			out.Errors = append(out.Errors, LoadError{
				File:    ent.Name(),
				Message: err.Error(),
			})
			continue
		}

		var raw rawPreset
		if err := json.Unmarshal(data, &raw); err != nil {
			out.Errors = append(out.Errors, LoadError{
				File:    ent.Name(),
				Message: "invalid JSON: " + err.Error(),
			})
			continue
		}
		if err := validatePreset(raw); err != nil {
			out.Errors = append(out.Errors, LoadError{
				File:    ent.Name(),
				Message: err.Error(),
			})
			continue
		}

		out.Presets = append(out.Presets, Preset{
			ID:          id,
			Name:        raw.Name,
			Description: raw.Description,
			Light:       raw.Light,
			Dark:        raw.Dark,
			Source:      "workspace",
		})
	}

	sort.Slice(out.Presets, func(i, j int) bool {
		return strings.ToLower(out.Presets[i].Name) < strings.ToLower(out.Presets[j].Name)
	})
	sort.Strings(out.Builtin)

	return out, nil
}

func normalizeAllowed(in []string) []string {
	if len(in) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, slug := range in {
		n := NormalizeSlug(slug)
		if n == "" {
			continue
		}
		if _, ok := seen[n]; ok {
			continue
		}
		seen[n] = struct{}{}
		out = append(out, n)
	}
	sort.Strings(out)
	return out
}

func filterSlugs(slugs, allowed []string) []string {
	out := make([]string, 0, len(slugs))
	for _, slug := range slugs {
		if containsSlug(allowed, slug) {
			out = append(out, slug)
		}
	}
	return out
}

func containsSlug(allowed []string, slug string) bool {
	n := NormalizeSlug(slug)
	for _, a := range allowed {
		if a == n {
			return true
		}
	}
	return false
}
