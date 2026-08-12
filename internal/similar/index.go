package similar

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// maxCandidates caps a single profile's candidate set. Brute force over a
// few thousand rows is microseconds, and the ceiling keeps a mis-scoped
// profile from turning one API call into a full-corpus scan. The distance
// function sits behind an interface-free API on purpose: swapping in a
// vp-tree later changes nothing a caller can see.
const maxCandidates = 5000

// defaultK is the neighbour count when a caller does not specify one.
const defaultK = 5

// Profile is a named similarity space: which pages are candidates, which of
// their fields form the vector, and how each field is compared.
type Profile struct {
	Name string
	// Match restricts candidates to pages whose frontmatter field equals
	// the given value, e.g. {"kind": "dataset"}.
	Match map[string]string
	// PathPrefix further restricts candidates to a subtree.
	PathPrefix string
	Fields     []Field
}

// FieldNames lists the profile's field names in declaration order.
func (p Profile) FieldNames() []string {
	out := make([]string, len(p.Fields))
	for i, f := range p.Fields {
		out[i] = f.Name
	}
	return out
}

// Neighbor is one ranked result.
type Neighbor struct {
	Path string `json:"path"`
	// Score is 1 - RankDistance, so bigger is more similar. It is the
	// headline number and the one the ordering follows.
	Score float64 `json:"score"`
	// Distance is textbook Gower over the fields both sides actually had.
	// It is renormalised over those fields, which means a page with one
	// filled field that happens to match scores 0 — perfect similarity on
	// no evidence. Reported for comparability with reference
	// implementations, but not used for ranking.
	Distance float64 `json:"distance"`
	// RankDistance charges unknown fields the maximum distance instead of
	// renormalising them away, so "we have nothing to compare" sorts below
	// "we compared everything and it differs". Equal to Distance when
	// coverage is 1.
	RankDistance float64 `json:"rank_distance"`
	// Coverage is the weighted fraction of the profile's fields that were
	// comparable on both sides.
	Coverage float64 `json:"coverage"`
	// ComparableFields is how many of the profile's fields both sides
	// actually had. A close score over 2 of 9 fields is weak evidence, and
	// hiding that from an agent invites overconfident conclusions.
	ComparableFields int            `json:"comparable_fields"`
	TotalFields      int            `json:"total_fields"`
	Contributions    []Contribution `json:"contributions"`
	Vector           map[string]any `json:"vector,omitempty"`
}

// coverageOf returns the weighted share of fields that were comparable.
func coverageOf(contribs []Contribution) float64 {
	var total, present float64
	for _, c := range contribs {
		w := c.Weight
		if w <= 0 {
			w = 1
		}
		total += w
		if !c.Skipped {
			present += w
		}
	}
	if total == 0 {
		return 0
	}
	return present / total
}

// Result is a full answer: the resolved query vector plus ranked neighbours.
type Result struct {
	Profile        string         `json:"profile"`
	QueryPath      string         `json:"query_path,omitempty"`
	QueryVector    map[string]any `json:"query_vector"`
	Fields         []string       `json:"fields"`
	CandidateCount int            `json:"candidate_count"`
	Neighbors      []Neighbor     `json:"neighbors"`
	// Truncated reports that the candidate set hit maxCandidates, so the
	// ranking is over a prefix of the corpus rather than all of it.
	Truncated bool `json:"truncated,omitempty"`
}

// Query asks for the nearest neighbours of either an indexed page or an
// inline field vector. The inline form is what lets an agent ask about a
// case that is not in the corpus yet — a dataset it is looking at right
// now — which is the whole point of the Retrieve step.
type Query struct {
	Path    string
	Vector  map[string]any
	Profile string
	K       int
}

// Index answers nearest-neighbour queries over frontmatter.
type Index struct {
	db       *sql.DB
	profiles map[string]Profile
	names    []string
}

// New builds an Index over the read pool. Profile names must be unique and
// every profile must declare at least one field — a similarity space with no
// dimensions ranks nothing and is always a config mistake.
func New(db *sql.DB, profiles []Profile) (*Index, error) {
	idx := &Index{db: db, profiles: make(map[string]Profile, len(profiles))}
	for _, p := range profiles {
		name := strings.TrimSpace(p.Name)
		if name == "" {
			return nil, fmt.Errorf("similarity profile: name is required")
		}
		if _, dup := idx.profiles[name]; dup {
			return nil, fmt.Errorf("similarity profile %q: declared twice", name)
		}
		if len(p.Fields) == 0 {
			return nil, fmt.Errorf("similarity profile %q: at least one numeric or categorical field is required", name)
		}
		for _, f := range p.Fields {
			if strings.TrimSpace(f.Name) == "" {
				return nil, fmt.Errorf("similarity profile %q: field name is required", name)
			}
		}
		p.Name = name
		idx.profiles[name] = p
		idx.names = append(idx.names, name)
	}
	sort.Strings(idx.names)
	return idx, nil
}

// Profiles lists the configured profile names.
func (idx *Index) Profiles() []string {
	return append([]string(nil), idx.names...)
}

// Profile returns a configured profile by name.
func (idx *Index) Profile(name string) (Profile, bool) {
	p, ok := idx.profiles[name]
	return p, ok
}

// Similar ranks the profile's candidates against the query.
func (idx *Index) Similar(ctx context.Context, q Query) (*Result, error) {
	name := strings.TrimSpace(q.Profile)
	if name == "" {
		if len(idx.names) != 1 {
			return nil, fmt.Errorf("profile is required (configured: %s)", strings.Join(idx.names, ", "))
		}
		name = idx.names[0]
	}
	profile, ok := idx.profiles[name]
	if !ok {
		return nil, fmt.Errorf("unknown similarity profile %q (configured: %s)", name, strings.Join(idx.names, ", "))
	}
	if q.Path == "" && len(q.Vector) == 0 {
		return nil, fmt.Errorf("either a path or an inline field vector is required")
	}
	k := q.K
	if k <= 0 {
		k = defaultK
	}

	candidates, truncated, err := idx.loadCandidates(ctx, profile)
	if err != nil {
		return nil, err
	}

	queryVector := map[string]any{}
	if q.Path != "" {
		fm, ferr := idx.frontmatter(ctx, q.Path)
		if ferr != nil {
			return nil, ferr
		}
		queryVector = ExtractVector(fm, profile.Fields)
	}
	// An inline vector layers over the page's own values, so an agent can
	// ask "this dataset, but if it were unordered".
	for key, v := range q.Vector {
		queryVector[key] = v
	}

	// The query participates in range computation so an out-of-corpus case
	// cannot land outside the scale everything else is measured on.
	vectors := make([]map[string]any, 0, len(candidates)+1)
	for _, c := range candidates {
		vectors = append(vectors, c.vector)
	}
	vectors = append(vectors, queryVector)
	ranges := ComputeRanges(profile.Fields, vectors)

	result := &Result{
		Profile:        profile.Name,
		QueryPath:      q.Path,
		QueryVector:    queryVector,
		Fields:         profile.FieldNames(),
		CandidateCount: len(candidates),
		Truncated:      truncated,
	}

	neighbors := make([]Neighbor, 0, len(candidates))
	for _, c := range candidates {
		if c.path == q.Path {
			continue
		}
		dist, comparable, contribs := Distance(profile.Fields, ranges, queryVector, c.vector)
		coverage := coverageOf(contribs)
		// Unknown fields are charged the maximum distance rather than being
		// renormalised away — otherwise an empty page is everyone's nearest
		// neighbour.
		rankDist := clamp01(dist*coverage + (1 - coverage))
		neighbors = append(neighbors, Neighbor{
			Path:             c.path,
			Score:            1 - rankDist,
			Distance:         dist,
			RankDistance:     rankDist,
			Coverage:         coverage,
			ComparableFields: comparable,
			TotalFields:      len(profile.Fields),
			Contributions:    contribs,
			Vector:           c.vector,
		})
	}

	// Ties break on path so repeated calls return a stable order.
	sort.SliceStable(neighbors, func(i, j int) bool {
		if neighbors[i].RankDistance != neighbors[j].RankDistance {
			return neighbors[i].RankDistance < neighbors[j].RankDistance
		}
		return neighbors[i].Path < neighbors[j].Path
	})
	if len(neighbors) > k {
		neighbors = neighbors[:k]
	}
	result.Neighbors = neighbors
	return result, nil
}

type candidate struct {
	path   string
	vector map[string]any
}

func (idx *Index) loadCandidates(ctx context.Context, p Profile) ([]candidate, bool, error) {
	var (
		conds  []string
		args   []any
		fields = p.Fields
	)
	for key, want := range p.Match {
		jsonPath, err := jsonPathFor(key)
		if err != nil {
			return nil, false, fmt.Errorf("profile %q match: %w", p.Name, err)
		}
		conds = append(conds, "json_extract(frontmatter, ?) = ?")
		args = append(args, jsonPath, want)
	}
	if p.PathPrefix != "" {
		conds = append(conds, "path LIKE ? || '%'")
		args = append(args, p.PathPrefix)
	}

	query := "SELECT path, frontmatter FROM file_meta"
	if len(conds) > 0 {
		// Match keys are sorted so the emitted SQL is deterministic.
		sort.Strings(conds)
		query += " WHERE " + strings.Join(conds, " AND ")
	}
	query += " ORDER BY path ASC LIMIT ?"
	args = append(args, maxCandidates+1)

	rows, err := idx.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, false, fmt.Errorf("load candidates: %w", err)
	}
	defer rows.Close()

	var out []candidate
	for rows.Next() {
		var path, raw string
		if err := rows.Scan(&path, &raw); err != nil {
			return nil, false, err
		}
		fm := map[string]any{}
		if raw != "" {
			_ = json.Unmarshal([]byte(raw), &fm)
		}
		out = append(out, candidate{path: path, vector: ExtractVector(fm, fields)})
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	truncated := len(out) > maxCandidates
	if truncated {
		out = out[:maxCandidates]
	}
	return out, truncated, nil
}

func (idx *Index) frontmatter(ctx context.Context, path string) (map[string]any, error) {
	var raw string
	err := idx.db.QueryRowContext(ctx, `SELECT frontmatter FROM file_meta WHERE path = ?`, path).Scan(&raw)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("page %q is not indexed", path)
	}
	if err != nil {
		return nil, fmt.Errorf("load %q: %w", path, err)
	}
	fm := map[string]any{}
	if raw != "" {
		_ = json.Unmarshal([]byte(raw), &fm)
	}
	return fm, nil
}

// ExtractVector pulls the profile's fields out of a frontmatter map. A field
// name may be a dotted path into nested frontmatter
// (`stats.ordered`); an exact key wins over a path walk, since
// a literal dotted key is legal YAML.
func ExtractVector(fm map[string]any, fields []Field) map[string]any {
	out := make(map[string]any, len(fields))
	for _, f := range fields {
		if v, ok := fm[f.Name]; ok {
			out[f.Name] = v
			continue
		}
		if v, ok := lookupPath(fm, f.Name); ok {
			out[f.Name] = v
		}
	}
	return out
}

func lookupPath(fm map[string]any, path string) (any, bool) {
	parts := strings.Split(path, ".")
	if len(parts) == 1 {
		v, ok := fm[path]
		return v, ok
	}
	var cur any = fm
	for _, part := range parts {
		m, ok := cur.(map[string]any)
		if !ok {
			return nil, false
		}
		cur, ok = m[part]
		if !ok {
			return nil, false
		}
	}
	return cur, true
}

// jsonPathFor turns a frontmatter field name into a json_extract path,
// rejecting anything that could break out of the quoted path literal.
func jsonPathFor(field string) (string, error) {
	f := strings.TrimSpace(field)
	if f == "" {
		return "", fmt.Errorf("empty field name")
	}
	for _, r := range f {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
		case r == '_' || r == '-' || r == '.':
		default:
			return "", fmt.Errorf("invalid field name %q", field)
		}
	}
	return "$." + f, nil
}
