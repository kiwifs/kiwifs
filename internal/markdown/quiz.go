package markdown

import (
	"fmt"
	"regexp"
	"strings"
)

// Kiwi Quiz callouts. Keep this in step with ui/src/lib/quizBlock.ts.

var (
	quizFenceRe  = regexp.MustCompile("^\\s*```")
	quizStartRe  = regexp.MustCompile(`(?i)^\s{0,3}>\s*\[!quiz\b`)
	quizQuoteRe  = regexp.MustCompile(`^\s{0,3}>`)
	quizUnwrapRe = regexp.MustCompile(`^\s{0,3}>\s?`)
	quizTagRe    = regexp.MustCompile(`(?i)^\[!quiz((?:\s+[^\s\]]+)*)\]\s*([\s\S]*)$`)
	quizTaskRe   = regexp.MustCompile(`^[-*+]\s+\[([ xX])\]\s+(.*)$`)
	quizBulletRe = regexp.MustCompile(`^[-*+]\s+(.*)$`)
	quizNumberRe = regexp.MustCompile(`^\d+[.)]\s+(.*)$`)
	quizIDRe     = regexp.MustCompile(`[^A-Za-z0-9_-]`)
)

var quizKindAlias = map[string]string{
	"single": "single", "one": "single", "choice": "single",
	"multi": "multi", "multiple": "multi",
	"boolean": "boolean", "tf": "boolean", "truefalse": "boolean",
	"order": "order", "reorder": "order",
	"match": "match",
	"short": "short",
}

// QuizReport is a quiz callout with its question and any authoring problems.
// Answer keys are not included.
type QuizReport struct {
	Line     int      `json:"line"`
	Kind     string   `json:"kind,omitempty"`
	ID       string   `json:"id,omitempty"`
	Prompt   string   `json:"prompt,omitempty"`
	Problems []string `json:"problems,omitempty"`
}

// QuizChoice is one option in a formatted quiz.
type QuizChoice struct {
	Text     string
	Correct  bool
	Feedback string
}

// QuizMatch is one pair in a formatted match quiz.
type QuizMatch struct {
	Left  string
	Right string
}

// QuizDraft is the structured form kiwi_quiz turns into a callout.
type QuizDraft struct {
	Kind        string
	ID          string
	Shuffle     bool
	Prompt      string
	Explanation string
	Options     []QuizChoice
	Items       []string
	Pairs       []QuizMatch
	Answer      string
	Accept      []string
}

type quizItem struct {
	text     string
	correct  bool
	feedback []string
}

// RedactQuiz replaces each quiz callout with its question so answers are not
// indexed or shown in search snippets.
func RedactQuiz(content string) string {
	lines := strings.Split(content, "\n")
	out := make([]string, 0, len(lines))
	inFence := false
	for i := 0; i < len(lines); {
		line := trimCR(lines[i])
		if quizFenceRe.MatchString(strings.TrimSpace(line)) {
			inFence = !inFence
			out = append(out, line)
			i++
			continue
		}
		if !inFence && quizStartRe.MatchString(line) {
			start := i
			i++
			for i < len(lines) && quizQuoteRe.MatchString(trimCR(lines[i])) {
				i++
			}
			raw := strings.Join(lines[start:i], "\n")
			prompt := ""
			if spec, ok := parseQuiz(raw); ok {
				prompt = strings.TrimSpace(spec.prompt)
			}
			if prompt == "" {
				prompt = "Quiz"
			}
			out = append(out, prompt)
			continue
		}
		out = append(out, line)
		i++
	}
	return strings.Join(out, "\n")
}

// CheckQuizzes lists quiz callouts. Problems describe the markup, not the key.
func CheckQuizzes(content string) []QuizReport {
	var reports []QuizReport
	lines := strings.Split(content, "\n")
	inFence := false
	for i := 0; i < len(lines); {
		line := trimCR(lines[i])
		if quizFenceRe.MatchString(strings.TrimSpace(line)) {
			inFence = !inFence
			i++
			continue
		}
		if !inFence && quizStartRe.MatchString(line) {
			start := i
			i++
			for i < len(lines) && quizQuoteRe.MatchString(trimCR(lines[i])) {
				i++
			}
			raw := strings.Join(lines[start:i], "\n")
			if spec, ok := parseQuiz(raw); ok {
				reports = append(reports, QuizReport{
					Line:     start + 1,
					Kind:     spec.kind,
					ID:       spec.id,
					Prompt:   spec.prompt,
					Problems: spec.problems,
				})
			}
			continue
		}
		i++
	}
	return reports
}

// FormatQuiz writes a callout the page renderer accepts.
func FormatQuiz(in QuizDraft) (string, error) {
	kind := quizKindAlias[strings.ToLower(strings.TrimSpace(in.Kind))]
	if kind == "" {
		return "", fmt.Errorf("kind must be single, multi, boolean, order, match, or short")
	}
	prompt := strings.TrimSpace(in.Prompt)
	if prompt == "" {
		return "", fmt.Errorf("prompt is required")
	}
	id := quizIDRe.ReplaceAllString(strings.TrimPrefix(strings.TrimSpace(in.ID), "^"), "")
	var b strings.Builder
	b.WriteString("> [!quiz ")
	b.WriteString(kind)
	if in.Shuffle {
		b.WriteString(" shuffle")
	}
	if id != "" {
		b.WriteString(" ^")
		b.WriteString(id)
	}
	b.WriteString("] ")
	b.WriteString(prompt)
	b.WriteByte('\n')

	switch kind {
	case "single", "multi":
		if len(in.Options) < 2 {
			return "", fmt.Errorf("%s quiz needs at least two options", kind)
		}
		marked := 0
		for _, opt := range in.Options {
			if strings.TrimSpace(opt.Text) == "" {
				return "", fmt.Errorf("option text is required")
			}
			if opt.Correct {
				marked++
			}
		}
		if kind == "single" && marked != 1 {
			return "", fmt.Errorf("single quiz needs exactly one correct option")
		}
		if kind == "multi" && marked < 1 {
			return "", fmt.Errorf("multi quiz needs at least one correct option")
		}
		writeChoices(&b, in.Options)
	case "boolean":
		if len(in.Options) > 0 {
			writeChoices(&b, in.Options)
			break
		}
		answer := strings.ToLower(strings.TrimSpace(in.Answer))
		if answer == "yes" {
			answer = "true"
		}
		if answer == "no" {
			answer = "false"
		}
		if answer != "true" && answer != "false" {
			return "", fmt.Errorf("boolean answer must be true or false")
		}
		b.WriteString("> ")
		b.WriteString(answer)
		b.WriteByte('\n')
	case "order":
		if len(in.Items) < 2 {
			return "", fmt.Errorf("order quiz needs at least two items")
		}
		for _, item := range in.Items {
			if strings.TrimSpace(item) == "" {
				return "", fmt.Errorf("order items cannot be empty")
			}
			b.WriteString("> - ")
			b.WriteString(strings.TrimSpace(item))
			b.WriteByte('\n')
		}
	case "match":
		if len(in.Pairs) < 2 {
			return "", fmt.Errorf("match quiz needs at least two pairs")
		}
		for _, pair := range in.Pairs {
			if strings.TrimSpace(pair.Left) == "" || strings.TrimSpace(pair.Right) == "" {
				return "", fmt.Errorf("match pairs need a left and a right")
			}
			b.WriteString("> - ")
			b.WriteString(strings.TrimSpace(pair.Left))
			b.WriteString(" :: ")
			b.WriteString(strings.TrimSpace(pair.Right))
			b.WriteByte('\n')
		}
	case "short":
		answers := make([]string, 0, 1+len(in.Accept))
		if strings.TrimSpace(in.Answer) != "" {
			answers = append(answers, strings.TrimSpace(in.Answer))
		}
		for _, extra := range in.Accept {
			if strings.TrimSpace(extra) != "" {
				answers = append(answers, strings.TrimSpace(extra))
			}
		}
		if len(answers) == 0 {
			return "", fmt.Errorf("short quiz needs an accepted answer")
		}
		b.WriteString("> ")
		b.WriteString(strings.Join(answers, " | "))
		b.WriteByte('\n')
	}
	if strings.TrimSpace(in.Explanation) != "" {
		b.WriteString(">\n")
		for _, line := range strings.Split(in.Explanation, "\n") {
			b.WriteString("> ")
			b.WriteString(line)
			b.WriteByte('\n')
		}
	}
	return b.String(), nil
}

func writeChoices(b *strings.Builder, options []QuizChoice) {
	for _, opt := range options {
		mark := " "
		if opt.Correct {
			mark = "x"
		}
		fmt.Fprintf(b, "> - [%s] %s\n", mark, strings.TrimSpace(opt.Text))
		if strings.TrimSpace(opt.Feedback) != "" {
			for _, line := range strings.Split(strings.TrimSpace(opt.Feedback), "\n") {
				b.WriteString(">   ")
				b.WriteString(line)
				b.WriteByte('\n')
			}
		}
	}
}

type parsedQuiz struct {
	kind     string
	id       string
	prompt   string
	problems []string
}

func parseQuiz(raw string) (parsedQuiz, bool) {
	text := strings.TrimLeft(unwrapQuiz(raw), "\n")
	if strings.TrimSpace(text) == "" {
		return parsedQuiz{}, false
	}
	lines := strings.Split(text, "\n")
	tag := quizTagRe.FindStringSubmatch(lines[0])
	if tag == nil {
		return parsedQuiz{}, false
	}
	var spec parsedQuiz
	var problems []string
	for _, token := range strings.Fields(tag[1]) {
		if strings.EqualFold(token, "shuffle") {
			continue
		}
		if strings.HasPrefix(token, "^") {
			spec.id = quizIDRe.ReplaceAllString(token[1:], "")
			continue
		}
		mapped, ok := quizKindAlias[strings.ToLower(token)]
		if !ok {
			problems = append(problems, fmt.Sprintf("Unknown quiz flag %q.", token))
			continue
		}
		if spec.kind != "" && spec.kind != mapped {
			problems = append(problems, "A quiz can only have one kind.")
			continue
		}
		spec.kind = mapped
	}

	body := lines[1:]
	if spec.kind == "short" || spec.kind == "boolean" {
		if free, list := parseQuizFreeform(body, strings.TrimSpace(tag[2])); !list {
			spec.prompt = free.prompt
			if spec.prompt == "" {
				problems = append(problems, "This quiz needs a question.")
			}
			if spec.kind == "short" {
				if len(splitAnswers(free.answer)) == 0 {
					problems = append(problems, "A short-answer quiz needs an accepted answer.")
				}
			} else if !truthy(free.answer) {
				problems = append(problems, "A true/false quiz needs an answer of true or false.")
			}
			spec.problems = uniqueStrings(problems)
			return spec, true
		}
	}

	parsed := parseQuizItems(body, strings.TrimSpace(tag[2]))
	spec.prompt = parsed.prompt
	if spec.prompt == "" {
		problems = append(problems, "This quiz needs a question.")
	}
	if spec.kind == "" {
		switch {
		case len(parsed.items) == 0:
			problems = append(problems, "Name a quiz kind: single, multi, boolean, order, match, or short.")
		case countCorrect(parsed.items) > 1:
			spec.kind = "multi"
		case countCorrect(parsed.items) == 1:
			spec.kind = "single"
		case len(parsed.items) > 0 && allPairs(parsed.items):
			spec.kind = "match"
		default:
			spec.kind = "order"
		}
	}
	switch spec.kind {
	case "order":
		if len(parsed.items) < 2 {
			problems = append(problems, "An order quiz needs at least two items.")
		}
	case "match":
		bad := false
		for _, item := range parsed.items {
			if !strings.Contains(item.text, "::") {
				problems = append(problems, "Match items need a left :: right pair.")
				bad = true
			}
		}
		if !bad && len(parsed.items) < 2 {
			problems = append(problems, "A match quiz needs at least two pairs.")
		}
	case "short":
		problems = append(problems, "A short-answer quiz needs an accepted answer.")
	case "single":
		if countCorrect(parsed.items) != 1 {
			problems = append(problems, "A choose-one quiz needs exactly one [x].")
		}
		if len(parsed.items) < 2 {
			problems = append(problems, "This quiz needs at least two options.")
		}
	case "multi":
		if countCorrect(parsed.items) < 1 {
			problems = append(problems, "A select-all quiz needs at least one [x].")
		}
		if len(parsed.items) < 2 {
			problems = append(problems, "This quiz needs at least two options.")
		}
	case "boolean":
		if countCorrect(parsed.items) != 1 {
			problems = append(problems, "A true/false quiz needs exactly one [x].")
		}
	}
	spec.problems = uniqueStrings(problems)
	return spec, true
}

type quizFreeform struct {
	prompt string
	answer string
}

func parseQuizFreeform(body []string, tagPrompt string) (quizFreeform, bool) {
	var content []struct {
		line  string
		index int
	}
	for i, line := range body {
		if strings.TrimSpace(line) != "" {
			content = append(content, struct {
				line  string
				index int
			}{line, i})
		}
	}
	if len(content) == 0 {
		return quizFreeform{prompt: tagPrompt}, false
	}
	if parseQuizOption(content[0].line) != nil {
		return quizFreeform{}, true
	}
	if tagPrompt != "" {
		return quizFreeform{prompt: tagPrompt, answer: strings.TrimSpace(content[0].line)}, false
	}
	answer := ""
	if len(content) > 1 {
		answer = strings.TrimSpace(content[1].line)
	}
	return quizFreeform{prompt: strings.TrimSpace(content[0].line), answer: answer}, false
}

func parseQuizItems(body []string, tagPrompt string) struct {
	prompt string
	items  []quizItem
} {
	prompt := []string{}
	if tagPrompt != "" {
		prompt = append(prompt, tagPrompt)
	}
	var items []quizItem
	phase := "prompt"
	for _, line := range body {
		if phase == "explain" {
			continue
		}
		if opt := parseQuizOption(line); opt != nil {
			phase = "items"
			items = append(items, *opt)
			continue
		}
		if phase == "items" && strings.TrimSpace(line) == "" {
			continue
		}
		if phase == "items" && strings.TrimSpace(line) != "" && (strings.HasPrefix(line, " ") || strings.HasPrefix(line, "\t")) && len(items) > 0 {
			items[len(items)-1].feedback = append(items[len(items)-1].feedback, strings.TrimSpace(line))
			continue
		}
		if phase == "prompt" {
			if strings.TrimSpace(line) != "" {
				prompt = append(prompt, strings.TrimSpace(line))
			}
			continue
		}
		phase = "explain"
	}
	return struct {
		prompt string
		items  []quizItem
	}{strings.TrimSpace(strings.Join(prompt, "\n")), items}
}

func parseQuizOption(line string) *quizItem {
	if m := quizTaskRe.FindStringSubmatch(line); m != nil {
		return &quizItem{text: strings.TrimSpace(m[2]), correct: strings.EqualFold(m[1], "x")}
	}
	if m := quizBulletRe.FindStringSubmatch(line); m != nil {
		return &quizItem{text: strings.TrimSpace(m[1])}
	}
	if m := quizNumberRe.FindStringSubmatch(line); m != nil {
		return &quizItem{text: strings.TrimSpace(m[1])}
	}
	return nil
}

func unwrapQuiz(raw string) string {
	raw = strings.ReplaceAll(raw, "\r\n", "\n")
	lines := strings.Split(raw, "\n")
	for i, line := range lines {
		lines[i] = quizUnwrapRe.ReplaceAllString(line, "")
	}
	return strings.Join(lines, "\n")
}

func trimCR(line string) string {
	return strings.TrimRight(line, "\r")
}

func splitAnswers(answer string) []string {
	var out []string
	for _, part := range strings.Split(answer, "|") {
		if strings.TrimSpace(part) != "" {
			out = append(out, strings.TrimSpace(part))
		}
	}
	return out
}

func truthy(answer string) bool {
	switch strings.ToLower(strings.TrimSpace(answer)) {
	case "true", "false", "yes", "no":
		return true
	default:
		return false
	}
}

func countCorrect(items []quizItem) int {
	n := 0
	for _, item := range items {
		if item.correct {
			n++
		}
	}
	return n
}

func allPairs(items []quizItem) bool {
	if len(items) == 0 {
		return false
	}
	for _, item := range items {
		if !strings.Contains(item.text, "::") {
			return false
		}
	}
	return true
}

func lintQuizCallouts(content []byte) []LintIssue {
	var issues []LintIssue
	for _, quiz := range CheckQuizzes(string(content)) {
		for _, problem := range quiz.Problems {
			issues = append(issues, LintIssue{
				Rule:     "quiz-invalid",
				Line:     quiz.Line,
				Message:  problem,
				Severity: "error",
			})
		}
	}
	return issues
}

func uniqueStrings(in []string) []string {
	if len(in) == 0 {
		return nil
	}
	seen := map[string]bool{}
	var out []string
	for _, item := range in {
		if seen[item] {
			continue
		}
		seen[item] = true
		out = append(out, item)
	}
	return out
}
