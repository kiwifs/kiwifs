package themepresets

import (
	"os"
	"path/filepath"
	"testing"
)

func writePresetFile(t *testing.T, dir, name, body string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestResolveDefaultsWhenMissing(t *testing.T) {
	root := t.TempDir()
	res, err := Resolve(Options{Root: root})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Presets) != 0 {
		t.Fatalf("expected no workspace presets, got %+v", res.Presets)
	}
	if len(res.Builtin) != len(BuiltinSlugs) {
		t.Fatalf("builtin = %+v", res.Builtin)
	}
	if len(res.Allowed) != 0 {
		t.Fatalf("allowed should be empty, got %+v", res.Allowed)
	}
}

func TestResolveWorkspacePresets(t *testing.T) {
	root := t.TempDir()
	themesDir := filepath.Join(root, ".kiwi", "themes")
	writePresetFile(t, themesDir, "corporate-light.json", `{
  "name": "Corporate Light",
  "description": "Brand light theme",
  "light": {"background": "hsl(0 0% 100%)"},
  "dark": {"background": "hsl(0 0% 10%)"}
}`)

	res, err := Resolve(Options{Root: root})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Presets) != 1 {
		t.Fatalf("presets = %+v", res.Presets)
	}
	if res.Presets[0].ID != "corporate-light" {
		t.Fatalf("id = %q", res.Presets[0].ID)
	}
	if res.Presets[0].Light["background"] == "" {
		t.Fatal("missing light tokens")
	}
}

func TestResolveInvalidJSON(t *testing.T) {
	root := t.TempDir()
	themesDir := filepath.Join(root, ".kiwi", "themes")
	writePresetFile(t, themesDir, "broken.json", `{not json`)

	res, err := Resolve(Options{Root: root})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Errors) != 1 {
		t.Fatalf("errors = %+v", res.Errors)
	}
	if res.Errors[0].File != "broken.json" {
		t.Fatalf("file = %q", res.Errors[0].File)
	}
}

func TestResolveMissingRequiredFields(t *testing.T) {
	root := t.TempDir()
	themesDir := filepath.Join(root, ".kiwi", "themes")
	writePresetFile(t, themesDir, "incomplete.json", `{
  "name": "Incomplete",
  "light": {"background": "white"}
}`)

	res, err := Resolve(Options{Root: root})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Errors) != 1 || res.Errors[0].Message != "missing dark tokens" {
		t.Fatalf("errors = %+v", res.Errors)
	}
}

func TestResolveAllowedPresets(t *testing.T) {
	root := t.TempDir()
	themesDir := filepath.Join(root, ".kiwi", "themes")
	writePresetFile(t, themesDir, "corporate-light.json", `{
  "name": "Corporate Light",
  "light": {"background": "white"},
  "dark": {"background": "black"}
}`)
	writePresetFile(t, themesDir, "corporate-dark.json", `{
  "name": "Corporate Dark",
  "light": {"background": "white"},
  "dark": {"background": "black"}
}`)

	res, err := Resolve(Options{
		Root:           root,
		AllowedPresets: []string{"default", "corporate-light"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Presets) != 1 || res.Presets[0].ID != "corporate-light" {
		t.Fatalf("presets = %+v", res.Presets)
	}
	if len(res.Builtin) != 1 || res.Builtin[0] != "kiwi" {
		t.Fatalf("builtin = %+v", res.Builtin)
	}
	if len(res.Allowed) != 2 {
		t.Fatalf("allowed = %+v", res.Allowed)
	}
}

func TestResolveCustomPresetsDir(t *testing.T) {
	root := t.TempDir()
	themesDir := filepath.Join(root, "brand", "themes")
	writePresetFile(t, themesDir, "corp.json", `{
  "name": "Corp",
  "light": {"background": "white"},
  "dark": {"background": "black"}
}`)

	res, err := Resolve(Options{Root: root, PresetsDir: "brand/themes"})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Presets) != 1 || res.Presets[0].ID != "corp" {
		t.Fatalf("presets = %+v", res.Presets)
	}
}

func TestNormalizeSlug(t *testing.T) {
	if NormalizeSlug("Default") != "kiwi" {
		t.Fatalf("default alias failed")
	}
	if NormalizeSlug(" Corporate-Light ") != "corporate-light" {
		t.Fatalf("trim/lowercase failed")
	}
}
