package mcpserver

import (
	"strings"
	"testing"
)

func TestKiwiQuizFormatsCallout(t *testing.T) {
	text := mustCallTool(t, handleQuiz(nil), "kiwi_quiz", map[string]any{
		"kind":   "single",
		"id":     "first-step",
		"prompt": "What comes first?",
		"options": []any{
			map[string]any{"text": "Drawing", "correct": false},
			map[string]any{"text": "Requirements", "correct": true},
		},
		"explanation": "Requirements come before the diagram.",
	})
	if !strings.Contains(text, "> [!quiz single ^first-step] What comes first?") {
		t.Fatalf("callout = %s", text)
	}
	if !strings.Contains(text, "> - [x] Requirements") {
		t.Fatalf("missing key: %s", text)
	}
}

func TestKiwiQuizCheckOmitsAnswerKey(t *testing.T) {
	text := mustCallTool(t, handleQuiz(nil), "kiwi_quiz", map[string]any{
		"content": "> [!quiz single] What comes first?\n> - [x] Requirements\n> - [ ] Drawing\n",
	})
	if strings.Contains(text, "Requirements") && strings.Contains(text, "Drawing") {
		t.Fatalf("check repeated the options: %s", text)
	}
	if !strings.Contains(text, "What comes first?") || !strings.Contains(text, "single") {
		t.Fatalf("check = %s", text)
	}
}
