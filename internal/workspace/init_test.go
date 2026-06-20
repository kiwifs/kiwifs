package workspace

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kiwifs/kiwifs/internal/markdown"
	"github.com/kiwifs/kiwifs/internal/schema"
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
	for _, want := range []string{"blank", "memory", "wiki", "research", "prompt", "adr", "kb", "cms", "data", "log"} {
		if !ids[want] {
			t.Fatalf("missing template %q in %v", want, list)
		}
	}
}

func TestInitPromptTemplate(t *testing.T) {
	t.Parallel()
	root := filepath.Join(t.TempDir(), "prompts")
	if err := Init(root, "prompt"); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{
		"index.md",
		"SCHEMA.md",
		"system-prompts/code-assistant.md",
		"task-prompts/summarize.md",
		"task-prompts/review-code.md",
		"task-prompts/translate.md",
		"evaluation/summarize-rubric.md",
		".kiwi/schemas/prompt.json",
		".kiwi/schemas/rubric.json",
		".kiwi/playbook.md",
		".kiwi/config.toml",
	} {
		if _, err := os.Stat(filepath.Join(root, p)); err != nil {
			t.Fatalf("missing %s: %v", p, err)
		}
	}
}

func TestPromptTemplateLintClean(t *testing.T) {
	t.Parallel()
	root := filepath.Join(t.TempDir(), "prompts-lint")
	if err := Init(root, "prompt"); err != nil {
		t.Fatal(err)
	}
	res, err := schema.Lint(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Issues) > 0 {
		for _, is := range res.Issues {
			if is.Kind == "broken-link" || is.Kind == "orphan" || is.Kind == "empty-file" {
				t.Fatalf("lint issue: %+v", is)
			}
		}
	}

	sv := schema.NewValidator(root)
	for _, rel := range []string{
		"system-prompts/code-assistant.md",
		"task-prompts/summarize.md",
		"task-prompts/review-code.md",
		"task-prompts/translate.md",
		"evaluation/summarize-rubric.md",
	} {
		data, err := os.ReadFile(filepath.Join(root, rel))
		if err != nil {
			t.Fatal(err)
		}
		fm, err := markdown.Frontmatter(data)
		if err != nil {
			t.Fatalf("%s frontmatter: %v", rel, err)
		}
		if verr := sv.Validate(fm); verr != nil {
			t.Fatalf("%s schema validation: %v", rel, verr)
		}
	}
}

func TestTasksTemplateLintIssueKinds(t *testing.T) {
	t.Parallel()
	root := filepath.Join(t.TempDir(), "tasks-lint")
	if err := Init(root, "tasks"); err != nil {
		t.Fatal(err)
	}
	res, err := schema.Lint(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, is := range res.Issues {
		if is.Kind == "broken-link" || is.Kind == "orphan" {
			t.Fatalf("unexpected %s: %+v", is.Kind, is)
		}
	}
}

func TestInitMemoryTemplate(t *testing.T) {
	t.Parallel()
	root := filepath.Join(t.TempDir(), "kb")
	if err := Init(root, "memory"); err != nil {
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

func TestTemplatesEmbedded(t *testing.T) {
	t.Parallel()
	paths := []string{
		"templates/memory/SCHEMA.md",
		"templates/memory/index.md",
		"templates/memory/playbook.md",
		"templates/prompt/SCHEMA.md",
		"templates/prompt/index.md",
		"templates/prompt/playbook.md",
		"templates/prompt/.kiwi/schemas/prompt.json",
		"templates/prompt/.kiwi/schemas/rubric.json",
		"templates/prompt/.kiwi/config.toml",
		"templates/prompt/system-prompts/code-assistant.md",
		"templates/prompt/task-prompts/summarize.md",
		"templates/prompt/evaluation/summarize-rubric.md",
		"templates/research/SCHEMA.md",
		"templates/research/index.md",
		"templates/research/playbook.md",
		"templates/research/.kiwi/schemas/paper.json",
		"templates/research/.kiwi/workflows/reading.json",
		"templates/research/.kiwi/config.toml",
		"templates/research/papers/example-paper.md",
		"templates/adr/SCHEMA.md",
		"templates/adr/index.md",
		"templates/adr/playbook.md",
		"templates/adr/.kiwi/schemas/adr.json",
		"templates/adr/.kiwi/workflows/adr.json",
		"templates/adr/.kiwi/templates/adr.md",
		"templates/adr/.kiwi/config.toml",
		"templates/adr/decisions/ADR-001-use-markdown-for-adrs.md",
		"templates/kb/index.md",
		"templates/kb/playbook.md",
		"templates/kb/.kiwi/workflows/kb.json",
		"templates/kb/.kiwi/schemas/article.json",
		"templates/cms/index.md",
		"templates/cms/playbook.md",
		"templates/cms/.kiwi/workflows/editorial.json",
		"templates/cms/.kiwi/schemas/blog-post.json",
		"templates/data/index.md",
		"templates/data/playbook.md",
		"templates/data/.kiwi/schemas/record.json",
		"templates/log/index.md",
		"templates/log/playbook.md",
		"templates/log/.kiwi/schemas/event.json",
	}
	for _, p := range paths {
		if _, err := fs.Stat(templates, p); err != nil {
			t.Fatalf("embedded template missing %s: %v", p, err)
		}
	}
}

func TestInitPromptTemplateMetadata(t *testing.T) {
	t.Parallel()
	list, err := ListInitTemplates()
	if err != nil {
		t.Fatal(err)
	}
	var found *InitTemplate
	for i := range list {
		if list[i].ID == "prompt" {
			found = &list[i]
			break
		}
	}
	if found == nil {
		t.Fatal("prompt template not listed")
	}
	if found.Label != "Prompt" {
		t.Fatalf("label = %q, want %q", found.Label, "Prompt")
	}
	if !strings.Contains(found.Description, "prompt") {
		t.Fatalf("description should mention prompts: %q", found.Description)
	}
}

func TestInitPromptIntoEmptyParent(t *testing.T) {
	t.Parallel()
	parent := t.TempDir()
	root := filepath.Join(parent, "nested", "prompts")
	if err := Init(root, "prompt"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "index.md")); err != nil {
		t.Fatalf("expected scaffold in empty nested dir: %v", err)
	}
}

func TestInitPromptDoesNotOverwriteExisting(t *testing.T) {
	t.Parallel()
	root := filepath.Join(t.TempDir(), "prompts")
	if err := os.MkdirAll(root, 0755); err != nil {
		t.Fatal(err)
	}
	custom := []byte("# Custom index\n")
	if err := os.WriteFile(filepath.Join(root, "index.md"), custom, 0644); err != nil {
		t.Fatal(err)
	}
	if err := Init(root, "prompt"); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(root, "index.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != string(custom) {
		t.Fatalf("Init overwrote existing index.md:\n%s", data)
	}
	if _, err := os.Stat(filepath.Join(root, "SCHEMA.md")); err != nil {
		t.Fatal("expected SCHEMA.md to be created alongside existing index.md")
	}
}

func TestInitResearchTemplateIncludesReadingWorkflow(t *testing.T) {
	t.Parallel()
	root := filepath.Join(t.TempDir(), "research-ws")
	if err := Init(root, "research"); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{
		".kiwi/workflows/reading.json",
		".kiwi/schemas/paper.json",
		".kiwi/config.toml",
		".kiwi/playbook.md",
		"papers/example-paper.md",
		"papers/transformer-survey.md",
		"notes/synthesis-example.md",
		"reviews/literature-review-draft.md",
		"index.md",
		"SCHEMA.md",
	} {
		if _, err := os.Stat(filepath.Join(root, p)); err != nil {
			t.Fatalf("missing %s: %v", p, err)
		}
	}
}

func TestInitUnknownTemplate(t *testing.T) {
	t.Parallel()
	root := filepath.Join(t.TempDir(), "ws")
	err := Init(root, "not-a-template")
	if err == nil {
		t.Fatal("expected error for unknown template")
	}
	if !strings.Contains(err.Error(), "unknown template") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestPromptSchemaRejectsInvalidFrontmatter(t *testing.T) {
	t.Parallel()
	root := filepath.Join(t.TempDir(), "prompts-schema")
	if err := Init(root, "prompt"); err != nil {
		t.Fatal(err)
	}
	sv := schema.NewValidator(root)

	cases := []struct {
		name string
		fm   map[string]any
	}{
		{
			name: "missing title",
			fm: map[string]any{
				"type": "prompt", "model": "claude-sonnet-4", "label": "staging",
				"tags": []any{"test"},
			},
		},
		{
			name: "invalid label",
			fm: map[string]any{
				"type": "prompt", "title": "X", "model": "claude-sonnet-4", "label": "experimental",
				"tags": []any{"test"},
			},
		},
		{
			name: "temperature out of range",
			fm: map[string]any{
				"type": "prompt", "title": "X", "model": "claude-sonnet-4", "label": "staging",
				"temperature": 3.0, "tags": []any{"test"},
			},
		},
		{
			name: "invalid model slug",
			fm: map[string]any{
				"type": "prompt", "title": "X", "model": "bad model!", "label": "staging",
				"tags": []any{"test"},
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if verr := sv.Validate(tc.fm); verr == nil {
				t.Fatal("expected validation error")
			}
		})
	}

	rubricCases := []struct {
		name string
		fm   map[string]any
	}{
		{
			name: "missing status",
			fm: map[string]any{"type": "rubric", "title": "Rubric"},
		},
		{
			name: "invalid status",
			fm: map[string]any{"type": "rubric", "title": "Rubric", "status": "retired"},
		},
	}
	for _, tc := range rubricCases {
		t.Run("rubric/"+tc.name, func(t *testing.T) {
			if verr := sv.Validate(tc.fm); verr == nil {
				t.Fatal("expected rubric validation error")
			}
		})
	}
}

func TestPromptConfigHasAuthGuidance(t *testing.T) {
	t.Parallel()
	root := filepath.Join(t.TempDir(), "prompts-config")
	if err := Init(root, "prompt"); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(root, ".kiwi/config.toml"))
	if err != nil {
		t.Fatal(err)
	}
	content := string(data)
	for _, want := range []string{"[auth]", "127.0.0.1", "apikey", "perspace"} {
		if !strings.Contains(content, want) {
			t.Fatalf("config.toml missing %q:\n%s", want, content)
		}
	}
}
