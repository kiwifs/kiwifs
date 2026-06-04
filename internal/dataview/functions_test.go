package dataview

import (
	"strings"
	"testing"
)

func TestDaysAgoCompiler(t *testing.T) {
	fn, ok := funcRegistry["days_ago"]
	if !ok {
		t.Fatal("days_ago not registered")
	}
	sql, _, err := fn([]compiledArg{{SQL: "7", Params: nil}})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sql, "datetime('now'") || !strings.Contains(sql, "days") {
		t.Fatalf("unexpected SQL: %s", sql)
	}
}

func TestParseDaysAgoExpr(t *testing.T) {
	expr, err := ParseExpr("days_ago(7)")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := expr.(*FuncCall); !ok {
		t.Fatalf("expected *FuncCall, got %T", expr)
	}
}
