// Package slashcommands resolves the custom editor slash commands for a
// space: [[ui.editor.slash_commands]] from config.toml, overlaid by the
// space's .kiwi/slash-commands.toml. The file is read on every call so edits
// apply without a restart and each space gets its own commands.
package slashcommands

import (
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/BurntSushi/toml"
	"github.com/kiwifs/kiwifs/internal/config"
	"github.com/kiwifs/kiwifs/internal/storage"
)

// DefaultFile is the space-relative path of the slash commands file.
const DefaultFile = ".kiwi/slash-commands.toml"

// MaxTemplateBytes caps a template so a mistaken path can't bloat every
// editor load.
const MaxTemplateBytes = 256 << 10

// SourceConfig marks commands that came from config.toml.
const SourceConfig = "config"

var idPattern = regexp.MustCompile(`^[\w-]+$`)

// File is the shape of .kiwi/slash-commands.toml.
type File struct {
	Hide     []string                    `toml:"hide"`
	Commands []config.SlashCommandConfig `toml:"commands"`
}

// Command is a resolved slash command, ready for the editor to insert.
type Command struct {
	ID          string   `json:"id"`
	Label       string   `json:"label"`
	Icon        string   `json:"icon"`
	Description string   `json:"description"`
	Aliases     []string `json:"aliases"`
	// Insert is the inline text, or the resolved template's content.
	Insert string `json:"insert"`
	// Template is the original template path, kept for display.
	Template string `json:"template,omitempty"`
	// Source is "config" or the space file's path.
	Source string `json:"source"`
}

// Resolved is the merged result. Warnings describe entries that were skipped.
type Resolved struct {
	Commands []Command `json:"commands"`
	Hide     []string  `json:"hide"`
	Warnings []string  `json:"warnings"`
}

// Options configures Resolve.
type Options struct {
	Root string
	// File is relative to Root; "" means DefaultFile.
	File           string
	ConfigCommands []config.SlashCommandConfig
}

// FilePath returns the space-relative path of the slash commands file,
// falling back to DefaultFile for empty, absolute or escaping paths.
func FilePath(rel string) string {
	rel = strings.TrimSpace(rel)
	if rel == "" {
		return DefaultFile
	}
	rel = filepath.ToSlash(filepath.Clean(rel))
	if filepath.IsAbs(rel) || strings.HasPrefix(rel, "/") || strings.Contains(rel, "..") {
		return DefaultFile
	}
	return rel
}

// Resolve never fails: problems become warnings, and whatever is valid is
// still returned.
func Resolve(opts Options) Resolved {
	res := Resolved{Commands: []Command{}, Hide: []string{}, Warnings: []string{}}
	warn := func(format string, args ...any) {
		res.Warnings = append(res.Warnings, fmt.Sprintf(format, args...))
	}

	var merged []Command
	index := map[string]int{}
	add := func(entries []config.SlashCommandConfig, source string) {
		seen := map[string]bool{}
		for i, entry := range entries {
			cmd, ok := resolveEntry(opts.Root, entry, source, i, warn)
			if !ok {
				continue
			}
			if seen[cmd.ID] {
				warn("%s: duplicate command id %q, skipped", source, cmd.ID)
				continue
			}
			seen[cmd.ID] = true
			if at, exists := index[cmd.ID]; exists {
				merged[at] = cmd
				continue
			}
			index[cmd.ID] = len(merged)
			merged = append(merged, cmd)
		}
	}

	add(opts.ConfigCommands, SourceConfig)

	rel := FilePath(opts.File)
	file, err := readFile(opts.Root, rel)
	if err != nil {
		warn("%s", err.Error())
	} else {
		add(file.Commands, rel)
		res.Hide = normalizeHide(file.Hide)
	}

	if merged != nil {
		res.Commands = merged
	}
	return res
}

func readFile(root, rel string) (File, error) {
	var f File
	data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(rel)))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return f, nil
		}
		return f, fmt.Errorf("%s: %v", rel, err)
	}
	if _, err := toml.Decode(string(data), &f); err != nil {
		var perr toml.ParseError
		if errors.As(err, &perr) {
			return File{}, fmt.Errorf("%s: line %d: %s", rel, perr.Position.Line, perr.Message)
		}
		return File{}, fmt.Errorf("%s: %v", rel, err)
	}
	return f, nil
}

func resolveEntry(root string, entry config.SlashCommandConfig, source string, i int, warn func(string, ...any)) (Command, bool) {
	id := strings.TrimSpace(entry.ID)
	if id == "" {
		warn("%s: command #%d has no id, skipped", source, i+1)
		return Command{}, false
	}
	if !idPattern.MatchString(id) {
		warn("%s: command id %q may only contain letters, digits, _ and -, skipped", source, id)
		return Command{}, false
	}
	template := strings.TrimSpace(entry.Template)
	hasInsert := entry.Insert != ""
	hasTemplate := template != ""
	if hasInsert == hasTemplate {
		warn("%s: command %q needs exactly one of insert or template, skipped", source, id)
		return Command{}, false
	}

	insert := entry.Insert
	if hasTemplate {
		content, err := readTemplate(root, template)
		if err != nil {
			warn("%s: command %q: %v, skipped", source, id, err)
			return Command{}, false
		}
		insert = content
	}

	label := strings.TrimSpace(entry.Label)
	if label == "" {
		label = id
	}
	icon := strings.TrimSpace(entry.Icon)
	if icon == "" {
		icon = "FileText"
	}
	aliases := []string{}
	for _, a := range entry.Aliases {
		a = strings.TrimSpace(a)
		if a != "" {
			aliases = append(aliases, a)
		}
	}
	return Command{
		ID:          id,
		Label:       label,
		Icon:        icon,
		Description: strings.TrimSpace(entry.Description),
		Aliases:     aliases,
		Insert:      insert,
		Template:    template,
		Source:      source,
	}, true
}

// readTemplate allows .kiwi/templates/**/*.md plus anything the file API can
// read. It refuses absolute paths and ".." outright rather than letting
// storage.GuardPath clamp them, since a clamped path would silently read a
// different file than the one the user wrote.
func readTemplate(root, rel string) (string, error) {
	slash := strings.ReplaceAll(rel, "\\", "/")
	if strings.HasPrefix(slash, "/") || filepath.IsAbs(rel) {
		return "", fmt.Errorf("template %q must be relative to the space", rel)
	}
	for _, seg := range strings.Split(slash, "/") {
		if seg == ".." {
			return "", fmt.Errorf("template %q may not contain ..", rel)
		}
	}
	clean := path.Clean(slash)

	var abs string
	if strings.HasPrefix(clean, ".kiwi/templates/") && strings.HasSuffix(clean, ".md") {
		abs = filepath.Join(root, filepath.FromSlash(clean))
	} else {
		guarded, err := storage.GuardPath(root, clean)
		if err != nil {
			return "", fmt.Errorf("template %q is not readable (use a page or .kiwi/templates/*.md)", rel)
		}
		abs = guarded
	}

	if err := withinRoot(root, abs); err != nil {
		return "", fmt.Errorf("template %q: %v", rel, err)
	}

	info, err := os.Stat(abs)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", fmt.Errorf("template %q not found", rel)
		}
		return "", fmt.Errorf("template %q: %v", rel, err)
	}
	if info.IsDir() {
		return "", fmt.Errorf("template %q is a directory", rel)
	}
	if info.Size() > MaxTemplateBytes {
		return "", fmt.Errorf("template %q is larger than %d KB", rel, MaxTemplateBytes>>10)
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return "", fmt.Errorf("template %q: %v", rel, err)
	}
	content := string(data)
	// A one-line template is meant to be used inline, where its trailing
	// newline would push the following text onto the next line.
	if trimmed := strings.TrimSuffix(strings.TrimSuffix(content, "\n"), "\r"); !strings.Contains(trimmed, "\n") {
		content = trimmed
	}
	return content, nil
}

func withinRoot(root, abs string) error {
	realRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return err
	}
	realPath, err := filepath.EvalSymlinks(abs)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	r, err := filepath.Rel(realRoot, realPath)
	if err != nil || r == ".." || strings.HasPrefix(r, ".."+string(filepath.Separator)) {
		return errors.New("resolves outside the space")
	}
	return nil
}

func normalizeHide(in []string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, h := range in {
		h = strings.ToLower(strings.TrimSpace(h))
		if h == "" || seen[h] {
			continue
		}
		seen[h] = true
		out = append(out, h)
	}
	return out
}
