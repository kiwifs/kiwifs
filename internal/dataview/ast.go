package dataview

// Expr is the interface all AST nodes implement.
type Expr interface{ exprNode() }

// Operator enumerates binary and unary operators.
type Operator int

const (
	OpEq Operator = iota
	OpNeq
	OpLt
	OpGt
	OpLte
	OpGte
	OpAnd
	OpOr
	OpNot
	OpLike
	OpNotLike
	OpIn
	OpNotIn
)

func (o Operator) String() string {
	switch o {
	case OpEq:
		return "="
	case OpNeq:
		return "!="
	case OpLt:
		return "<"
	case OpGt:
		return ">"
	case OpLte:
		return "<="
	case OpGte:
		return ">="
	case OpAnd:
		return "AND"
	case OpOr:
		return "OR"
	case OpNot:
		return "NOT"
	case OpLike:
		return "LIKE"
	case OpNotLike:
		return "NOT LIKE"
	case OpIn:
		return "IN"
	case OpNotIn:
		return "NOT IN"
	default:
		return "?"
	}
}

type BinaryExpr struct {
	Left  Expr
	Op    Operator
	Right Expr
}

type UnaryExpr struct {
	Op   Operator
	Expr Expr
}

type FieldRef struct {
	Path string // "status", "mastery.derivatives"
}

type Literal struct {
	Value any // string, int64, float64, bool, nil
}

type FuncCall struct {
	Name string
	Args []Expr
}

type ListExpr struct {
	Items []Expr
}

type BetweenExpr struct {
	Expr Expr
	Low  Expr
	High Expr
}

type IsNullExpr struct {
	Expr   Expr
	Negate bool // IS NOT NULL
}

func (*BinaryExpr) exprNode()  {}
func (*UnaryExpr) exprNode()   {}
func (*FieldRef) exprNode()    {}
func (*Literal) exprNode()     {}
func (*FuncCall) exprNode()    {}
func (*ListExpr) exprNode()    {}
func (*BetweenExpr) exprNode() {}
func (*IsNullExpr) exprNode()  {}
