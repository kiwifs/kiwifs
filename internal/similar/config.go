package similar

import "github.com/kiwifs/kiwifs/internal/config"

// ProfilesFromConfig converts [[similarity.profiles]] stanzas into runtime
// profiles. Numeric fields come first only for stable ordering of the
// per-field contribution list; order carries no meaning otherwise.
func ProfilesFromConfig(cfg config.SimilarityConfig) []Profile {
	out := make([]Profile, 0, len(cfg.Profiles))
	for _, pc := range cfg.Profiles {
		p := Profile{
			Name:       pc.Name,
			Match:      pc.Match,
			PathPrefix: pc.PathPrefix,
		}
		for _, name := range pc.Numeric {
			p.Fields = append(p.Fields, Field{Name: name, Kind: Numeric, Weight: pc.Weights[name]})
		}
		for _, name := range pc.Categorical {
			p.Fields = append(p.Fields, Field{Name: name, Kind: Categorical, Weight: pc.Weights[name]})
		}
		out = append(out, p)
	}
	return out
}
