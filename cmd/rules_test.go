package cmd

import (
	"strings"
	"testing"
)

func TestLocalFormatSkill(t *testing.T) {
	out := localFormatSkill("")
	if !strings.Contains(out, "# Team Wiki Skill") {
		t.Fatal("missing title")
	}
	if !strings.Contains(out, "kiwi_search") || !strings.Contains(out, "kiwi_read") {
		t.Fatal("missing MCP tool references")
	}
	if !strings.Contains(out, "kiwi_tree") {
		t.Fatal("missing wiki structure guidance")
	}
	if !strings.Contains(out, "deployment") {
		t.Fatal("missing example queries")
	}
}

func TestLocalFormatSkill_IncludesUserRules(t *testing.T) {
	out := localFormatSkill("- Always check the wiki first\n")
	if !strings.Contains(out, "## User rules") {
		t.Fatal("missing user rules section")
	}
	if !strings.Contains(out, "Always check the wiki first") {
		t.Fatal("missing user rules body")
	}
}

func TestLocalFormatRules_SkillFormat(t *testing.T) {
	out := localFormatRules("", "skill")
	if !strings.Contains(out, "Team Wiki Skill") {
		t.Fatal("skill format not routed")
	}
}
