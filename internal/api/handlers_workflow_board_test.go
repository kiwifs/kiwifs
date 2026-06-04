package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWorkflowBoardBlockedBy(t *testing.T) {
	s, root := buildTestServerWithRoot(t)
	workflowDir := filepath.Join(root, ".kiwi", "workflows")
	if err := os.MkdirAll(workflowDir, 0755); err != nil {
		t.Fatalf("mkdir workflows: %v", err)
	}
	if err := os.WriteFile(filepath.Join(workflowDir, "tasks.json"), []byte(`{
		"name":"tasks",
		"states":[
			{"name":"todo","color":"#111111"},
			{"name":"in_progress","color":"#222222"},
			{"name":"done","color":"#333333","terminal":true}
		],
		"transitions":[{"from":"todo","to":"in_progress"},{"from":"in_progress","to":"done"}]
	}`), 0644); err != nil {
		t.Fatalf("write workflow: %v", err)
	}

	mustPutFile(t, s, "tasks/blocker.md", `---
title: Blocker task
workflow: tasks
state: todo
---
`)
	mustPutFile(t, s, "tasks/blocked.md", `---
title: Blocked task
workflow: tasks
state: todo
blocked-by:
  - tasks/blocker.md
---
`)

	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/workflow/board/tasks", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET board: %d %s", rec.Code, rec.Body.String())
	}

	var payload struct {
		Board map[string][]map[string]any `json:"board"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	todo := payload.Board["todo"]
	var blocked map[string]any
	for _, card := range todo {
		if card["path"] == "tasks/blocked.md" {
			blocked = card
			break
		}
	}
	if blocked == nil {
		t.Fatalf("blocked card missing from todo column: %v", todo)
	}
	if blocked["blocked"] != true {
		t.Fatalf("expected blocked=true, got %v", blocked["blocked"])
	}
	reason, _ := blocked["block_reason"].(string)
	if !strings.Contains(reason, "Blocker task") {
		t.Fatalf("expected blocker title in block_reason, got %q", reason)
	}
}

func TestWorkflowBoardBlockedByClearsWhenBlockerDone(t *testing.T) {
	s, root := buildTestServerWithRoot(t)
	workflowDir := filepath.Join(root, ".kiwi", "workflows")
	if err := os.MkdirAll(workflowDir, 0755); err != nil {
		t.Fatalf("mkdir workflows: %v", err)
	}
	if err := os.WriteFile(filepath.Join(workflowDir, "tasks.json"), []byte(`{
		"name":"tasks",
		"states":[
			{"name":"todo","color":"#111111"},
			{"name":"done","color":"#222222","terminal":true}
		],
		"transitions":[{"from":"todo","to":"done"}]
	}`), 0644); err != nil {
		t.Fatalf("write workflow: %v", err)
	}

	mustPutFile(t, s, "tasks/blocker.md", `---
title: Done blocker
workflow: tasks
state: done
---
`)
	mustPutFile(t, s, "tasks/blocked.md", `---
title: Ready task
workflow: tasks
state: todo
blocked-by:
  - tasks/blocker.md
---
`)

	req := httptest.NewRequest(http.MethodGet, "/api/kiwi/workflow/board/tasks", nil)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET board: %d %s", rec.Code, rec.Body.String())
	}

	var payload struct {
		Board map[string][]map[string]any `json:"board"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	for _, card := range payload.Board["todo"] {
		if card["path"] == "tasks/blocked.md" {
			if _, ok := card["blocked"]; ok {
				t.Fatalf("expected no blocked flag when blocker is done, got %v", card)
			}
			return
		}
	}
	t.Fatal("ready task not found on board")
}
