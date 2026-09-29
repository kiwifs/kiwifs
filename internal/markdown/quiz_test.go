package markdown

import (
	"strings"
	"testing"
)

func TestFormatQuizRoundTrip(t *testing.T) {
	text, err := FormatQuiz(QuizDraft{
		Kind:        "single",
		ID:          "first-step",
		Prompt:      "What comes first?",
		Explanation: "Requirements, about 5 minutes.",
		Options: []QuizChoice{
			{Text: "Drawing", Correct: false, Feedback: "Too early."},
			{Text: "Requirements", Correct: true},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	reports := CheckQuizzes(text)
	if len(reports) != 1 {
		t.Fatalf("reports = %+v", reports)
	}
	if reports[0].Kind != "single" || reports[0].ID != "first-step" || reports[0].Prompt != "What comes first?" {
		t.Fatalf("report = %+v", reports[0])
	}
	if len(reports[0].Problems) != 0 {
		t.Fatalf("problems = %v", reports[0].Problems)
	}
	if strings.Contains(text, "[x] Requirements") == false {
		t.Fatalf("missing answer mark:\n%s", text)
	}
}

func TestCheckQuizzesKinds(t *testing.T) {
	content := strings.Join([]string{
		"# Page",
		"",
		"> [!quiz order] Put these in order",
		"> - Requirements",
		"> - API",
		"",
		"> [!quiz short] How many boxes?",
		"> 7 | seven",
		"",
		"> [!quiz boolean] Skip data flow for a request API.",
		"> false",
		"",
		"> [!quiz single] Broken",
		"> - [x] A",
		"> - [x] B",
		"",
		"```",
		"> [!quiz] hidden xyzzy-answer",
		"> - [x] inside a fence",
		"```",
	}, "\n")
	reports := CheckQuizzes(content)
	if len(reports) != 4 {
		t.Fatalf("got %d quizzes, want 4: %+v", len(reports), reports)
	}
	if reports[0].Kind != "order" || reports[1].Kind != "short" || reports[2].Kind != "boolean" {
		t.Fatalf("kinds = %s %s %s", reports[0].Kind, reports[1].Kind, reports[2].Kind)
	}
	if len(reports[3].Problems) == 0 {
		t.Fatal("expected a problem for two checked answers")
	}
}

func TestRedactQuizDropsAnswers(t *testing.T) {
	content := "# Page\n\n> [!quiz single] What comes first in the interview?\n> - [x] Requirements xyzzy\n> - [ ] Drawing\n\nLater prose.\n"
	got := RedactQuiz(content)
	if strings.Contains(got, "xyzzy") || strings.Contains(got, "Drawing") {
		t.Fatalf("answer leaked:\n%s", got)
	}
	if !strings.Contains(got, "What comes first in the interview?") || !strings.Contains(got, "Later prose.") {
		t.Fatalf("question or prose dropped:\n%s", got)
	}
	fenced := "```\n> [!quiz] Q\n> - [x] xyzzy\n```\n"
	if !strings.Contains(RedactQuiz(fenced), "xyzzy") {
		t.Fatal("redacted a quiz inside a code fence")
	}
}

func TestLintQuizInvalid(t *testing.T) {
	content := []byte("---\ntitle: T\n---\n\n> [!quiz single] Q\n> - [x] A\n> - [x] B\n")
	var found bool
	for _, issue := range LintMarkdown(content) {
		if issue.Rule == "quiz-invalid" {
			found = true
		}
	}
	if !found {
		t.Fatal("expected quiz-invalid")
	}
}
