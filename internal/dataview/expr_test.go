package dataview

import (
	"testing"
)

func TestLexer(t *testing.T) {
	tests := []struct {
		input  string
		tokens []TokenType
	}{
		{"status = \"active\"", []TokenType{TokIdent, TokEq, TokString, TokEOF}},
		{"x != 42", []TokenType{TokIdent, TokNeq, TokNumber, TokEOF}},
		{"a AND b OR c", []TokenType{TokIdent, TokAnd, TokIdent, TokOr, TokIdent, TokEOF}},
		{"a && b || c", []TokenType{TokIdent, TokAnd, TokIdent, TokOr, TokIdent, TokEOF}},
		{"x IN (1, 2, 3)", []TokenType{TokIdent, TokIn, TokLParen, TokNumber, TokComma, TokNumber, TokComma, TokNumber, TokRParen, TokEOF}},
		{"x IS NULL", []TokenType{TokIdent, TokIs, TokNull, TokEOF}},
		{"x IS NOT NULL", []TokenType{TokIdent, TokIs, TokNot, TokNull, TokEOF}},
		{"x BETWEEN 1 AND 10", []TokenType{TokIdent, TokBetween, TokNumber, TokAnd, TokNumber, TokEOF}},
		{"x LIKE \"%test%\"", []TokenType{TokIdent, TokLike, TokString, TokEOF}},
		{"true AND false", []TokenType{TokBool, TokAnd, TokBool, TokEOF}},
		{"a.b.c = 1", []TokenType{TokIdent, TokDot, TokIdent, TokDot, TokIdent, TokEq, TokNumber, TokEOF}},
		{"fn(x, y)", []TokenType{TokIdent, TokLParen, TokIdent, TokComma, TokIdent, TokRParen, TokEOF}},
		{"-3.14", []TokenType{TokNumber, TokEOF}},
		{"x <= 5", []TokenType{TokIdent, TokLte, TokNumber, TokEOF}},
		{"x >= 5", []TokenType{TokIdent, TokGte, TokNumber, TokEOF}},
		{"x <> 5", []TokenType{TokIdent, TokNeq, TokNumber, TokEOF}},
		{"x == 5", []TokenType{TokIdent, TokEq, TokNumber, TokEOF}},
		{"nil", []TokenType{TokNil, TokEOF}},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			lex := NewLexer(tt.input)
			tokens, err := lex.Tokenize()
			if err != nil {
				t.Fatalf("Tokenize(%q) error: %v", tt.input, err)
			}
			if len(tokens) != len(tt.tokens) {
				t.Fatalf("Tokenize(%q) got %d tokens, want %d", tt.input, len(tokens), len(tt.tokens))
			}
			for i, tok := range tokens {
				if tok.Type != tt.tokens[i] {
					t.Errorf("token[%d] = %v, want %v", i, tok.Type, tt.tokens[i])
				}
			}
		})
	}
}

func TestLexerErrors(t *testing.T) {
	tests := []string{
		`"unterminated string`,
		`'unterminated single`,
	}
	for _, input := range tests {
		t.Run(input, func(t *testing.T) {
			lex := NewLexer(input)
			_, err := lex.Tokenize()
			if err == nil {
				t.Errorf("expected error for %q", input)
			}
		})
	}
}

func TestParseExpr_Simple(t *testing.T) {
	tests := []struct {
		input string
		check func(t *testing.T, expr Expr)
	}{
		{
			input: `status = "active"`,
			check: func(t *testing.T, expr Expr) {
				b, ok := expr.(*BinaryExpr)
				if !ok {
					t.Fatalf("expected BinaryExpr, got %T", expr)
				}
				if b.Op != OpEq {
					t.Errorf("op = %v, want =", b.Op)
				}
				f, ok := b.Left.(*FieldRef)
				if !ok || f.Path != "status" {
					t.Errorf("left = %v, want FieldRef{status}", b.Left)
				}
				l, ok := b.Right.(*Literal)
				if !ok || l.Value != "active" {
					t.Errorf("right = %v, want Literal{active}", b.Right)
				}
			},
		},
		{
			input: `priority > 3`,
			check: func(t *testing.T, expr Expr) {
				b := expr.(*BinaryExpr)
				if b.Op != OpGt {
					t.Errorf("op = %v, want >", b.Op)
				}
			},
		},
		{
			input: `score <= 0.5`,
			check: func(t *testing.T, expr Expr) {
				b := expr.(*BinaryExpr)
				if b.Op != OpLte {
					t.Errorf("op = %v, want <=", b.Op)
				}
				l := b.Right.(*Literal)
				if l.Value != 0.5 {
					t.Errorf("right = %v, want 0.5", l.Value)
				}
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			expr, err := ParseExpr(tt.input)
			if err != nil {
				t.Fatalf("ParseExpr(%q) error: %v", tt.input, err)
			}
			tt.check(t, expr)
		})
	}
}

func TestParseExpr_AndOr(t *testing.T) {
	expr, err := ParseExpr(`status = "active" AND priority > 3`)
	if err != nil {
		t.Fatal(err)
	}
	b, ok := expr.(*BinaryExpr)
	if !ok || b.Op != OpAnd {
		t.Fatalf("expected AND, got %T %v", expr, expr)
	}
	left := b.Left.(*BinaryExpr)
	if left.Op != OpEq {
		t.Errorf("left op = %v, want =", left.Op)
	}
	right := b.Right.(*BinaryExpr)
	if right.Op != OpGt {
		t.Errorf("right op = %v, want >", right.Op)
	}
}

func TestParseExpr_Precedence(t *testing.T) {
	// OR has lower precedence than AND: a OR b AND c → a OR (b AND c)
	expr, err := ParseExpr(`a = 1 OR b = 2 AND c = 3`)
	if err != nil {
		t.Fatal(err)
	}
	top := expr.(*BinaryExpr)
	if top.Op != OpOr {
		t.Fatalf("top op = %v, want OR", top.Op)
	}
	right := top.Right.(*BinaryExpr)
	if right.Op != OpAnd {
		t.Errorf("right op = %v, want AND", right.Op)
	}
}

func TestParseExpr_Not(t *testing.T) {
	expr, err := ParseExpr(`NOT status = "active"`)
	if err != nil {
		t.Fatal(err)
	}
	u, ok := expr.(*UnaryExpr)
	if !ok || u.Op != OpNot {
		t.Fatalf("expected NOT, got %T", expr)
	}
}

func TestParseExpr_Parens(t *testing.T) {
	expr, err := ParseExpr(`(a = 1 OR b = 2) AND c = 3`)
	if err != nil {
		t.Fatal(err)
	}
	top := expr.(*BinaryExpr)
	if top.Op != OpAnd {
		t.Fatalf("top op = %v, want AND", top.Op)
	}
	left := top.Left.(*BinaryExpr)
	if left.Op != OpOr {
		t.Errorf("left op = %v, want OR", left.Op)
	}
}

func TestParseExpr_In(t *testing.T) {
	expr, err := ParseExpr(`status IN ("active", "pending")`)
	if err != nil {
		t.Fatal(err)
	}
	b := expr.(*BinaryExpr)
	if b.Op != OpIn {
		t.Fatalf("op = %v, want IN", b.Op)
	}
	list := b.Right.(*ListExpr)
	if len(list.Items) != 2 {
		t.Errorf("list items = %d, want 2", len(list.Items))
	}
}

func TestParseExpr_NotIn(t *testing.T) {
	expr, err := ParseExpr(`status NOT IN ("closed", "archived")`)
	if err != nil {
		t.Fatal(err)
	}
	b := expr.(*BinaryExpr)
	if b.Op != OpNotIn {
		t.Fatalf("op = %v, want NOT IN", b.Op)
	}
}

func TestParseExpr_Between(t *testing.T) {
	expr, err := ParseExpr(`score BETWEEN 0.1 AND 0.9`)
	if err != nil {
		t.Fatal(err)
	}
	be := expr.(*BetweenExpr)
	f := be.Expr.(*FieldRef)
	if f.Path != "score" {
		t.Errorf("field = %q, want score", f.Path)
	}
}

func TestParseExpr_IsNull(t *testing.T) {
	expr, err := ParseExpr(`status IS NULL`)
	if err != nil {
		t.Fatal(err)
	}
	isn := expr.(*IsNullExpr)
	if isn.Negate {
		t.Error("expected IS NULL, not IS NOT NULL")
	}
}

func TestParseExpr_IsNotNull(t *testing.T) {
	expr, err := ParseExpr(`status IS NOT NULL`)
	if err != nil {
		t.Fatal(err)
	}
	isn := expr.(*IsNullExpr)
	if !isn.Negate {
		t.Error("expected IS NOT NULL")
	}
}

func TestParseExpr_Like(t *testing.T) {
	expr, err := ParseExpr(`title LIKE "%calculus%"`)
	if err != nil {
		t.Fatal(err)
	}
	b := expr.(*BinaryExpr)
	if b.Op != OpLike {
		t.Fatalf("op = %v, want LIKE", b.Op)
	}
}

func TestParseExpr_NotLike(t *testing.T) {
	expr, err := ParseExpr(`title NOT LIKE "%draft%"`)
	if err != nil {
		t.Fatal(err)
	}
	b := expr.(*BinaryExpr)
	if b.Op != OpNotLike {
		t.Fatalf("op = %v, want NOT LIKE", b.Op)
	}
}

func TestParseExpr_FuncCall(t *testing.T) {
	expr, err := ParseExpr(`contains(tags, "math")`)
	if err != nil {
		t.Fatal(err)
	}
	fc := expr.(*FuncCall)
	if fc.Name != "contains" {
		t.Errorf("name = %q, want contains", fc.Name)
	}
	if len(fc.Args) != 2 {
		t.Errorf("args = %d, want 2", len(fc.Args))
	}
}

func TestParseExpr_NestedField(t *testing.T) {
	expr, err := ParseExpr(`mastery.derivatives < 0.3`)
	if err != nil {
		t.Fatal(err)
	}
	b := expr.(*BinaryExpr)
	f := b.Left.(*FieldRef)
	if f.Path != "mastery.derivatives" {
		t.Errorf("field = %q, want mastery.derivatives", f.Path)
	}
}

func TestParseExpr_Boolean(t *testing.T) {
	expr, err := ParseExpr(`active = true`)
	if err != nil {
		t.Fatal(err)
	}
	b := expr.(*BinaryExpr)
	l := b.Right.(*Literal)
	if l.Value != true {
		t.Errorf("value = %v, want true", l.Value)
	}
}

func TestParseExpr_Nil(t *testing.T) {
	expr, err := ParseExpr(`status = nil`)
	if err != nil {
		t.Fatal(err)
	}
	b := expr.(*BinaryExpr)
	l := b.Right.(*Literal)
	if l.Value != nil {
		t.Errorf("value = %v, want nil", l.Value)
	}
}

func TestParseExpr_Errors(t *testing.T) {
	tests := []string{
		"",
		"= 5",
		"x IN",
		"x IN (",
		"x BETWEEN 1",
		"x IS 5",
	}
	for _, input := range tests {
		t.Run(input, func(t *testing.T) {
			_, err := ParseExpr(input)
			if err == nil {
				t.Errorf("expected error for %q", input)
			}
		})
	}
}
