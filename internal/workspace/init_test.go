package workspace

import (
	"io/fs"
	"os"
	"path/filepath"
	"testing"
)

func TestListInitTemplatesIncludesKnown(t *testing.T) {
	t.Parallel()
	list, err := ListInitTemplates()
	if err != nil {
		t.Fatal(err)
	}
	ids := map[string]bool{}
	for _, item := range list {
		if item.ID == "" || item.Label == "" {
			t.Fatalf("template missing id/label: %+v", item)
		}
		ids[item.ID] = true
	}
	for _, want := range []string{"blank", "knowledge", "wiki"} {
		if !ids[want] {
			t.Fatalf("missing template %q in %v", want, list)
		}
	}
}

func TestInitKnowledgeTemplate(t *testing.T) {
	t.Parallel()
	root := filepath.Join(t.TempDir(), "kb")
	if err := Init(root, "knowledge"); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{
		"pages/getting-started.md",
		"index.md",
		".kiwi/playbook.md",
		".kiwi/config.toml",
		".kiwi/rules.md",
	} {
		if _, err := os.Stat(filepath.Join(root, p)); err != nil {
			t.Fatalf("missing %s: %v", p, err)
		}
	}
}

func TestInitBlankTemplate(t *testing.T) {
	t.Parallel()
	root := filepath.Join(t.TempDir(), "blank")
	if err := Init(root, "blank"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "index.md")); err == nil {
		t.Fatal("blank template should not copy index.md")
	}
	if _, err := os.Stat(filepath.Join(root, ".kiwi/config.toml")); err != nil {
		t.Fatal("blank template should create config.toml")
	}
}

func TestInitTasksTemplateIncludesWorkflow(t *testing.T) {
	t.Parallel()
	root := filepath.Join(t.TempDir(), "tasks-ws")
	if err := Init(root, "tasks"); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{
		".kiwi/workflows/tasks.json",
		"tasks/example-task.md",
	} {
		if _, err := os.Stat(filepath.Join(root, p)); err != nil {
			t.Fatalf("missing %s: %v", p, err)
		}
	}
	if _, err := fs.Stat(templates, "templates/workflow/task.md"); err != nil {
		t.Fatalf("embedded task template missing: %v", err)
	}
}

func TestKnowledgeTemplateEmbedded(t *testing.T) {
	t.Parallel()
	paths := []string{
		"templates/knowledge/SCHEMA.md",
		"templates/knowledge/index.md",
		"templates/knowledge/playbook.md",
	}
	for _, p := range paths {
		if _, err := fs.Stat(templates, p); err != nil {
			t.Fatalf("embedded template missing %s: %v", p, err)
		}
	}
}
