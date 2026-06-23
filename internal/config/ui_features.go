package config

// UIFeaturesConfig toggles header view buttons via [ui.features] in config.toml.
// Unset fields default to true for backward compatibility.
type UIFeaturesConfig struct {
	Graph       *bool `toml:"graph"`
	Kanban      *bool `toml:"kanban"`
	Canvas      *bool `toml:"canvas"`
	Whiteboard  *bool `toml:"whiteboard"`
	Timeline    *bool `toml:"timeline"`
	Calendar    *bool `toml:"calendar"`
	Bases       *bool `toml:"bases"`
	DataSources *bool `toml:"data_sources"`
}

func featureEnabled(v *bool) bool {
	return v == nil || *v
}

// Resolved returns the effective feature flags; unset fields default to true.
func (f UIFeaturesConfig) Resolved() map[string]bool {
	return map[string]bool{
		"graph":        featureEnabled(f.Graph),
		"kanban":       featureEnabled(f.Kanban),
		"canvas":       featureEnabled(f.Canvas),
		"whiteboard":   featureEnabled(f.Whiteboard),
		"timeline":     featureEnabled(f.Timeline),
		"calendar":     featureEnabled(f.Calendar),
		"bases":        featureEnabled(f.Bases),
		"data_sources": featureEnabled(f.DataSources),
	}
}

// IsEnabled reports whether a named UI feature is enabled. Unknown names default to true.
func (f UIFeaturesConfig) IsEnabled(name string) bool {
	v, ok := f.Resolved()[name]
	if !ok {
		return true
	}
	return v
}
