package preferences

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestUserID(t *testing.T) {
	tests := []struct {
		actor string
		want  string
	}{
		{"alice@example.com", "alice_at_example.com"},
		{"human:bot", "human_bot"},
		{"", ""},
		{"  ", ""},
		{"..", ""},
		{".", ""},
	}
	for _, tt := range tests {
		got := UserID(tt.actor)
		if got != tt.want {
			t.Errorf("UserID(%q) = %q, want %q", tt.actor, got, tt.want)
		}
	}
}

func TestUserID_RejectsPathTraversal(t *testing.T) {
	for _, actor := range []string{"..", "."} {
		userID := UserID(actor)
		if userID != "" {
			t.Fatalf("UserID(%q) = %q, want empty", actor, userID)
		}
	}
	for _, actor := range []string{"alice@example.com", "human:bot"} {
		userID := UserID(actor)
		rel := filepath.ToSlash(filepath.Clean(RelPath(userID)))
		if !strings.HasPrefix(rel, ".kiwi/users/") {
			t.Fatalf("UserID(%q) rel %q escapes users dir", actor, rel)
		}
	}
}

func TestIsPersistableUser(t *testing.T) {
	if IsPersistableUser("anonymous") || IsPersistableUser("human:web-ui") {
		t.Fatal("expected default actors to be non-persistable")
	}
	if !IsPersistableUser("alice@example.com") {
		t.Fatal("expected email actor to be persistable")
	}
}

func TestLoadSaveRoundTrip(t *testing.T) {
	root := t.TempDir()
	userID := UserID("alice@example.com")
	collapsed := true
	lineNums := false
	vim := true

	prefs := Preferences{
		Theme:             "ocean",
		SidebarCollapsed:  &collapsed,
		DefaultView:       "source",
		FontSize:          "lg",
		EditorLineNumbers: &lineNums,
		VimMode:           &vim,
	}
	rel, err := Save(root, userID, prefs)
	if err != nil {
		t.Fatal(err)
	}
	if rel != ".kiwi/users/alice_at_example.com/preferences.json" {
		t.Fatalf("rel = %q", rel)
	}

	loaded, err := Load(root, userID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Theme != "ocean" {
		t.Fatalf("theme = %q", loaded.Theme)
	}
	if loaded.SidebarCollapsed == nil || !*loaded.SidebarCollapsed {
		t.Fatalf("sidebar_collapsed = %+v", loaded.SidebarCollapsed)
	}
	if loaded.DefaultView != "source" {
		t.Fatalf("default_view = %q", loaded.DefaultView)
	}

	data, err := os.ReadFile(filepath.Join(root, rel))
	if err != nil {
		t.Fatal(err)
	}
	if len(data) == 0 {
		t.Fatal("expected written preferences file")
	}
}

func TestMergePartialUpdate(t *testing.T) {
	collapsed := true
	base := Preferences{Theme: "kiwi", SidebarCollapsed: &collapsed}
	patch := Preferences{Theme: "forest"}
	merged := Merge(base, patch)
	if merged.Theme != "forest" {
		t.Fatalf("theme = %q", merged.Theme)
	}
	if merged.SidebarCollapsed == nil || !*merged.SidebarCollapsed {
		t.Fatal("expected sidebar_collapsed preserved")
	}
}

func TestValidate(t *testing.T) {
	if err := Validate(Preferences{DefaultView: "nope"}); err == nil {
		t.Fatal("expected invalid default_view error")
	}
	if err := Validate(Preferences{FontSize: "xl"}); err == nil {
		t.Fatal("expected invalid font_size error")
	}
	if err := Validate(Preferences{DefaultView: "editor", FontSize: "base"}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}
