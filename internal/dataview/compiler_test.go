package dataview

import (
	"strings"
	"testing"
)

func TestCompileSQL_SimpleWhere(t *testing.T) {
	plan := &QueryPlan{
		Type:   "table",
		Fields: []FieldSpec{{Expr: "name"}, {Expr: "status"}},
		Where:  &BinaryExpr{Left: &FieldRef{Path: "status"}, Op: OpEq, Right: &Literal{Value: "active"}},
		Limit:  50,
	}
	sql, args, err := CompileSQL(plan)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sql, "json_extract(file_meta.frontmatter, '$.status') = ?") {
		t.Errorf("sql = %q, missing json_extract WHERE clause", sql)
	}
	if len(args) < 1 || args[0] != "active" {
		t.Errorf("args = %v, want [active ...]", args)
	}
}

func TestCompileSQL_Count(t *testing.T) {
	plan := &QueryPlan{
		Type:  "count",
		From:  "concepts/",
		Where: &BinaryExpr{Left: &FieldRef{Path: "status"}, Op: OpEq, Right: &Literal{Value: "active"}},
		Limit: 50,
	}
	sql, args, err := CompileSQL(plan)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(sql, "SELECT COUNT(*)") {
		t.Errorf("sql = %q, want SELECT COUNT(*)", sql)
	}
	if !strings.Contains(sql, "file_meta.path LIKE ? || '%'") {
		t.Errorf("sql = %q, missing FROM clause", sql)
	}
	if len(args) < 1 || args[0] != "concepts/" {
		t.Errorf("args[0] = %v, want concepts/", args[0])
	}
}

func TestCompileSQL_Distinct(t *testing.T) {
	plan := &QueryPlan{
		Type:   "distinct",
		Fields: []FieldSpec{{Expr: "status"}},
		Limit:  50,
	}
	sql, _, err := CompileSQL(plan)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sql, "SELECT DISTINCT") {
		t.Errorf("sql = %q, missing DISTINCT", sql)
	}
}

func TestCompileSQL_GroupBy(t *testing.T) {
	plan := &QueryPlan{
		Type:    "table",
		GroupBy: "status",
		Limit:   50,
	}
	sql, _, err := CompileSQL(plan)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sql, "grp") {
		t.Errorf("sql = %q, missing group alias", sql)
	}
}

func TestCompileSQL_Flatten(t *testing.T) {
	plan := &QueryPlan{
		Type:    "table",
		Fields:  []FieldSpec{{Expr: "name"}},
		Flatten: "tags",
		Limit:   50,
	}
	sql, _, err := CompileSQL(plan)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sql, "json_each(file_meta.frontmatter, '$.tags')") {
		t.Errorf("sql = %q, missing json_each", sql)
	}
}

func TestCompileSQL_ImplicitFields(t *testing.T) {
	plan := &QueryPlan{
		Type:   "table",
		Fields: []FieldSpec{{Expr: "_path"}, {Expr: "_updated"}},
		Sort:   "_updated",
		Order:  "desc",
		Limit:  50,
	}
	sql, _, err := CompileSQL(plan)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sql, "file_meta.path AS _path") {
		t.Errorf("sql = %q, missing file_meta.path AS _path", sql)
	}
	if !strings.Contains(sql, "file_meta.updated_at AS _updated") {
		t.Errorf("sql = %q, missing file_meta.updated_at", sql)
	}
	if !strings.Contains(sql, "ORDER BY file_meta.updated_at DESC") {
		t.Errorf("sql = %q, missing ORDER BY file_meta.updated_at DESC", sql)
	}
}

func TestCompileSQL_IN(t *testing.T) {
	plan := &QueryPlan{
		Type: "table",
		Where: &BinaryExpr{
			Left: &FieldRef{Path: "status"},
			Op:   OpIn,
			Right: &ListExpr{Items: []Expr{
				&Literal{Value: "active"},
				&Literal{Value: "pending"},
			}},
		},
		Limit: 50,
	}
	sql, args, err := CompileSQL(plan)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sql, "IN (?, ?)") {
		t.Errorf("sql = %q, missing IN clause", sql)
	}
	if len(args) < 2 || args[0] != "active" || args[1] != "pending" {
		t.Errorf("args = %v, want [active pending ...]", args)
	}
}

func TestCompileSQL_IsNull(t *testing.T) {
	plan := &QueryPlan{
		Type:  "table",
		Where: &IsNullExpr{Expr: &FieldRef{Path: "notes"}, Negate: false},
		Limit: 50,
	}
	sql, _, err := CompileSQL(plan)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sql, "IS NULL") {
		t.Errorf("sql = %q, missing IS NULL", sql)
	}
}

func TestCompileSQL_IsNotNull(t *testing.T) {
	plan := &QueryPlan{
		Type:  "table",
		Where: &IsNullExpr{Expr: &FieldRef{Path: "notes"}, Negate: true},
		Limit: 50,
	}
	sql, _, err := CompileSQL(plan)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sql, "IS NOT NULL") {
		t.Errorf("sql = %q, missing IS NOT NULL", sql)
	}
}

func TestCompileSQL_BoundParams(t *testing.T) {
	plan := &QueryPlan{
		Type:  "table",
		Where: &BinaryExpr{Left: &FieldRef{Path: "name"}, Op: OpEq, Right: &Literal{Value: `'; DROP TABLE file_meta; --`}},
		Limit: 50,
	}
	sql, args, err := CompileSQL(plan)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(sql, "DROP") {
		t.Errorf("SQL injection detected in: %s", sql)
	}
	found := false
	for _, a := range args {
		if a == `'; DROP TABLE file_meta; --` {
			found = true
		}
	}
	if !found {
		t.Error("injection string not found in bound params")
	}
}

func TestCompileSQL_InvalidFieldPath(t *testing.T) {
	plan := &QueryPlan{
		Type:  "table",
		Where: &BinaryExpr{Left: &FieldRef{Path: "'; DROP TABLE"}, Op: OpEq, Right: &Literal{Value: "x"}},
		Limit: 50,
	}
	_, _, err := CompileSQL(plan)
	if err == nil {
		t.Error("expected error for invalid field path")
	}
}
