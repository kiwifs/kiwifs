package dataview

import (
	"strings"
	"testing"
)

func TestParseQuery_Table(t *testing.T) {
	plan, err := ParseQuery(`TABLE name, status, mastery.derivatives FROM "students/" WHERE status = "active" SORT last_active DESC LIMIT 20`)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Type != "table" {
		t.Errorf("type = %q, want table", plan.Type)
	}
	if len(plan.Fields) != 3 {
		t.Errorf("fields = %d, want 3", len(plan.Fields))
	}
	if plan.Fields[0].Expr != "name" {
		t.Errorf("field[0] = %q, want name", plan.Fields[0].Expr)
	}
	if plan.Fields[2].Expr != "mastery.derivatives" {
		t.Errorf("field[2] = %q, want mastery.derivatives", plan.Fields[2].Expr)
	}
	if plan.From != "students/" {
		t.Errorf("from = %q, want students/", plan.From)
	}
	if plan.Where == nil {
		t.Error("where is nil")
	}
	if plan.Sort != "last_active" {
		t.Errorf("sort = %q, want last_active", plan.Sort)
	}
	if plan.Order != "desc" {
		t.Errorf("order = %q, want desc", plan.Order)
	}
	if plan.Limit != 20 {
		t.Errorf("limit = %d, want 20", plan.Limit)
	}
}

func TestParseQuery_List(t *testing.T) {
	plan, err := ParseQuery(`LIST WHERE status = "active"`)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Type != "list" {
		t.Errorf("type = %q, want list", plan.Type)
	}
	if plan.Where == nil {
		t.Error("where is nil")
	}
}

func TestParseQuery_Count(t *testing.T) {
	plan, err := ParseQuery(`COUNT FROM "concepts/" WHERE status = "active"`)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Type != "count" {
		t.Errorf("type = %q, want count", plan.Type)
	}
	if plan.From != "concepts/" {
		t.Errorf("from = %q, want concepts/", plan.From)
	}
}

func TestParseQuery_Distinct(t *testing.T) {
	plan, err := ParseQuery(`DISTINCT status`)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Type != "distinct" {
		t.Errorf("type = %q, want distinct", plan.Type)
	}
	if len(plan.Fields) != 1 || plan.Fields[0].Expr != "status" {
		t.Errorf("fields = %v, want [status]", plan.Fields)
	}
}

func TestParseQuery_GroupBy(t *testing.T) {
	plan, err := ParseQuery(`TABLE name FROM "students/" GROUP BY status`)
	if err != nil {
		t.Fatal(err)
	}
	if plan.GroupBy != "status" {
		t.Errorf("group by = %q, want status", plan.GroupBy)
	}
}

func TestParseQuery_Flatten(t *testing.T) {
	plan, err := ParseQuery(`TABLE name FLATTEN tags`)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Flatten != "tags" {
		t.Errorf("flatten = %q, want tags", plan.Flatten)
	}
}

func TestParseQuery_DefaultLimit(t *testing.T) {
	plan, err := ParseQuery(`LIST`)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Limit != defaultLimit {
		t.Errorf("limit = %d, want %d", plan.Limit, defaultLimit)
	}
}

func TestParseQuery_MaxLimit(t *testing.T) {
	plan, err := ParseQuery(`LIST LIMIT 999`)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Limit != maxLimit {
		t.Errorf("limit = %d, want %d (max)", plan.Limit, maxLimit)
	}
}

func TestParseQuery_Offset(t *testing.T) {
	plan, err := ParseQuery(`LIST LIMIT 20 OFFSET 40`)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Offset != 40 {
		t.Errorf("offset = %d, want 40", plan.Offset)
	}
}

func TestParseQuery_FromUnquoted(t *testing.T) {
	plan, err := ParseQuery(`LIST FROM concepts/`)
	if err != nil {
		t.Fatal(err)
	}
	if plan.From != "concepts/" {
		t.Errorf("from = %q, want concepts/", plan.From)
	}
}

func TestParseQuery_WhereComplex(t *testing.T) {
	plan, err := ParseQuery(`TABLE name WHERE status = "active" AND (priority > 3 OR mastery.score < 0.5) SORT name ASC`)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Where == nil {
		t.Error("where is nil")
	}
	if plan.Sort != "name" {
		t.Errorf("sort = %q, want name", plan.Sort)
	}
}

func TestParseQuery_LegacyFormat(t *testing.T) {
	plan, err := ParseQuery(`type: table
columns: name, status
where: status = "active"
sort: name asc
from: "students/"
limit: 10`)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Type != "table" {
		t.Errorf("type = %q, want table", plan.Type)
	}
	if len(plan.Fields) != 2 {
		t.Errorf("fields = %d, want 2", len(plan.Fields))
	}
	if plan.From != "students/" {
		t.Errorf("from = %q, want students/", plan.From)
	}
	if plan.Limit != 10 {
		t.Errorf("limit = %d, want 10", plan.Limit)
	}
}

func TestParseQuery_UnterminatedBacktick(t *testing.T) {
	_, err := ParseQuery("TABLE `status")
	if err == nil {
		t.Fatal("expected error for unterminated backtick")
	}
	if !strings.Contains(err.Error(), "unterminated backtick") {
		t.Errorf("error = %q, want 'unterminated backtick' substring", err.Error())
	}
}

func TestParseQuery_DistinctBacktick(t *testing.T) {
	plan, err := ParseQuery("DISTINCT `group` WHERE status = \"active\"")
	if err != nil {
		t.Fatal(err)
	}
	if plan.Type != "distinct" {
		t.Errorf("type = %q, want distinct", plan.Type)
	}
	if len(plan.Fields) != 1 || plan.Fields[0].Expr != "group" {
		t.Errorf("fields = %v, want [group]", plan.Fields)
	}
	if plan.Where == nil {
		t.Error("expected WHERE clause")
	}
}

func TestParseQuery_WhereBeforeFrom(t *testing.T) {
	plan, err := ParseQuery(`TABLE name WHERE status = "active" FROM "students/"`)
	if err != nil {
		t.Fatal(err)
	}
	if plan.From != "students/" {
		t.Errorf("from = %q, want students/", plan.From)
	}
	if plan.Where == nil {
		t.Error("expected WHERE clause")
	}
}

func TestParseQuery_ColumnAlias(t *testing.T) {
	plan, err := ParseQuery(`TABLE name AS "Full Name", status AS State`)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Fields) != 2 {
		t.Fatalf("got %d fields, want 2", len(plan.Fields))
	}
	if plan.Fields[0].Expr != "name" || plan.Fields[0].Alias != "Full Name" {
		t.Errorf("field[0] = %+v, want {Expr:name, Alias:Full Name}", plan.Fields[0])
	}
	if plan.Fields[1].Expr != "status" || plan.Fields[1].Alias != "State" {
		t.Errorf("field[1] = %+v, want {Expr:status, Alias:State}", plan.Fields[1])
	}
}

func TestParseQuery_WithoutID(t *testing.T) {
	plan, err := ParseQuery(`TABLE WITHOUT ID name, status`)
	if err != nil {
		t.Fatal(err)
	}
	if !plan.WithoutID {
		t.Error("expected WithoutID = true")
	}
	if len(plan.Fields) != 2 {
		t.Fatalf("got %d fields, want 2", len(plan.Fields))
	}
}

func TestParseQuery_ListWithoutID(t *testing.T) {
	plan, err := ParseQuery(`LIST WITHOUT ID WHERE status = "active"`)
	if err != nil {
		t.Fatal(err)
	}
	if !plan.WithoutID {
		t.Error("expected WithoutID = true")
	}
	if plan.Type != "list" {
		t.Errorf("type = %q, want list", plan.Type)
	}
}

func TestParseQuery_MultipleWhere(t *testing.T) {
	plan, err := ParseQuery(`TABLE name WHERE status = "active" WHERE priority > 3`)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Where == nil {
		t.Fatal("where is nil")
	}
	be, ok := plan.Where.(*BinaryExpr)
	if !ok {
		t.Fatalf("expected BinaryExpr, got %T", plan.Where)
	}
	if be.Op != OpAnd {
		t.Errorf("op = %v, want AND", be.Op)
	}
}

func TestParseQuery_MultipleSort(t *testing.T) {
	plan, err := ParseQuery(`TABLE name SORT status ASC SORT name DESC`)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Sorts) != 2 {
		t.Fatalf("got %d sorts, want 2", len(plan.Sorts))
	}
	if plan.Sorts[0].Field != "status" || plan.Sorts[0].Order != "asc" {
		t.Errorf("sort[0] = %+v, want {status, asc}", plan.Sorts[0])
	}
	if plan.Sorts[1].Field != "name" || plan.Sorts[1].Order != "desc" {
		t.Errorf("sort[1] = %+v, want {name, desc}", plan.Sorts[1])
	}
}

func TestParseQuery_FromTag(t *testing.T) {
	plan, err := ParseQuery(`TABLE name FROM #game`)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.FromTags) != 1 {
		t.Fatalf("got %d tags, want 1", len(plan.FromTags))
	}
	if plan.FromTags[0].Tag != "game" || plan.FromTags[0].Negate {
		t.Errorf("tag = %+v, want {game, false}", plan.FromTags[0])
	}
}

func TestParseQuery_FromTagNegate(t *testing.T) {
	plan, err := ParseQuery(`TABLE name FROM #math AND -#physics`)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.FromTags) != 2 {
		t.Fatalf("got %d tags, want 2", len(plan.FromTags))
	}
	if plan.FromTags[0].Tag != "math" || plan.FromTags[0].Negate {
		t.Errorf("tag[0] = %+v, want {math, false}", plan.FromTags[0])
	}
	if plan.FromTags[1].Tag != "physics" || !plan.FromTags[1].Negate {
		t.Errorf("tag[1] = %+v, want {physics, true}", plan.FromTags[1])
	}
}

func TestParseQuery_Calendar(t *testing.T) {
	plan, err := ParseQuery(`CALENDAR last_active`)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Type != "calendar" {
		t.Errorf("type = %q, want calendar", plan.Type)
	}
	if len(plan.Fields) != 1 || plan.Fields[0].Expr != "last_active" {
		t.Errorf("fields = %v, want [last_active]", plan.Fields)
	}
}

func TestParseQuery_Errors(t *testing.T) {
	tests := []struct {
		name  string
		input string
	}{
		{"empty", ""},
		{"bad keyword", "FROBNICATE"},
		{"distinct no field", "DISTINCT"},
		{"bad limit", "LIST LIMIT abc"},
		{"bad offset", "LIST OFFSET abc"},
		{"unterminated backtick", "TABLE `open"},
		{"calendar no field", "CALENDAR"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := ParseQuery(tt.input)
			if err == nil {
				t.Errorf("expected error for %q", tt.input)
			}
		})
	}
}
