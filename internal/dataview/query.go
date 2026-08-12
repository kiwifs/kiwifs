package dataview

// Row grains a query can run over. SourceFiles is the default and is what
// every query used before `FROM RECORDS` existed.
//
// SourceRecords and SourceClaims share one compile path: the `provenance`
// table is column-for-column identical to `page_records`, so the only
// difference is which table the grain drives and whether the kind filter is
// mandatory.
const (
	SourceFiles   = "files"
	SourceRecords = "records"
	SourceClaims  = "claims"
)

// recordGrainTables maps a record-grain source to its driving table.
var recordGrainTables = map[string]string{
	SourceRecords: "page_records",
	SourceClaims:  "provenance",
}

// isRecordGrain reports whether a source yields one row per record rather
// than one row per page.
func isRecordGrain(source string) bool {
	_, ok := recordGrainTables[source]
	return ok
}

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
	Type string // "table" | "list" | "count" | "distinct" | "json" | "calendar"
	// Source selects the row grain: "" / "files" is one row per page
	// (file_meta), "records" is one row per kiwi-data record (page_records),
	// "claims" is one row per claim directive (provenance).
	Source string
	// RecordKind is the kiwi-data record kind when Source == "records", and
	// the claim's evidence class when Source == "claims". It is required for
	// records (a query over every record kind at once is meaningless) and
	// optional for claims, where an empty kind means every evidence class.
	RecordKind string
	From       string      // folder prefix filter (e.g. "concepts/")
	FromTags   []TagFilter // tag-based FROM filter (#tag)
	Fields     []FieldSpec // columns with optional aliases
	WithoutID  bool        // TABLE WITHOUT ID / LIST WITHOUT ID
	Where      Expr        // parsed expression AST (or nil = no filter)
	Sort       string      // sort field (single, legacy compat)
	Order      string      // "asc" | "desc" (legacy compat)
	Sorts      []SortSpec  // multi-sort chain; takes precedence over Sort/Order
	GroupBy    string      // group field: "status"
	Flatten    string      // array field to unnest: "tags"
	Limit      int         // default 50, max 200
	Offset     int
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
