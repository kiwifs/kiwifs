package config

import "testing"

func TestUIFeaturesConfigDefaults(t *testing.T) {
	f := UIFeaturesConfig{}.Resolved()
	for _, key := range []string{"graph", "kanban", "canvas", "whiteboard", "timeline", "bases", "data_sources", "edit", "history", "publish"} {
		if !f[key] {
			t.Fatalf("expected %s enabled by default", key)
		}
	}
}

func TestUIFeaturesConfigExplicitFalse(t *testing.T) {
	falseVal := false
	f := UIFeaturesConfig{
		Kanban:  &falseVal,
		Graph:   &falseVal,
		Edit:    &falseVal,
		History: &falseVal,
		Publish: &falseVal,
	}.Resolved()
	if f["kanban"] || f["graph"] || f["edit"] || f["history"] || f["publish"] {
		t.Fatal("expected explicitly disabled features to be off")
	}
	if !f["canvas"] || !f["bases"] {
		t.Fatal("expected unset features to remain enabled")
	}
}

func TestUIFeaturesConfigIsEnabledUnknown(t *testing.T) {
	if !(UIFeaturesConfig{}).IsEnabled("unknown_feature") {
		t.Fatal("unknown feature names should default to enabled")
	}
}
