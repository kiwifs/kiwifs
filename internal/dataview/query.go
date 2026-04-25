package dataview

// FieldSpec describes a single column in a TABLE/LIST/JSON query.
type FieldSpec struct {
	Expr   string // field path or expression text, e.g. "name", "days_since(last_active)"
	Alias  string // display name; "" means use Expr as header
	Parsed Expr   // parsed AST for computed expressions; nil = simple field path
}

// SortSpec describes one element of an ORDER BY chain.
type SortSpec struct {
	Field string // field path
	Order string // "asc" | "desc"
}

// QueryPlan is the parsed representation of a DQL statement, ready for
// the SQL compiler to turn into a SQLite query.
type QueryPlan struct {
	Type      string      // "table" | "list" | "count" | "distinct" | "json" | "calendar"
	From      string      // folder prefix filter (e.g. "concepts/")
	FromTags  []TagFilter // tag-based FROM filter (#tag)
	Fields    []FieldSpec // columns with optional aliases
	WithoutID bool        // TABLE WITHOUT ID / LIST WITHOUT ID
	Where     Expr        // parsed expression AST (or nil = no filter)
	Sort      string      // sort field (single, legacy compat)
	Order     string      // "asc" | "desc" (legacy compat)
	Sorts     []SortSpec  // multi-sort chain; takes precedence over Sort/Order
	GroupBy   string      // group field: "status"
	Flatten   string      // array field to unnest: "tags"
	Limit     int         // default 50, max 200
	Offset    int
}

// TagFilter is a tag-based FROM filter.
type TagFilter struct {
	Tag    string
	Negate bool
}

// FieldNames returns just the Expr strings from Fields (for backward compat).
func (qp *QueryPlan) FieldNames() []string {
	names := make([]string, len(qp.Fields))
	for i, f := range qp.Fields {
		names[i] = f.Expr
	}
	return names
}

// QueryResult holds the output of executing a QueryPlan.
type QueryResult struct {
	Columns []string         `json:"columns"`
	Rows    []map[string]any `json:"rows"`
	Total   int              `json:"total"`
	HasMore bool             `json:"has_more"`
	Groups  []GroupResult    `json:"groups,omitempty"`
}

// GroupResult is one bucket in a GROUP BY result.
type GroupResult struct {
	Key   string           `json:"key"`
	Count int              `json:"count"`
	Rows  []map[string]any `json:"rows,omitempty"`
}
