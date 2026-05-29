package cmd

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

func TestKnowledgeTemplateEmbedded(t *testing.T) {
	t.Parallel()
	paths := []string{
		"templates/knowledge/SCHEMA.md",
		"templates/knowledge/index.md",
		"templates/knowledge/log.md",
		"templates/knowledge/episodes/example-episode.md",
		"templates/knowledge/pages/getting-started.md",
		"templates/knowledge/playbook.md",
	}
	for _, p := range paths {
		if _, err := fs.Stat(templates, p); err != nil {
			t.Fatalf("embedded template missing %s: %v", p, err)
		}
	}

	absent := []string{
		"templates/knowledge/concepts",
		"templates/knowledge/entities",
		"templates/knowledge/reports",
		"templates/knowledge/decisions",
		"templates/knowledge/welcome.md",
	}
	for _, p := range absent {
		if _, err := fs.Stat(templates, p); err == nil {
			t.Fatalf("expected %s to be removed, but it still exists", p)
		}
	}
}

func TestMemoryTemplateRemoved(t *testing.T) {
	t.Parallel()
	if _, err := fs.Stat(templates, "templates/memory/SCHEMA.md"); err == nil {
		t.Fatal("memory template should be removed from embedded files")
	}
}

func newInitCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:  "init",
		RunE: runInit,
	}
	cmd.Flags().StringP("root", "r", "./knowledge", "directory to initialize")
	cmd.Flags().String("template", "knowledge", "template")
	return cmd
}

func TestKnowledgeTemplateInit(t *testing.T) {
	t.Parallel()
	root := filepath.Join(t.TempDir(), "kb")

	cmd := newInitCmd()
	cmd.SetArgs([]string{"--root", root, "--template", "knowledge"})
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}

	mustExist := []string{
		"pages/getting-started.md",
		"episodes/example-episode.md",
		"SCHEMA.md",
		"index.md",
		"log.md",
		".kiwi/playbook.md",
		".kiwi/config.toml",
	}
	for _, p := range mustExist {
		if _, err := os.Stat(filepath.Join(root, p)); err != nil {
			t.Errorf("expected %s to exist: %v", p, err)
		}
	}

	mustNotExist := []string{
		"concepts",
		"entities",
		"reports",
		"decisions",
		"welcome.md",
	}
	for _, p := range mustNotExist {
		if _, err := os.Stat(filepath.Join(root, p)); err == nil {
			t.Errorf("expected %s to NOT exist", p)
		}
	}
}

func TestTeamWikiTemplateEmbedded(t *testing.T) {
	t.Parallel()
	paths := []string{
		"templates/team-wiki/SCHEMA.md",
		"templates/team-wiki/index.md",
		"templates/team-wiki/welcome.md",
		"templates/team-wiki/how-we-work.md",
		"templates/team-wiki/architecture.md",
		"templates/team-wiki/playbook.md",
		"templates/team-wiki/onboarding/index.md",
		"templates/team-wiki/decisions/index.md",
		"templates/team-wiki/decisions/adr-001-example.md",
		"templates/team-wiki/processes/index.md",
		"templates/team-wiki/processes/deployment.md",
		"templates/team-wiki/processes/dev-setup.md",
		"templates/team-wiki/processes/incident-response.md",
		"templates/team-wiki/reference/index.md",
		"templates/team-wiki/reference/glossary.md",
		"templates/team-wiki/reference/faq.md",
	}
	for _, p := range paths {
		if _, err := fs.Stat(templates, p); err != nil {
			t.Fatalf("embedded template missing %s: %v", p, err)
		}
	}
}

func TestTeamWikiTemplateInit(t *testing.T) {
	t.Parallel()
	root := filepath.Join(t.TempDir(), "wiki")

	cmd := newInitCmd()
	cmd.SetArgs([]string{"--root", root, "--template", "team-wiki"})
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}

	mustExist := []string{
		"SCHEMA.md",
		"index.md",
		"welcome.md",
		"how-we-work.md",
		"architecture.md",
		"onboarding/index.md",
		"decisions/index.md",
		"decisions/adr-001-example.md",
		"processes/index.md",
		"processes/deployment.md",
		"processes/dev-setup.md",
		"processes/incident-response.md",
		"reference/index.md",
		"reference/glossary.md",
		"reference/faq.md",
		".kiwi/playbook.md",
		".kiwi/config.toml",
		".kiwi/templates/decision.md",
		".kiwi/templates/sop.md",
		".kiwi/templates/meeting-notes.md",
		".gitignore",
	}
	for _, p := range mustExist {
		if _, err := os.Stat(filepath.Join(root, p)); err != nil {
			t.Errorf("expected %s to exist: %v", p, err)
		}
	}

	// Verify frontmatter is present in key pages
	welcome, err := os.ReadFile(filepath.Join(root, "welcome.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(welcome), "title: Welcome") {
		t.Error("welcome.md missing frontmatter")
	}
	if !strings.Contains(string(welcome), "owner:") {
		t.Error("welcome.md missing owner field")
	}

	adr, err := os.ReadFile(filepath.Join(root, "decisions/adr-001-example.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(adr), "type: decision") {
		t.Error("adr-001-example.md missing type: decision")
	}
}

func TestMemoryTemplateMigrationError(t *testing.T) {
	t.Parallel()
	root := filepath.Join(t.TempDir(), "kb")

	cmd := newInitCmd()
	cmd.SetArgs([]string{"--root", root, "--template", "memory"})
	err := cmd.Execute()
	if err == nil {
		t.Fatal("expected error for memory template, got nil")
	}
	if got := err.Error(); got != "the 'memory' template has been merged into 'knowledge' — use --template knowledge instead" {
		t.Fatalf("unexpected error: %v", err)
	}
}
