package markdown

import "testing"

func TestParseFrontmatterAndHeadings(t *testing.T) {
	input := []byte("---\ntitle: Hello\ntags: [a, b]\n---\n\n# Top\n\n## Section Two\n\nbody\n\n### Deep\n")
	p, err := Parse(input)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if p.Frontmatter["title"] != "Hello" {
		t.Fatalf("frontmatter: %v", p.Frontmatter)
	}
	if len(p.Headings) != 3 {
		t.Fatalf("want 3 headings, got %d: %v", len(p.Headings), p.Headings)
	}
	if p.Headings[0].Text != "Top" || p.Headings[0].Level != 1 {
		t.Fatalf("heading 0: %+v", p.Headings[0])
	}
	if p.Headings[1].Slug != "section-two" {
		t.Fatalf("slug: %s", p.Headings[1].Slug)
	}
}

func TestTasks_ExtractTasks(t *testing.T) {
	input := []byte(`---
title: Test
---

# Todos

- [x] Buy groceries #shopping
- [ ] Send email [due:: 2026-05-01]
  - [ ] Follow up by Friday
- Regular list item (not a task)
- [ ] Read chapter 3 #study #math
`)
	tasks := Tasks(input)
	if len(tasks) < 3 {
		t.Fatalf("got %d tasks, want at least 3", len(tasks))
	}

	// First task: completed, has tag
	if !tasks[0].Completed {
		t.Error("task[0] should be completed")
	}
	if tasks[0].Text == "" {
		t.Error("task[0] has empty text")
	}
	found := false
	for _, tag := range tasks[0].Tags {
		if tag == "shopping" {
			found = true
		}
	}
	if !found {
		t.Errorf("task[0] tags = %v, want #shopping", tasks[0].Tags)
	}

	// Second task: not completed, has due metadata
	if tasks[1].Completed {
		t.Error("task[1] should not be completed")
	}
	if tasks[1].Due != "2026-05-01" {
		t.Errorf("task[1] due = %q, want 2026-05-01", tasks[1].Due)
	}

	// Last task: has multiple tags
	last := tasks[len(tasks)-1]
	if len(last.Tags) < 2 {
		t.Errorf("last task tags = %v, want at least 2", last.Tags)
	}
}

func TestSlugify(t *testing.T) {
	cases := map[string]string{
		"Hello World":         "hello-world",
		"  A/B  c ":           "ab-c",
		"---dash":             "dash",
		"Already-OK_thing":    "already-ok-thing",
	}
	for in, want := range cases {
		if got := Slugify(in); got != want {
			t.Fatalf("Slugify(%q)=%q, want %q", in, got, want)
		}
	}
}
