// Package memory provides conventions and helpers for episodic vs semantic
// knowledge, and for consolidation provenance (merged-from).
package memory

import "strings"

// Well-known values for the memory_kind frontmatter key.
const (
	KindEpisodic       = "episodic"
	KindSemantic       = "semantic"
	KindConsolidation  = "consolidation" // intermediate / pending merge
	KindWorkingScratch = "working"      // high-churn scratch, optional
)

// Well-known values for the memory_status frontmatter key.
const (
	StatusActive     = "active"
	StatusContested  = "contested"
	StatusSuperseded = "superseded"
	StatusStale      = "stale"
)

// MemoryStatus returns the memory_status frontmatter value, defaulting to active.
func MemoryStatus(fm map[string]any) string {
	if fm == nil {
		return StatusActive
	}
	s, _ := fm["memory_status"].(string)
	s = strings.TrimSpace(strings.ToLower(s))
	if s == "" {
		return StatusActive
	}
	return s
}

// DefaultEpisodesPathPrefix is used when [memory] episodes_path_prefix is unset
// in config. Files under this path are treated as episodic when frontmatter
// is ambiguous and memory_kind is not explicitly semantic.
const DefaultEpisodesPathPrefix = "episodes/"
