package slashcommands

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/kiwifs/kiwifs/internal/config"
)

func writeFile(t *testing.T, root, rel, content string) {
	t.Helper()
	p := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func ids(cmds []Command) []string {
	out := []string{}
	for _, c := range cmds {
		out = append(out, c.ID)
	}
	return out
}

func hasWarning(res Resolved, substr string) bool {
	for _, w := range res.Warnings {
		if strings.Contains(w, substr) {
			return true
		}
	}
	return false
}

func TestResolve(t *testing.T) {
	cases := []struct {
		name  string
		setup func(t *testing.T, root string)
		opts  Options
		check func(t *testing.T, res Resolved)
	}{
		{
			name: "missing file",
			check: func(t *testing.T, res Resolved) {
				if len(res.Commands) != 0 || len(res.Hide) != 0 || len(res.Warnings) != 0 {
					t.Fatalf("expected empty result, got %+v", res)
				}
				if res.Commands == nil || res.Hide == nil || res.Warnings == nil {
					t.Fatalf("slices must be non-nil so JSON has [] not null: %+v", res)
				}
			},
		},
		{
			name: "inline insert",
			setup: func(t *testing.T, root string) {
				writeFile(t, root, DefaultFile, `
[[commands]]
id = "assigned"
label = "Assign to agent"
icon = "Bot"
description = "Hand this task to the agent"
aliases = ["agent", " "]
insert = "[assigned:: agent]"
`)
			},
			check: func(t *testing.T, res Resolved) {
				if len(res.Commands) != 1 {
					t.Fatalf("got %+v", res)
				}
				c := res.Commands[0]
				want := Command{
					ID: "assigned", Label: "Assign to agent", Icon: "Bot",
					Description: "Hand this task to the agent", Aliases: []string{"agent"},
					Insert: "[assigned:: agent]", Source: DefaultFile,
				}
				if !reflect.DeepEqual(c, want) {
					t.Fatalf("got %+v, want %+v", c, want)
				}
			},
		},
		{
			name: "label and icon defaults",
			setup: func(t *testing.T, root string) {
				writeFile(t, root, DefaultFile, "[[commands]]\nid = \"x\"\ninsert = \"y\"\n")
			},
			check: func(t *testing.T, res Resolved) {
				c := res.Commands[0]
				if c.Label != "x" || c.Icon != "FileText" {
					t.Fatalf("defaults not applied: %+v", c)
				}
			},
		},
		{
			name: "template in .kiwi/templates",
			setup: func(t *testing.T, root string) {
				writeFile(t, root, ".kiwi/templates/decision.md", "## Decision\n\n{{cursor}}\n")
				writeFile(t, root, DefaultFile, "[[commands]]\nid = \"decision\"\ntemplate = \".kiwi/templates/decision.md\"\n")
			},
			check: func(t *testing.T, res Resolved) {
				if len(res.Commands) != 1 {
					t.Fatalf("got %+v", res)
				}
				c := res.Commands[0]
				if c.Insert != "## Decision\n\n{{cursor}}\n" || c.Template != ".kiwi/templates/decision.md" {
					t.Fatalf("multi-line template should keep its newline: %+v", c)
				}
			},
		},
		{
			name: "single-line template in a page drops trailing newline",
			setup: func(t *testing.T, root string) {
				writeFile(t, root, "snippets/assign.md", "[assigned:: agent]\n")
				writeFile(t, root, DefaultFile, "[[commands]]\nid = \"a\"\ntemplate = \"snippets/assign.md\"\n")
			},
			check: func(t *testing.T, res Resolved) {
				if len(res.Commands) != 1 || res.Commands[0].Insert != "[assigned:: agent]" {
					t.Fatalf("got %+v", res)
				}
			},
		},
		{
			name: "template escaping the root",
			setup: func(t *testing.T, root string) {
				writeFile(t, root, DefaultFile, `
[[commands]]
id = "up"
template = "../outside.md"

[[commands]]
id = "abs"
template = "/etc/passwd"
`)
			},
			check: func(t *testing.T, res Resolved) {
				if len(res.Commands) != 0 {
					t.Fatalf("escaping templates must be skipped: %+v", res.Commands)
				}
				if !hasWarning(res, `"up"`) || !hasWarning(res, `"abs"`) {
					t.Fatalf("expected warnings for both: %v", res.Warnings)
				}
			},
		},
		{
			name: "template in .git or .kiwi config",
			setup: func(t *testing.T, root string) {
				writeFile(t, root, ".git/config", "[core]\n")
				writeFile(t, root, ".kiwi/config.toml", "[server]\n")
				writeFile(t, root, ".kiwi/templates/notes.txt", "x\n")
				writeFile(t, root, DefaultFile, `
[[commands]]
id = "git"
template = ".git/config"

[[commands]]
id = "cfg"
template = ".kiwi/config.toml"

[[commands]]
id = "txt"
template = ".kiwi/templates/notes.txt"
`)
			},
			check: func(t *testing.T, res Resolved) {
				if len(res.Commands) != 0 {
					t.Fatalf("internal templates must be skipped: %+v", res.Commands)
				}
				if len(res.Warnings) != 3 {
					t.Fatalf("expected 3 warnings: %v", res.Warnings)
				}
			},
		},
		{
			name: "template symlinked out of the root",
			setup: func(t *testing.T, root string) {
				outside := filepath.Join(t.TempDir(), "secret.md")
				if err := os.WriteFile(outside, []byte("secret"), 0o644); err != nil {
					t.Fatal(err)
				}
				if err := os.MkdirAll(filepath.Join(root, ".kiwi/templates"), 0o755); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(outside, filepath.Join(root, ".kiwi/templates/link.md")); err != nil {
					t.Skip("symlinks unsupported:", err)
				}
				writeFile(t, root, DefaultFile, "[[commands]]\nid = \"s\"\ntemplate = \".kiwi/templates/link.md\"\n")
			},
			check: func(t *testing.T, res Resolved) {
				if len(res.Commands) != 0 || !hasWarning(res, "outside the space") {
					t.Fatalf("symlink escape must be rejected: %+v", res)
				}
			},
		},
		{
			name: "missing template",
			setup: func(t *testing.T, root string) {
				writeFile(t, root, DefaultFile, "[[commands]]\nid = \"m\"\ntemplate = \"nope.md\"\n")
			},
			check: func(t *testing.T, res Resolved) {
				if len(res.Commands) != 0 || !hasWarning(res, "not found") {
					t.Fatalf("got %+v", res)
				}
			},
		},
		{
			name: "oversized template",
			setup: func(t *testing.T, root string) {
				writeFile(t, root, ".kiwi/templates/big.md", strings.Repeat("a", MaxTemplateBytes+1))
				writeFile(t, root, DefaultFile, "[[commands]]\nid = \"big\"\ntemplate = \".kiwi/templates/big.md\"\n")
			},
			check: func(t *testing.T, res Resolved) {
				if len(res.Commands) != 0 || !hasWarning(res, "larger than 256 KB") {
					t.Fatalf("got %+v", res)
				}
			},
		},
		{
			name: "invalid TOML keeps config commands",
			setup: func(t *testing.T, root string) {
				writeFile(t, root, DefaultFile, "hide = [\"quiz\"]\n\nid = = \"x\"\n")
			},
			opts: Options{ConfigCommands: []config.SlashCommandConfig{{ID: "c", Insert: "from config"}}},
			check: func(t *testing.T, res Resolved) {
				if !reflect.DeepEqual(ids(res.Commands), []string{"c"}) {
					t.Fatalf("config commands should survive: %+v", res.Commands)
				}
				if !hasWarning(res, "line 3") {
					t.Fatalf("warning should carry the line number: %v", res.Warnings)
				}
				if len(res.Hide) != 0 {
					t.Fatalf("hide from a broken file must be ignored: %v", res.Hide)
				}
			},
		},
		{
			name: "both or neither of insert and template",
			setup: func(t *testing.T, root string) {
				writeFile(t, root, "t.md", "x")
				writeFile(t, root, DefaultFile, `
[[commands]]
id = "both"
insert = "a"
template = "t.md"

[[commands]]
id = "neither"

[[commands]]
id = "ok"
insert = "fine"
`)
			},
			check: func(t *testing.T, res Resolved) {
				if !reflect.DeepEqual(ids(res.Commands), []string{"ok"}) {
					t.Fatalf("got %+v", res.Commands)
				}
				if !hasWarning(res, `"both"`) || !hasWarning(res, `"neither"`) {
					t.Fatalf("warnings: %v", res.Warnings)
				}
			},
		},
		{
			name: "invalid and duplicate ids",
			setup: func(t *testing.T, root string) {
				writeFile(t, root, DefaultFile, `
[[commands]]
id = "bad id"
insert = "x"

[[commands]]
id = "dup"
insert = "first"

[[commands]]
id = "dup"
insert = "second"
`)
			},
			check: func(t *testing.T, res Resolved) {
				if len(res.Commands) != 1 || res.Commands[0].Insert != "first" {
					t.Fatalf("got %+v", res.Commands)
				}
				if !hasWarning(res, `"bad id"`) || !hasWarning(res, `duplicate command id "dup"`) {
					t.Fatalf("warnings: %v", res.Warnings)
				}
			},
		},
		{
			name: "file overrides a config id and keeps its position",
			setup: func(t *testing.T, root string) {
				writeFile(t, root, DefaultFile, `
[[commands]]
id = "new"
insert = "n"

[[commands]]
id = "adr"
insert = "from file"
`)
			},
			opts: Options{ConfigCommands: []config.SlashCommandConfig{
				{ID: "adr", Insert: "from config"},
				{ID: "other", Insert: "o"},
			}},
			check: func(t *testing.T, res Resolved) {
				if !reflect.DeepEqual(ids(res.Commands), []string{"adr", "other", "new"}) {
					t.Fatalf("order: %v", ids(res.Commands))
				}
				if res.Commands[0].Insert != "from file" || res.Commands[0].Source != DefaultFile {
					t.Fatalf("file should win: %+v", res.Commands[0])
				}
				if res.Commands[1].Source != SourceConfig {
					t.Fatalf("source: %+v", res.Commands[1])
				}
			},
		},
		{
			name: "hide normalized",
			setup: func(t *testing.T, root string) {
				writeFile(t, root, DefaultFile, `hide = ["Quiz", " d2 ", "quiz", ""]`)
			},
			check: func(t *testing.T, res Resolved) {
				if !reflect.DeepEqual(res.Hide, []string{"quiz", "d2"}) {
					t.Fatalf("hide: %v", res.Hide)
				}
			},
		},
		{
			name: "custom file path",
			setup: func(t *testing.T, root string) {
				writeFile(t, root, "config/slash.toml", "[[commands]]\nid = \"custom\"\ninsert = \"x\"\n")
			},
			opts: Options{File: "config/slash.toml"},
			check: func(t *testing.T, res Resolved) {
				if !reflect.DeepEqual(ids(res.Commands), []string{"custom"}) {
					t.Fatalf("got %+v", res)
				}
			},
		},
		{
			name: "custom file path with .. falls back to the default",
			setup: func(t *testing.T, root string) {
				writeFile(t, root, DefaultFile, "[[commands]]\nid = \"default\"\ninsert = \"x\"\n")
			},
			opts: Options{File: "../elsewhere.toml"},
			check: func(t *testing.T, res Resolved) {
				if !reflect.DeepEqual(ids(res.Commands), []string{"default"}) {
					t.Fatalf("got %+v", res)
				}
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			if tc.setup != nil {
				tc.setup(t, root)
			}
			opts := tc.opts
			opts.Root = root
			tc.check(t, Resolve(opts))
		})
	}
}

func TestFilePath(t *testing.T) {
	cases := map[string]string{
		"":                    DefaultFile,
		"  ":                  DefaultFile,
		"/etc/slash.toml":     DefaultFile,
		"../x.toml":           DefaultFile,
		"a/../../x.toml":      DefaultFile,
		"./.kiwi/custom.toml": ".kiwi/custom.toml",
		".kiwi/slash.toml":    ".kiwi/slash.toml",
	}
	for in, want := range cases {
		if got := FilePath(in); got != want {
			t.Errorf("FilePath(%q) = %q, want %q", in, got, want)
		}
	}
}
