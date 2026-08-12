package similar

import (
	"math"
	"testing"
)

// referenceFields / referenceRows are the worked example from the Python
// `gower` package's README (gower 0.1.2). The expected matrices below were
// produced by `gower.gower_matrix(X)` on that exact frame, so this file is a
// port of a published reference rather than a restatement of our own
// arithmetic. R's cluster::daisy(metric="gower") agrees on this data: both
// scale numerics by the range observed across the candidate set and use
// Hamming on categoricals.
//
// The reference computes in float32, hence the 1e-6 tolerance.
var referenceFields = []Field{
	{Name: "age", Kind: Numeric},
	{Name: "gender", Kind: Categorical},
	{Name: "civil_status", Kind: Categorical},
	{Name: "salary", Kind: Numeric},
	{Name: "has_children", Kind: Numeric},
	{Name: "available_credit", Kind: Numeric},
}

var referenceRows = []map[string]any{
	{"age": 21, "gender": "M", "civil_status": "MARRIED", "salary": 3000.0, "has_children": 1, "available_credit": 2200},
	{"age": 21, "gender": "M", "civil_status": "SINGLE", "salary": 1200.0, "has_children": 0, "available_credit": 100},
	{"age": 19, "gender": "N", "civil_status": "SINGLE", "salary": 32000.0, "has_children": 1, "available_credit": 22000},
	{"age": 30, "gender": "M", "civil_status": "SINGLE", "salary": 1800.0, "has_children": 1, "available_credit": 1100},
	{"age": 21, "gender": "F", "civil_status": "MARRIED", "salary": 2900.0, "has_children": 1, "available_credit": 2000},
	{"age": 21, "gender": "F", "civil_status": "SINGLE", "salary": 1100.0, "has_children": 0, "available_credit": 100},
	{"age": 19, "gender": "F", "civil_status": "WIDOW", "salary": 10000.0, "has_children": 0, "available_credit": 6000},
	{"age": 30, "gender": "F", "civil_status": "DIVORCED", "salary": 1500.0, "has_children": 1, "available_credit": 2200},
}

const tol = 1e-6

func assertClose(t *testing.T, got, want float64, label string) {
	t.Helper()
	if math.Abs(got-want) > tol {
		t.Errorf("%s = %.8f, want %.8f (delta %.2e)", label, got, want, math.Abs(got-want))
	}
}

func TestGowerMatchesPythonReference(t *testing.T) {
	ranges := ComputeRanges(referenceFields, referenceRows)

	// gower.gower_matrix(X)[0]
	wantRow0 := []float64{0, 0.3590238, 0.6707398, 0.31787416, 0.16872811, 0.52622986, 0.59697855, 0.47778758}
	// gower.gower_matrix(X)[3]
	wantRow3 := []float64{0.31787416, 0.3138769, 0.6552807, 0, 0.4824794, 0.48108295, 0.74818605, 0.34332284}

	for j, want := range wantRow0 {
		got, comparable, _ := Distance(referenceFields, ranges, referenceRows[0], referenceRows[j])
		assertClose(t, got, want, "d(0,"+itoa(j)+")")
		if comparable != len(referenceFields) {
			t.Errorf("d(0,%d) compared %d fields, want %d", j, comparable, len(referenceFields))
		}
	}
	for j, want := range wantRow3 {
		got, _, _ := Distance(referenceFields, ranges, referenceRows[3], referenceRows[j])
		assertClose(t, got, want, "d(3,"+itoa(j)+")")
	}
}

func TestGowerMatchesPythonReferenceWeighted(t *testing.T) {
	// gower.gower_matrix(X, weight=[1,1,1,1,1,3])[0]
	weighted := make([]Field, len(referenceFields))
	copy(weighted, referenceFields)
	weighted[5].Weight = 3

	ranges := ComputeRanges(weighted, referenceRows)
	want := []float64{0, 0.29324046, 0.7290823, 0.2509627, 0.12882918, 0.418645, 0.49111292, 0.35834068}
	for j, w := range want {
		got, _, _ := Distance(weighted, ranges, referenceRows[0], referenceRows[j])
		assertClose(t, got, w, "weighted d(0,"+itoa(j)+")")
	}
}

func TestGowerIdenticalRowsAreZero(t *testing.T) {
	ranges := ComputeRanges(referenceFields, referenceRows)
	for i, row := range referenceRows {
		got, _, _ := Distance(referenceFields, ranges, row, row)
		if got != 0 {
			t.Errorf("d(%d,%d) = %v, want 0", i, i, got)
		}
	}
}

func TestGowerSymmetric(t *testing.T) {
	ranges := ComputeRanges(referenceFields, referenceRows)
	for i := range referenceRows {
		for j := range referenceRows {
			ab, _, _ := Distance(referenceFields, ranges, referenceRows[i], referenceRows[j])
			ba, _, _ := Distance(referenceFields, ranges, referenceRows[j], referenceRows[i])
			assertClose(t, ab, ba, "symmetry")
		}
	}
}

func TestGowerAllCategorical(t *testing.T) {
	fields := []Field{{Name: "a", Kind: Categorical}, {Name: "b", Kind: Categorical}, {Name: "c", Kind: Categorical}}
	rows := []map[string]any{
		{"a": "x", "b": "y", "c": "z"},
		{"a": "x", "b": "y", "c": "different"},
		{"a": "1", "b": "2", "c": "3"},
	}
	ranges := ComputeRanges(fields, rows)

	got, _, _ := Distance(fields, ranges, rows[0], rows[1])
	assertClose(t, got, 1.0/3.0, "one of three categoricals differs")

	got, _, _ = Distance(fields, ranges, rows[0], rows[2])
	assertClose(t, got, 1, "all categoricals differ")
}

func TestGowerAllNumeric(t *testing.T) {
	fields := []Field{{Name: "x", Kind: Numeric}, {Name: "y", Kind: Numeric}}
	rows := []map[string]any{
		{"x": 0.0, "y": 100.0},
		{"x": 10.0, "y": 200.0},
		{"x": 5.0, "y": 150.0},
	}
	ranges := ComputeRanges(fields, rows)

	// Ranges are 10 and 100; the midpoint row sits half a range away on both.
	got, _, _ := Distance(fields, ranges, rows[0], rows[2])
	assertClose(t, got, 0.5, "midpoint")

	got, _, _ = Distance(fields, ranges, rows[0], rows[1])
	assertClose(t, got, 1, "the two extremes")
}

func TestGowerZeroRangeNumericDoesNotDivideByZero(t *testing.T) {
	fields := []Field{{Name: "constant", Kind: Numeric}, {Name: "varies", Kind: Numeric}}
	rows := []map[string]any{
		{"constant": 7.0, "varies": 0.0},
		{"constant": 7.0, "varies": 10.0},
	}
	ranges := ComputeRanges(fields, rows)
	if ranges["constant"].Valid {
		t.Error("a single-valued numeric column should not report a usable range")
	}

	got, comparable, contribs := Distance(fields, ranges, rows[0], rows[1])
	if math.IsNaN(got) || math.IsInf(got, 0) {
		t.Fatalf("distance = %v, want a finite number", got)
	}
	// A constant column contributes 0 (equal values), so only `varies` moves
	// the score: (0 + 1) / 2.
	assertClose(t, got, 0.5, "zero-range column")
	if comparable != 2 {
		t.Errorf("comparable = %d, want 2", comparable)
	}
	if contribs[0].Distance != 0 {
		t.Errorf("constant column contributed %v, want 0", contribs[0].Distance)
	}

	// Equal-valued rows in a zero-range column differing elsewhere must not
	// suddenly count as maximally distant on the constant axis.
	unequal := map[string]any{"constant": 9.0, "varies": 10.0}
	_, _, contribs = Distance(fields, ranges, rows[0], unequal)
	if contribs[0].Distance != 1 {
		t.Errorf("unequal values in an unscalable column contributed %v, want 1", contribs[0].Distance)
	}
}

func TestGowerMissingValuesAreSkippedNotCoerced(t *testing.T) {
	fields := []Field{{Name: "a", Kind: Numeric}, {Name: "b", Kind: Numeric}, {Name: "c", Kind: Categorical}}
	rows := []map[string]any{
		{"a": 0.0, "b": 0.0, "c": "x"},
		{"a": 10.0, "b": 10.0, "c": "x"},
	}
	ranges := ComputeRanges(fields, rows)

	// `b` is null on one side: it drops out and the mean renormalises over
	// the two comparable fields. Coercing null to zero would instead make
	// this pair look *more* distant on b than it has evidence for.
	partial := map[string]any{"a": 10.0, "b": nil, "c": "x"}
	got, comparable, contribs := Distance(fields, ranges, rows[0], partial)
	assertClose(t, got, 0.5, "one field missing")
	if comparable != 2 {
		t.Errorf("comparable = %d, want 2", comparable)
	}
	if !contribs[1].Skipped {
		t.Error("the missing field should be marked skipped")
	}

	// An absent key behaves the same as an explicit null.
	got, _, _ = Distance(fields, ranges, rows[0], map[string]any{"a": 10.0, "c": "x"})
	assertClose(t, got, 0.5, "absent key")

	// A TEXT sentinel where a number belongs must not be coerced either —
	// the Phase 0 finding that 'unknown' > 0.1 is true in SQLite.
	got, comparable, _ = Distance(fields, ranges, rows[0], map[string]any{"a": 10.0, "b": "unknown", "c": "x"})
	assertClose(t, got, 0.5, "text sentinel in a numeric field")
	if comparable != 2 {
		t.Errorf("comparable = %d, want 2 (the sentinel is not a value)", comparable)
	}
}

func TestGowerNothingComparable(t *testing.T) {
	fields := []Field{{Name: "a", Kind: Numeric}}
	got, comparable, _ := Distance(fields, nil, map[string]any{"a": nil}, map[string]any{"a": 1.0})
	if got != 1 {
		t.Errorf("distance = %v, want 1 when no field is comparable", got)
	}
	if comparable != 0 {
		t.Errorf("comparable = %d, want 0", comparable)
	}
}

func TestGowerWeightsReorderNeighbours(t *testing.T) {
	// Raising one field's weight has to be able to change the ranking, not
	// just the absolute scores.
	fields := []Field{
		{Name: "ordered", Kind: Categorical},
		{Name: "rows", Kind: Numeric},
		{Name: "columns", Kind: Numeric},
	}
	query := map[string]any{"ordered": false, "rows": 0.0, "columns": 0.0}
	// bySize matches on both numerics but differs structurally.
	bySize := map[string]any{"ordered": true, "rows": 0.0, "columns": 0.0}
	// byStructure matches `ordered` and nothing else.
	byStructure := map[string]any{"ordered": false, "rows": 900.0, "columns": 900.0}
	ranges := ComputeRanges(fields, []map[string]any{query, bySize, byStructure})

	// Unweighted: two matching numerics outvote the one categorical.
	// (1 + 0 + 0)/3 = 0.333 vs (0 + 1 + 1)/3 = 0.667.
	dSize, _, _ := Distance(fields, ranges, query, bySize)
	dStructure, _, _ := Distance(fields, ranges, query, byStructure)
	assertClose(t, dSize, 1.0/3.0, "unweighted d(bySize)")
	assertClose(t, dStructure, 2.0/3.0, "unweighted d(byStructure)")
	if !(dSize < dStructure) {
		t.Fatalf("unweighted: d(bySize)=%v d(byStructure)=%v, want bySize closer", dSize, dStructure)
	}

	// Weight `ordered` at 3 and the ranking flips:
	// (3*1 + 0 + 0)/5 = 0.6 vs (0 + 1 + 1)/5 = 0.4.
	fields[0].Weight = 3
	dSize, _, _ = Distance(fields, ranges, query, bySize)
	dStructure, _, _ = Distance(fields, ranges, query, byStructure)
	assertClose(t, dSize, 0.6, "weighted d(bySize)")
	assertClose(t, dStructure, 0.4, "weighted d(byStructure)")
	if !(dStructure < dSize) {
		t.Fatalf("weighted: d(bySize)=%v d(byStructure)=%v, want the structural match to win", dSize, dStructure)
	}
}

func TestGowerCategoricalListsCompareAsSets(t *testing.T) {
	fields := []Field{{Name: "tags", Kind: Categorical}}
	a := map[string]any{"tags": []any{"mit", "csv"}}
	b := map[string]any{"tags": []any{"csv", "mit"}}
	c := map[string]any{"tags": []any{"cc-by"}}

	if d, _, _ := Distance(fields, nil, a, b); d != 0 {
		t.Errorf("reordered list distance = %v, want 0", d)
	}
	if d, _, _ := Distance(fields, nil, a, c); d != 1 {
		t.Errorf("disjoint list distance = %v, want 1", d)
	}
}

func TestParseFieldKind(t *testing.T) {
	for _, s := range []string{"numeric", "Number", " num "} {
		if k, err := ParseFieldKind(s); err != nil || k != Numeric {
			t.Errorf("ParseFieldKind(%q) = %v, %v", s, k, err)
		}
	}
	for _, s := range []string{"categorical", "CAT", "nominal"} {
		if k, err := ParseFieldKind(s); err != nil || k != Categorical {
			t.Errorf("ParseFieldKind(%q) = %v, %v", s, k, err)
		}
	}
	if _, err := ParseFieldKind("ordinal"); err == nil {
		t.Error("ParseFieldKind(\"ordinal\") should fail")
	}
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var b []byte
	for i > 0 {
		b = append([]byte{byte('0' + i%10)}, b...)
		i /= 10
	}
	return string(b)
}
