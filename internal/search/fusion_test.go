package search

import (
	"math"
	"reflect"
	"testing"
)

func rrfPaths(scored []ScoredPath) []string {
	out := make([]string, len(scored))
	for i, s := range scored {
		out[i] = s.Path
	}
	return out
}

func TestRRFScores(t *testing.T) {
	// Every expectation below comes from the published formula
	//     score(d) = Σ 1/(k + rank(d))   with k = 60
	// (Cormack, Clarke & Buettcher, SIGIR 2009), evaluated by hand.
	cases := []struct {
		name  string
		lists [][]string
		k     float64
		want  []string
		score map[string]float64
	}{
		{
			name:  "identical lists preserve order",
			lists: [][]string{{"a", "b", "c"}, {"a", "b", "c"}},
			want:  []string{"a", "b", "c"},
			score: map[string]float64{
				"a": 2.0 / 61,
				"b": 2.0 / 62,
				"c": 2.0 / 63,
			},
		},
		{
			name: "disjoint lists interleave by rank",
			// Nothing overlaps, so every document scores as a single-list
			// entry and rank alone decides: 1/61 > 1/62 > 1/63.
			lists: [][]string{{"a", "b"}, {"x", "y"}},
			want:  []string{"a", "x", "b", "y"},
			score: map[string]float64{
				"a": 1.0 / 61,
				"x": 1.0 / 61,
				"b": 1.0 / 62,
				"y": 1.0 / 62,
			},
		},
		{
			name:  "one empty list is a no-op",
			lists: [][]string{{"a", "b"}, {}},
			want:  []string{"a", "b"},
			score: map[string]float64{"a": 1.0 / 61, "b": 1.0 / 62},
		},
		{
			name: "agreement beats a single first place",
			// b is 2nd and 1st: 1/62 + 1/61 = 0.0325224749
			// a is 1st and 3rd: 1/61 + 1/63 = 0.0322664585
			// c is 3rd and 2nd: 1/63 + 1/62 = 0.0320020481
			// b never took a first place in the lexical list yet wins overall,
			// because both lists rate it highly — the whole reason to fuse
			// rather than concatenate.
			lists: [][]string{{"a", "b", "c"}, {"b", "c", "a"}},
			want:  []string{"b", "a", "c"},
			score: map[string]float64{
				"b": 1.0/62 + 1.0/61,
				"c": 1.0/63 + 1.0/62,
				"a": 1.0/61 + 1.0/63,
			},
		},
		{
			name:  "small k lets the top rank dominate",
			lists: [][]string{{"a", "b", "c"}, {"c", "b", "a"}},
			k:     1,
			// a: 1/2 + 1/4 = 0.75, c: 1/4 + 1/2 = 0.75, b: 1/3 + 1/3 = 0.667.
			// a and c tie; the path breaks it deterministically.
			want: []string{"a", "c", "b"},
			score: map[string]float64{
				"a": 1.0/2 + 1.0/4,
				"c": 1.0/4 + 1.0/2,
				"b": 1.0/3 + 1.0/3,
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := RRF(tc.lists, tc.k)
			if !reflect.DeepEqual(rrfPaths(got), tc.want) {
				t.Fatalf("order = %v, want %v", rrfPaths(got), tc.want)
			}
			for _, s := range got {
				want, ok := tc.score[s.Path]
				if !ok {
					continue
				}
				if math.Abs(s.Score-want) > 1e-12 {
					t.Errorf("score(%s) = %v, want %v", s.Path, s.Score, want)
				}
			}
		})
	}
}

func TestRRFDefaultsK(t *testing.T) {
	for _, k := range []float64{0, -5} {
		got := RRF([][]string{{"a"}}, k)
		if math.Abs(got[0].Score-1/float64(DefaultRRFK+1)) > 1e-12 {
			t.Fatalf("k=%v: score = %v, want the k=%d value", k, got[0].Score, DefaultRRFK)
		}
	}
}

func TestRRFRecordsPerListRanks(t *testing.T) {
	got := RRF([][]string{{"a", "b"}, {"b"}}, 0)
	byPath := map[string][]int{}
	for _, s := range got {
		byPath[s.Path] = s.Ranks
	}
	if !reflect.DeepEqual(byPath["b"], []int{2, 1}) {
		t.Errorf("b ranks = %v, want [2 1]", byPath["b"])
	}
	// Zero means "this list did not return it", which is what makes a result
	// explainable as lexical-only or semantic-only.
	if !reflect.DeepEqual(byPath["a"], []int{1, 0}) {
		t.Errorf("a ranks = %v, want [1 0]", byPath["a"])
	}
}

func TestRRFEmptyInput(t *testing.T) {
	if got := RRF(nil, 0); len(got) != 0 {
		t.Fatalf("got %v, want empty", got)
	}
	if got := RRF([][]string{{}, {}}, 0); len(got) != 0 {
		t.Fatalf("got %v, want empty", got)
	}
}

// A duplicate inside one list is evidence once, not twice.
func TestRRFDuplicateWithinListCountsBestRankOnce(t *testing.T) {
	got := RRF([][]string{{"a", "a", "b"}}, 0)
	if len(got) != 2 {
		t.Fatalf("got %v, want 2 distinct paths", rrfPaths(got))
	}
	if math.Abs(got[0].Score-1.0/61) > 1e-12 {
		t.Errorf("score(a) = %v, want %v", got[0].Score, 1.0/61)
	}
	// b keeps its actual rank of 3; collapsing the duplicate does not
	// renumber the list.
	if got[1].Ranks[0] != 3 {
		t.Errorf("b rank = %d, want 3", got[1].Ranks[0])
	}
}

func TestRRFIsDeterministic(t *testing.T) {
	lists := [][]string{{"a", "b", "c", "d"}, {"d", "c", "b", "a"}}
	first := rrfPaths(RRF(lists, 0))
	for i := 0; i < 20; i++ {
		if got := rrfPaths(RRF(lists, 0)); !reflect.DeepEqual(got, first) {
			t.Fatalf("run %d = %v, first = %v", i, got, first)
		}
	}
}
