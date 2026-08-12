// Package similar ranks pages by nearest-neighbour distance over structured
// frontmatter fields — the Retrieve step of a case-based-reasoning loop.
//
// Distance is Gower's coefficient, which is the standard answer for mixed
// numeric/categorical data: each field contributes a value in [0,1] and the
// result is their weighted mean. Numeric fields are scaled by the observed
// range across the candidate set, so no field dominates by unit choice, and
// categorical fields contribute 0 on a match and 1 otherwise.
//
// Missing values are skipped and the weights renormalised over the fields
// that were actually comparable, rather than being coerced to a value. A
// null in a numeric field means "we looked and there is no value" — treating
// it as 0 would make an unknown dataset look like a perfect match on
// that axis.
package similar

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
)

// FieldKind distinguishes the two distance rules.
type FieldKind int

const (
	// Numeric fields use scaled absolute difference.
	Numeric FieldKind = iota
	// Categorical fields use Hamming distance (0 on equality, else 1).
	Categorical
)

// Field describes one dimension of the distance function.
type Field struct {
	Name   string
	Kind   FieldKind
	Weight float64 // <= 0 is treated as 1
}

// Range is the observed span of a numeric field across the candidate set,
// used to scale that field's contribution into [0,1].
type Range struct {
	Min, Max float64
	// Valid is false when no candidate had a usable numeric value, or when
	// every candidate had the same one (zero range — nothing to scale by).
	Valid bool
}

// Contribution records one field's share of a pair's distance. Returning
// these is the point: an opaque score tells an agent nothing about *why*
// two cases are alike.
type Contribution struct {
	Field    string  `json:"field"`
	Kind     string  `json:"kind"`
	Distance float64 `json:"distance"` // this field's raw distance in [0,1]
	Weight   float64 `json:"weight"`
	// Skipped is true when either side was missing, so the field was
	// dropped from the weighted mean instead of contributing a value.
	Skipped bool `json:"skipped"`
	A       any  `json:"a,omitempty"`
	B       any  `json:"b,omitempty"`
}

// Weight returns the effective weight of a field: unset or non-positive
// weights count as 1 so a profile that lists fields without weighting them
// gets a plain unweighted mean.
func (f Field) EffectiveWeight() float64 {
	if f.Weight <= 0 {
		return 1
	}
	return f.Weight
}

// ComputeRanges finds the min/max of every numeric field across candidates.
// Values that are missing or non-numeric are ignored; a field where fewer
// than two distinct values exist yields Valid=false, and Gower then treats
// it as contributing 0 when the values are equal and 1 when they differ,
// rather than dividing by zero.
func ComputeRanges(fields []Field, candidates []map[string]any) map[string]Range {
	ranges := make(map[string]Range, len(fields))
	for _, f := range fields {
		if f.Kind != Numeric {
			continue
		}
		r := Range{Min: math.Inf(1), Max: math.Inf(-1)}
		for _, c := range candidates {
			v, ok := toFloat(c[f.Name])
			if !ok {
				continue
			}
			if v < r.Min {
				r.Min = v
			}
			if v > r.Max {
				r.Max = v
			}
		}
		if !math.IsInf(r.Min, 1) && r.Max > r.Min {
			r.Valid = true
		}
		ranges[f.Name] = r
	}
	return ranges
}

// Distance returns Gower's distance between a and b in [0,1], along with the
// per-field breakdown. When no field is comparable — every one missing on at
// least one side — the distance is 1 (maximally dissimilar) and comparable
// is 0, so callers can tell "far away" from "nothing to compare".
func Distance(fields []Field, ranges map[string]Range, a, b map[string]any) (dist float64, comparable int, contribs []Contribution) {
	var sum, weightSum float64
	contribs = make([]Contribution, 0, len(fields))

	for _, f := range fields {
		av, aok := a[f.Name]
		bv, bok := b[f.Name]
		w := f.EffectiveWeight()
		c := Contribution{Field: f.Name, Kind: f.Kind.String(), Weight: w, A: av, B: bv}

		if !aok || !bok || isMissing(av) || isMissing(bv) {
			c.Skipped = true
			contribs = append(contribs, c)
			continue
		}

		var d float64
		switch f.Kind {
		case Numeric:
			an, aNum := toFloat(av)
			bn, bNum := toFloat(bv)
			if !aNum || !bNum {
				// A TEXT sentinel where a number belongs: not comparable.
				// Coercing it would silently order it above every number.
				c.Skipped = true
				contribs = append(contribs, c)
				continue
			}
			r := ranges[f.Name]
			switch {
			case r.Valid:
				d = math.Abs(an-bn) / (r.Max - r.Min)
			case an == bn:
				d = 0
			default:
				d = 1
			}
		default:
			if categoricalEqual(av, bv) {
				d = 0
			} else {
				d = 1
			}
		}

		d = clamp01(d)
		c.Distance = d
		contribs = append(contribs, c)
		sum += w * d
		weightSum += w
		comparable++
	}

	if weightSum == 0 {
		return 1, 0, contribs
	}
	return clamp01(sum / weightSum), comparable, contribs
}

func (k FieldKind) String() string {
	if k == Categorical {
		return "categorical"
	}
	return "numeric"
}

// ParseFieldKind maps a config string to a FieldKind.
func ParseFieldKind(s string) (FieldKind, error) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "numeric", "number", "num":
		return Numeric, nil
	case "categorical", "category", "cat", "nominal":
		return Categorical, nil
	default:
		return Numeric, fmt.Errorf("unknown field kind %q", s)
	}
}

// isMissing reports whether a value carries no information. A nil is the
// canonical missing marker; an empty string is treated the same way because
// YAML frontmatter routinely round-trips absent values that way.
func isMissing(v any) bool {
	switch t := v.(type) {
	case nil:
		return true
	case string:
		return strings.TrimSpace(t) == ""
	}
	return false
}

func toFloat(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		if math.IsNaN(n) || math.IsInf(n, 0) {
			return 0, false
		}
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int32:
		return float64(n), true
	case int64:
		return float64(n), true
	case uint64:
		return float64(n), true
	case bool:
		// Booleans are ordinal enough to be useful as 0/1 — a stats field
		// like `ordered` is naturally binary.
		if n {
			return 1, true
		}
		return 0, true
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(n), 64)
		if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
			return 0, false
		}
		return f, true
	}
	return 0, false
}

// categoricalEqual compares two categorical values. Scalars compare by their
// canonical string form; lists compare as sets, so ["a","b"] matches
// ["b","a"] — frontmatter list order is not meaningful.
func categoricalEqual(a, b any) bool {
	as, aIsList := toStringSet(a)
	bs, bIsList := toStringSet(b)
	if aIsList != bIsList {
		return false
	}
	if !aIsList {
		return canonicalString(a) == canonicalString(b)
	}
	if len(as) != len(bs) {
		return false
	}
	for i := range as {
		if as[i] != bs[i] {
			return false
		}
	}
	return true
}

func toStringSet(v any) ([]string, bool) {
	items, ok := v.([]any)
	if !ok {
		if ss, isStrs := v.([]string); isStrs {
			out := append([]string(nil), ss...)
			sort.Strings(out)
			return out, true
		}
		return nil, false
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		out = append(out, canonicalString(item))
	}
	sort.Strings(out)
	return out, true
}

func canonicalString(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return strings.ToLower(strings.TrimSpace(t))
	case bool:
		return strconv.FormatBool(t)
	case float64:
		return strconv.FormatFloat(t, 'g', -1, 64)
	case int:
		return strconv.Itoa(t)
	case int64:
		return strconv.FormatInt(t, 10)
	}
	return strings.ToLower(strings.TrimSpace(fmt.Sprint(v)))
}

func clamp01(f float64) float64 {
	if f < 0 {
		return 0
	}
	if f > 1 {
		return 1
	}
	return f
}
