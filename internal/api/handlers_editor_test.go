package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/kiwifs/kiwifs/internal/config"
	"github.com/kiwifs/kiwifs/internal/slashcommands"
)

type editorSlashCommandsResponse = slashcommands.Resolved

func writeSpaceFile(t *testing.T, root, rel, content string) {
	t.Helper()
	p := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func getSlashCommands(t *testing.T, s *Server) editorSlashCommandsResponse {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/editor/slash-commands", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var res editorSlashCommandsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	return res
}

func TestGetEditorSlashCommands_EmptyWhenUnset(t *testing.T) {
	s := buildTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/editor/slash-commands", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var res editorSlashCommandsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if len(res.Commands) != 0 {
		t.Fatalf("expected no commands, got %+v", res.Commands)
	}
}

func TestGetEditorSlashCommands_FromConfig(t *testing.T) {
	dir, pipe, cstore := buildTestPipeline(t)
	writeSpaceFile(t, dir, "templates/adr.md", "# ADR\n\n## Context\n")
	writeSpaceFile(t, dir, "templates/runbook-step.md", "1. step\n")
	cfg := &config.Config{}
	cfg.Storage.Root = dir
	cfg.UI.Editor.SlashCommands = []config.SlashCommandConfig{
		{
			ID:          "adr",
			Label:       "ADR",
			Icon:        "FileCheck",
			Description: "Insert ADR template",
			Template:    "templates/adr.md",
		},
		{
			ID:       "",
			Template: "templates/skip.md",
		},
		{
			ID:       "no-template",
			Label:    "Skip me",
			Template: "",
		},
	}
	s := NewServer(cfg, pipe, nil, cstore, nil, nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/editor/slash-commands", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var res editorSlashCommandsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if len(res.Commands) != 1 {
		t.Fatalf("expected 1 command, got %+v", res.Commands)
	}
	cmd := res.Commands[0]
	if cmd.ID != "adr" || cmd.Label != "ADR" || cmd.Icon != "FileCheck" {
		t.Fatalf("unexpected command: %+v", cmd)
	}
	if cmd.Description != "Insert ADR template" || cmd.Template != "templates/adr.md" {
		t.Fatalf("unexpected metadata: %+v", cmd)
	}
	if cmd.Insert != "# ADR\n\n## Context\n" {
		t.Fatalf("template content should be resolved server-side: %q", cmd.Insert)
	}
	if len(res.Warnings) != 2 {
		t.Fatalf("expected a warning per skipped entry, got %v", res.Warnings)
	}
}

func TestGetEditorSlashCommands_DefaultLabelFromID(t *testing.T) {
	dir, pipe, cstore := buildTestPipeline(t)
	writeSpaceFile(t, dir, "templates/adr.md", "# ADR\n\n## Context\n")
	writeSpaceFile(t, dir, "templates/runbook-step.md", "1. step\n")
	cfg := &config.Config{}
	cfg.Storage.Root = dir
	cfg.UI.Editor.SlashCommands = []config.SlashCommandConfig{{
		ID:       "runbook",
		Template: "templates/runbook-step.md",
	}}
	s := NewServer(cfg, pipe, nil, cstore, nil, nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/editor/slash-commands", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)

	var res editorSlashCommandsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if len(res.Commands) != 1 || res.Commands[0].Label != "runbook" {
		t.Fatalf("label fallback failed: %+v", res.Commands)
	}
}

func TestGetEditorSlashCommands_SkipsInvalidID(t *testing.T) {
	dir, pipe, cstore := buildTestPipeline(t)
	writeSpaceFile(t, dir, "templates/adr.md", "# ADR\n\n## Context\n")
	writeSpaceFile(t, dir, "templates/runbook-step.md", "1. step\n")
	cfg := &config.Config{}
	cfg.Storage.Root = dir
	cfg.UI.Editor.SlashCommands = []config.SlashCommandConfig{
		{ID: "bad id", Label: "Spaces", Template: "templates/bad.md"},
		{ID: "adr", Label: "ADR", Template: "templates/adr.md"},
	}
	s := NewServer(cfg, pipe, nil, cstore, nil, nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/editor/slash-commands", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)

	var res editorSlashCommandsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if len(res.Commands) != 1 || res.Commands[0].ID != "adr" {
		t.Fatalf("expected only valid id, got %+v", res.Commands)
	}
}

func TestGetEditorSlashCommands_TrimsAndDefaultsIcon(t *testing.T) {
	dir, pipe, cstore := buildTestPipeline(t)
	writeSpaceFile(t, dir, "templates/adr.md", "# ADR\n\n## Context\n")
	writeSpaceFile(t, dir, "templates/runbook-step.md", "1. step\n")
	cfg := &config.Config{}
	cfg.Storage.Root = dir
	cfg.UI.Editor.SlashCommands = []config.SlashCommandConfig{{
		ID:          "  adr  ",
		Label:       "  ADR  ",
		Description: "  Insert ADR  ",
		Template:    "  templates/adr.md  ",
	}}
	s := NewServer(cfg, pipe, nil, cstore, nil, nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/editor/slash-commands", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)

	var res editorSlashCommandsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if len(res.Commands) != 1 {
		t.Fatalf("expected 1 command, got %+v", res.Commands)
	}
	cmd := res.Commands[0]
	if cmd.ID != "adr" || cmd.Label != "ADR" || cmd.Template != "templates/adr.md" {
		t.Fatalf("trim failed: %+v", cmd)
	}
	if cmd.Icon != "FileText" || cmd.Description != "Insert ADR" {
		t.Fatalf("defaults failed: %+v", cmd)
	}
}

func newSpaceServer(t *testing.T, slashFile string) *Server {
	t.Helper()
	dir, pipe, cstore := buildTestPipeline(t)
	if slashFile != "" {
		writeSpaceFile(t, dir, slashcommands.DefaultFile, slashFile)
	}
	cfg := &config.Config{}
	cfg.Storage.Root = dir
	return NewServer(cfg, pipe, nil, cstore, nil, nil, nil)
}

func TestGetEditorSlashCommands_PerSpaceFile(t *testing.T) {
	a := newSpaceServer(t, "hide = [\"quiz\"]\n[[commands]]\nid = \"assigned\"\ninsert = \"[assigned:: agent]\"\n")
	b := newSpaceServer(t, "[[commands]]\nid = \"decision\"\ninsert = \"## Decision\"\n")

	ra := getSlashCommands(t, a)
	rb := getSlashCommands(t, b)
	if len(ra.Commands) != 1 || ra.Commands[0].ID != "assigned" || ra.Commands[0].Insert != "[assigned:: agent]" {
		t.Fatalf("space a: %+v", ra)
	}
	if len(ra.Hide) != 1 || ra.Hide[0] != "quiz" {
		t.Fatalf("space a hide: %+v", ra.Hide)
	}
	if len(rb.Commands) != 1 || rb.Commands[0].ID != "decision" || len(rb.Hide) != 0 {
		t.Fatalf("space b: %+v", rb)
	}
}

func TestGetEditorSlashCommands_FileEditsApplyWithoutRestart(t *testing.T) {
	s, dir := buildTestServerWithRoot(t)
	if res := getSlashCommands(t, s); len(res.Commands) != 0 {
		t.Fatalf("expected none, got %+v", res.Commands)
	}

	writeSpaceFile(t, dir, slashcommands.DefaultFile, "[[commands]]\nid = \"live\"\ninsert = \"x\"\n")
	res := getSlashCommands(t, s)
	if len(res.Commands) != 1 || res.Commands[0].ID != "live" {
		t.Fatalf("edit not picked up: %+v", res)
	}

	writeSpaceFile(t, dir, slashcommands.DefaultFile, "[[commands]\n")
	res = getSlashCommands(t, s)
	if len(res.Commands) != 0 || len(res.Warnings) != 1 {
		t.Fatalf("broken file should produce one warning: %+v", res)
	}
}

func TestGetEditorSlashCommands_FileIsEditableThroughFileAPI(t *testing.T) {
	s := buildTestServer(t)
	mustPutFile(t, s, slashcommands.DefaultFile, "[[commands]]\nid = \"viaapi\"\ninsert = \"x\"\n")
	res := getSlashCommands(t, s)
	if len(res.Commands) != 1 || res.Commands[0].ID != "viaapi" {
		t.Fatalf("got %+v", res)
	}
}
