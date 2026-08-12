package dataview

import (
	"fmt"
	"regexp"
	"strings"
)

// validFieldRe validates field paths used in json_extract.
var validFieldRe = regexp.MustCompile(`^[a-zA-Z0-9_\-.\[\]*]+$`)

// CompileSQL turns a QueryPlan into a SQLite query with bound parameters.
func CompileSQL(plan *QueryPlan) (string, []any, error) {
	c := &compiler{plan: plan}
	return c.compile()
}

// CompileSQLWithIndexer is like CompileSQL but uses the auto-indexer to
// resolve fields to generated columns when available.
func CompileSQLWithIndexer(plan *QueryPlan, indexer *AutoIndexer) (string, []any, error) {
	c := &compiler{plan: plan, indexer: indexer}
	return c.compile()
}

type compiler struct {
	plan    *QueryPlan
	params  []any
	indexer *AutoIndexer
	// rollupAlias, when set, redirects every field reference to that
	// file_meta alias — the linked-to page inside a rollup() subquery.
	rollupAlias string
}

// records reports whether this query runs at record grain — one row per
// kiwi-data record or per claim, rather than per page. Inside a rollup
// subquery the row is always a page, whatever the outer grain is.
func (c *compiler) records() bool {
	if c.plan == nil || c.rollupAlias != "" {
		return false
	}
	_, ok := recordGrainTables[c.plan.Source]
	return ok
}

// recordTable is the driving table for the current record grain. The two
// record-grain tables have identical columns, which is what lets every
// expression below name the table through this one accessor.
func (c *compiler) recordTable() string {
	if c.plan == nil {
		return "page_records"
	}
	if t, ok := recordGrainTables[c.plan.Source]; ok {
		return t
	}
	return "page_records"
}

// fromClause is the table expression every compile path selects from. At
// record grain the record table drives and file_meta is joined so the parent
// page's frontmatter stays addressable.
func (c *compiler) fromClause() string {
	if c.records() {
		t := c.recordTable()
		return " FROM " + t + " LEFT JOIN file_meta ON file_meta.path = " + t + ".path"
	}
	return " FROM file_meta"
}

// pathColumn is the column holding the page path for the current grain.
func (c *compiler) pathColumn() string {
	if c.records() {
		return c.recordTable() + ".path"
	}
	return "file_meta.path"
}

// frontmatterColumn is the trailing column every row carries. A record whose
// page somehow has no file_meta row still needs valid JSON here, because the
// executor scans it into a string.
func (c *compiler) frontmatterColumn() string {
	if c.records() {
		return "COALESCE(file_meta.frontmatter, '{}')"
	}
	return "file_meta.frontmatter"
}

// jsonBase is the JSON document a bare field path reads from.
func (c *compiler) jsonBase() string {
	if c.rollupAlias != "" {
		return c.rollupAlias + ".frontmatter"
	}
	if c.records() {
		return c.recordTable() + ".json"
	}
	return "file_meta.frontmatter"
}

func (c *compiler) compile() (string, []any, error) {
	if c.records() {
		if c.plan.Source == SourceRecords && c.plan.RecordKind == "" {
			return "", nil, fmt.Errorf("FROM RECORDS requires a record kind")
		}
		if c.plan.Type == "task" {
			return "", nil, fmt.Errorf("TASK queries run over pages, not records")
		}
	}
	switch c.plan.Type {
	case "count":
		return c.compileCount()
	case "distinct":
		return c.compileDistinct()
	case "task":
		return c.compileTask()
	default:
		return c.compileSelect()
	}
}

func (c *compiler) compileTask() (string, []any, error) {
	var sb strings.Builder
	sb.WriteString("SELECT file_meta.path, file_meta.tasks FROM file_meta")

	// Add base condition: only files with tasks
	var conditions []string
	conditions = append(conditions, "json_array_length(file_meta.tasks) > 0")

	if c.plan.From != "" {
		conditions = append(conditions, "file_meta.path LIKE ? || '%'")
		c.params = append(c.params, c.plan.From)
	}

	for _, tf := range c.plan.FromTags {
		if tf.Negate {
			conditions = append(conditions,
				"NOT EXISTS (SELECT 1 FROM json_each(file_meta.frontmatter, '$.tags') WHERE value = ?)")
		} else {
			conditions = append(conditions,
				"EXISTS (SELECT 1 FROM json_each(file_meta.frontmatter, '$.tags') WHERE value = ?)")
		}
		c.params = append(c.params, tf.Tag)
	}

	if len(conditions) > 0 {
		fmt.Fprintf(&sb, " WHERE %s", strings.Join(conditions, " AND "))
	}

	sb.WriteString(" ORDER BY file_meta.path ASC")
	c.writeLimitOffset(&sb)
	return sb.String(), c.params, nil
}

func (c *compiler) compileCount() (string, []any, error) {
	var sb strings.Builder
	sb.WriteString("SELECT COUNT(*) AS cnt")
	sb.WriteString(c.fromClause())

	if err := c.writeFromAndFlatten(&sb); err != nil {
		return "", nil, err
	}
	if err := c.writeWhere(&sb); err != nil {
		return "", nil, err
	}
	return sb.String(), c.params, nil
}

func (c *compiler) compileDistinct() (string, []any, error) {
	if len(c.plan.Fields) == 0 {
		return "", nil, fmt.Errorf("DISTINCT requires a field")
	}
	field := c.plan.Fields[0].Expr
	fieldSQL, err := c.fieldToSQL(field)
	if err != nil {
		return "", nil, err
	}

	var sb strings.Builder
	fmt.Fprintf(&sb, "SELECT DISTINCT %s AS val", fieldSQL)
	sb.WriteString(c.fromClause())

	if err := c.writeFromAndFlatten(&sb); err != nil {
		return "", nil, err
	}
	if err := c.writeWhere(&sb); err != nil {
		return "", nil, err
	}

	sb.WriteString(" ORDER BY val ASC")
	c.writeLimitOffset(&sb)
	return sb.String(), c.params, nil
}

func (c *compiler) compileSelect() (string, []any, error) {
	var sb strings.Builder

	if c.plan.GroupBy != "" {
		return c.compileGroupBy()
	}

	// SELECT clause
	if c.plan.WithoutID {
		first := true
		sb.WriteString("SELECT ")
		for _, fs := range c.plan.Fields {
			fieldSQL, fsParams, err := c.fieldSpecToSQL(fs)
			if err != nil {
				return "", nil, err
			}
			c.params = append(c.params, fsParams...)
			if !first {
				sb.WriteString(", ")
			}
			first = false
			fmt.Fprintf(&sb, "%s AS %s", fieldSQL, c.aliasFor(fs))
		}
		if first {
			sb.WriteString(c.frontmatterColumn())
		}
		fmt.Fprintf(&sb, ", %s", c.frontmatterColumn())
	} else {
		fmt.Fprintf(&sb, "SELECT %s", c.pathColumn())
		for _, fs := range c.plan.Fields {
			fieldSQL, fsParams, err := c.fieldSpecToSQL(fs)
			if err != nil {
				return "", nil, err
			}
			c.params = append(c.params, fsParams...)
			fmt.Fprintf(&sb, ", %s AS %s", fieldSQL, c.aliasFor(fs))
		}
		fmt.Fprintf(&sb, ", %s", c.frontmatterColumn())
	}
	sb.WriteString(c.fromClause())

	if err := c.writeFromAndFlatten(&sb); err != nil {
		return "", nil, err
	}
	if err := c.writeWhere(&sb); err != nil {
		return "", nil, err
	}
	if err := c.writeOrderBy(&sb); err != nil {
		return "", nil, err
	}
	limit := c.plan.Limit + 1
	c.params = append(c.params, limit, c.plan.Offset)
	sb.WriteString(" LIMIT ? OFFSET ?")

	return sb.String(), c.params, nil
}

func (c *compiler) compileGroupBy() (string, []any, error) {
	var sb strings.Builder
	groupSQL, err := c.fieldToSQL(c.plan.GroupBy)
	if err != nil {
		return "", nil, err
	}

	// Select group key + all user fields + frontmatter for row building
	fmt.Fprintf(&sb, "SELECT %s AS grp", groupSQL)
	for _, fs := range c.plan.Fields {
		fieldSQL, fsParams, err := c.fieldSpecToSQL(fs)
		if err != nil {
			return "", nil, err
		}
		c.params = append(c.params, fsParams...)
		fmt.Fprintf(&sb, ", %s AS %s", fieldSQL, c.aliasFor(fs))
	}
	fmt.Fprintf(&sb, ", %s, %s", c.pathColumn(), c.frontmatterColumn())
	sb.WriteString(c.fromClause())

	if err := c.writeFromAndFlatten(&sb); err != nil {
		return "", nil, err
	}
	if err := c.writeWhere(&sb); err != nil {
		return "", nil, err
	}
	if err := c.writeOrderBy(&sb); err != nil {
		return "", nil, err
	}
	c.writeLimitOffset(&sb)
	return sb.String(), c.params, nil
}

func (c *compiler) writeFromAndFlatten(sb *strings.Builder) error {
	if c.plan.Flatten != "" {
		if err := validateFieldPath(c.plan.Flatten); err != nil {
			return fmt.Errorf("FLATTEN field: %w", err)
		}
		fmt.Fprintf(sb, ", json_each(%s, '$.%s') AS _flat", c.jsonBase(), c.plan.Flatten)
	}
	return nil
}

func (c *compiler) writeWhere(sb *strings.Builder) error {
	var conditions []string

	// The record kind is always bound, never interpolated: a kind is
	// user-authored text and may contain quotes. An empty kind is only
	// reachable for FROM CLAIMS, where it means every evidence class.
	if c.records() && c.plan.RecordKind != "" {
		conditions = append(conditions, c.recordTable()+".kind = ?")
		c.params = append(c.params, c.plan.RecordKind)
	}

	if c.plan.From != "" {
		conditions = append(conditions, c.pathColumn()+" LIKE ? || '%'")
		c.params = append(c.params, c.plan.From)
	}

	if c.plan.Flatten != "" {
		conditions = append(conditions,
			fmt.Sprintf("json_type(%s, '$.%s') = 'array'", c.jsonBase(), c.plan.Flatten))
		if c.usesFlattenSubfields() {
			conditions = append(conditions, "json_type(_flat.value) = 'object'")
		}
	}

	for _, tf := range c.plan.FromTags {
		if tf.Negate {
			conditions = append(conditions,
				"NOT EXISTS (SELECT 1 FROM json_each(file_meta.frontmatter, '$.tags') WHERE value = ?)")
		} else {
			conditions = append(conditions,
				"EXISTS (SELECT 1 FROM json_each(file_meta.frontmatter, '$.tags') WHERE value = ?)")
		}
		c.params = append(c.params, tf.Tag)
	}

	if c.plan.Where != nil {
		whereSQL, whereParams, err := c.compileExpr(c.plan.Where)
		if err != nil {
			return fmt.Errorf("WHERE: %w", err)
		}
		conditions = append(conditions, whereSQL)
		c.params = append(c.params, whereParams...)
	}

	if len(conditions) > 0 {
		fmt.Fprintf(sb, " WHERE %s", strings.Join(conditions, " AND "))
	}
	return nil
}

func (c *compiler) writeOrderBy(sb *strings.Builder) error {
	if len(c.plan.Sorts) > 0 {
		var parts []string
		for _, s := range c.plan.Sorts {
			sortSQL, err := c.fieldToSQL(s.Field)
			if err != nil {
				return fmt.Errorf("SORT field: %w", err)
			}
			dir := "ASC"
			if strings.EqualFold(s.Order, "desc") {
				dir = "DESC"
			}
			parts = append(parts, fmt.Sprintf("%s %s", sortSQL, dir))
		}
		fmt.Fprintf(sb, " ORDER BY %s", strings.Join(parts, ", "))
	} else if c.plan.Sort != "" {
		sortSQL, err := c.fieldToSQL(c.plan.Sort)
		if err != nil {
			return fmt.Errorf("SORT field: %w", err)
		}
		dir := "ASC"
		if strings.EqualFold(c.plan.Order, "desc") {
			dir = "DESC"
		}
		fmt.Fprintf(sb, " ORDER BY %s %s", sortSQL, dir)
	} else if c.records() {
		// Document order: page, then block, then position within the block.
		t := c.recordTable()
		fmt.Fprintf(sb, " ORDER BY %[1]s.path ASC, %[1]s.block_index ASC, %[1]s.record_index ASC", t)
	} else {
		sb.WriteString(" ORDER BY file_meta.path ASC")
	}
	return nil
}

func (c *compiler) writeLimitOffset(sb *strings.Builder) {
	c.params = append(c.params, c.plan.Limit, c.plan.Offset)
	sb.WriteString(" LIMIT ? OFFSET ?")
}

func (c *compiler) fieldSpecToSQL(fs FieldSpec) (string, []any, error) {
	if fs.Parsed != nil {
		return c.compileExpr(fs.Parsed)
	}
	sql, err := c.fieldToSQL(fs.Expr)
	return sql, nil, err
}

func (c *compiler) flattenFieldSQL(field string) (string, bool) {
	if c.plan == nil || c.plan.Flatten == "" {
		return "", false
	}
	flat := c.plan.Flatten
	if field == flat {
		return "_flat.value", true
	}
	prefix := flat + "."
	if strings.HasPrefix(field, prefix) {
		sub := field[len(prefix):]
		if sub == "" || !validFieldRe.MatchString(sub) {
			return "", false
		}
		return fmt.Sprintf("json_extract(_flat.value, '$.%s')", sub), true
	}
	return "", false
}

func (c *compiler) usesFlattenSubfields() bool {
	if c.plan == nil || c.plan.Flatten == "" {
		return false
	}
	prefix := c.plan.Flatten + "."
	for _, fs := range c.plan.Fields {
		if strings.HasPrefix(fs.Expr, prefix) {
			return true
		}
	}
	if c.plan.Sort != "" && strings.HasPrefix(c.plan.Sort, prefix) {
		return true
	}
	for _, s := range c.plan.Sorts {
		if strings.HasPrefix(s.Field, prefix) {
			return true
		}
	}
	if c.plan.GroupBy != "" && strings.HasPrefix(c.plan.GroupBy, prefix) {
		return true
	}
	if c.plan.Where != nil && exprUsesFlattenSubfield(c.plan.Where, prefix) {
		return true
	}
	return false
}

func exprUsesFlattenSubfield(expr Expr, prefix string) bool {
	switch e := expr.(type) {
	case *FieldRef:
		return strings.HasPrefix(e.Path, prefix)
	case *BinaryExpr:
		return exprUsesFlattenSubfield(e.Left, prefix) || exprUsesFlattenSubfield(e.Right, prefix)
	case *UnaryExpr:
		return exprUsesFlattenSubfield(e.Expr, prefix)
	case *FuncCall:
		for _, arg := range e.Args {
			if exprUsesFlattenSubfield(arg, prefix) {
				return true
			}
		}
	case *ListExpr:
		for _, item := range e.Items {
			if exprUsesFlattenSubfield(item, prefix) {
				return true
			}
		}
	case *BetweenExpr:
		return exprUsesFlattenSubfield(e.Expr, prefix) ||
			exprUsesFlattenSubfield(e.Low, prefix) ||
			exprUsesFlattenSubfield(e.High, prefix)
	case *IsNullExpr:
		return exprUsesFlattenSubfield(e.Expr, prefix)
	}
	return false
}

func (c *compiler) fieldToSQL(field string) (string, error) {
	return c.resolveFieldSQL(field, c.indexer != nil)
}

// resolveFieldSQL maps a DQL field path to a SQL expression.
//
// In records mode the namespacing rule is:
//
//	name          → the record's own field, falling back to the parent
//	                page's frontmatter when the record has no such key
//	record.name   → the record's field only
//	page.name     → the parent page's frontmatter only
//
// The fallback keys off json_type rather than COALESCE so an explicit
// `null` in a record stays null instead of silently inheriting the page
// value — the Phase 0 null-handling invariant.
func (c *compiler) resolveFieldSQL(field string, useIndexer bool) (string, error) {
	if sql, isImplicit := c.resolveImplicit(field); isImplicit {
		return sql, nil
	}
	if sql, ok := c.flattenFieldSQL(field); ok {
		return sql, nil
	}
	if err := validateFieldPath(field); err != nil {
		return "", err
	}
	if c.rollupAlias != "" {
		return fmt.Sprintf("json_extract(%s, '$.%s')", c.jsonBase(), field), nil
	}
	if c.records() {
		if sub, ok := strings.CutPrefix(field, "record."); ok {
			if err := validateFieldPath(sub); err != nil {
				return "", err
			}
			return fmt.Sprintf("json_extract(%s.json, '$.%s')", c.recordTable(), sub), nil
		}
		if sub, ok := strings.CutPrefix(field, "page."); ok {
			if err := validateFieldPath(sub); err != nil {
				return "", err
			}
			return fmt.Sprintf("json_extract(file_meta.frontmatter, '$.%s')", sub), nil
		}
		return fmt.Sprintf(
			"CASE WHEN json_type(%[2]s.json, '$.%[1]s') IS NOT NULL"+
				" THEN json_extract(%[2]s.json, '$.%[1]s')"+
				" ELSE json_extract(file_meta.frontmatter, '$.%[1]s') END", field, c.recordTable()), nil
	}
	if useIndexer && c.indexer != nil {
		if col, ok := c.indexer.IndexedColumn(field); ok {
			return col, nil
		}
	}
	return fmt.Sprintf("json_extract(file_meta.frontmatter, '$.%s')", field), nil
}

// resolveImplicit resolves _-prefixed metadata fields for the current grain.
func (c *compiler) resolveImplicit(field string) (string, bool) {
	if c.rollupAlias != "" {
		// The rollup target is a plain file_meta row, so every implicit
		// field transfers by rebasing the table name.
		sql, ok := resolveField(field)
		if !ok {
			return "", false
		}
		return strings.ReplaceAll(sql, "file_meta.", c.rollupAlias+"."), true
	}
	if c.records() {
		if mf, ok := recordImplicitFieldsFor(c.recordTable())[field]; ok {
			return mf.SQL, true
		}
	}
	return resolveField(field)
}

func (c *compiler) aliasFor(fs FieldSpec) string {
	if fs.Alias != "" {
		safe := strings.NewReplacer(" ", "_", ".", "_", "-", "_").Replace(fs.Alias)
		if safe == "" {
			safe = "col"
		}
		return safe
	}
	safe := strings.NewReplacer(".", "_", "-", "_", "[", "", "]", "", "*", "").Replace(fs.Expr)
	if safe == "" {
		safe = "col"
	}
	return safe
}

func (c *compiler) compileExpr(expr Expr) (string, []any, error) {
	switch e := expr.(type) {
	case *BinaryExpr:
		return c.compileBinary(e)
	case *UnaryExpr:
		return c.compileUnary(e)
	case *FieldRef:
		return c.compileFieldRef(e)
	case *Literal:
		return c.compileLiteral(e)
	case *FuncCall:
		return c.compileFuncCall(e)
	case *ListExpr:
		return c.compileList(e)
	case *BetweenExpr:
		return c.compileBetween(e)
	case *IsNullExpr:
		return c.compileIsNull(e)
	default:
		return "", nil, fmt.Errorf("unknown expression type %T", expr)
	}
}

var binaryOpFmt = map[Operator]string{
	OpAnd:     "(%s AND %s)",
	OpOr:      "(%s OR %s)",
	OpIn:      "%s IN %s",
	OpNotIn:   "%s NOT IN %s",
	OpLike:    "%s LIKE %s",
	OpNotLike: "%s NOT LIKE %s",
}

func (c *compiler) compileBinary(e *BinaryExpr) (string, []any, error) {
	left, lp, err := c.compileExpr(e.Left)
	if err != nil {
		return "", nil, err
	}
	right, rp, err := c.compileExpr(e.Right)
	if err != nil {
		return "", nil, err
	}
	if tmpl, ok := binaryOpFmt[e.Op]; ok {
		return fmt.Sprintf(tmpl, left, right), append(lp, rp...), nil
	}
	return fmt.Sprintf("%s %s %s", left, e.Op.String(), right), append(lp, rp...), nil
}

func (c *compiler) compileUnary(e *UnaryExpr) (string, []any, error) {
	inner, params, err := c.compileExpr(e.Expr)
	if err != nil {
		return "", nil, err
	}
	return fmt.Sprintf("NOT (%s)", inner), params, nil
}

func (c *compiler) compileFieldRef(e *FieldRef) (string, []any, error) {
	// Expressions deliberately skip the generated-column lookup: the
	// indexer only covers plain SELECT/SORT field references.
	sql, err := c.resolveFieldSQL(e.Path, false)
	if err != nil {
		return "", nil, err
	}
	return sql, nil, nil
}

func (c *compiler) compileLiteral(e *Literal) (string, []any, error) {
	if e.Value == nil {
		return "NULL", nil, nil
	}
	return "?", []any{e.Value}, nil
}

func (c *compiler) compileFuncCall(e *FuncCall) (string, []any, error) {
	fn, ok := funcRegistry[strings.ToLower(e.Name)]
	if !ok {
		return "", nil, fmt.Errorf("unknown function %q", e.Name)
	}

	nameLower := strings.ToLower(e.Name)
	if nameLower == "rollup" {
		cArgs, err := c.compileRollupArgs(e)
		if err != nil {
			return "", nil, err
		}
		return fn(cArgs)
	}

	cArgs := make([]compiledArg, len(e.Args))
	for i, arg := range e.Args {
		if (nameLower == "contains" || nameLower == "length") && i == 0 {
			if fr, ok := arg.(*FieldRef); ok {
				if err := validateFieldPath(fr.Path); err != nil {
					return "", nil, err
				}
				cArgs[i] = compiledArg{SQL: fmt.Sprintf("'$.%s'", fr.Path)}
				continue
			}
		}

		sql, params, err := c.compileExpr(arg)
		if err != nil {
			return "", nil, err
		}
		cArgs[i] = compiledArg{SQL: sql, Params: params}
	}

	return fn(cArgs)
}

// compileRollupArgs prepares rollup()'s two arguments, neither of which
// compiles like an ordinary value expression:
//
//	arg 0 — a link field name. `rollup(related-notes, ...)` collects
//	        over the typed frontmatter field of that name; the reserved names
//	        `links` and `outlinks` collect over every outbound link
//	        regardless of relation.
//	arg 1 — an expression evaluated against the *linked-to* page, so its
//	        field references resolve to the target's frontmatter, not the
//	        row the query is currently on.
//
// A typed frontmatter field is only indexed as a link when it is listed in
// [links] typed_fields; body wiki links are always available via `links`.
func (c *compiler) compileRollupArgs(e *FuncCall) ([]compiledArg, error) {
	if len(e.Args) != 2 {
		return nil, fmt.Errorf("rollup() requires 2 arguments (link field, expression on the linked page)")
	}
	fr, ok := e.Args[0].(*FieldRef)
	if !ok {
		return nil, fmt.Errorf("rollup(): the first argument must be a link field name")
	}
	if err := validateFieldPath(fr.Path); err != nil {
		return nil, fmt.Errorf("rollup(): %w", err)
	}

	var relation compiledArg
	switch strings.ToLower(fr.Path) {
	case "links", "outlinks":
		relation = compiledArg{SQL: "1=1"}
	default:
		relation = compiledArg{
			SQL:    rollupLinkAlias + ".relation = ?",
			Params: []any{fr.Path},
		}
	}

	// The target expression compiles against a fresh compiler bound to the
	// linked page's alias. The auto-indexer is deliberately not passed
	// through: its generated columns live on the outer file_meta.
	sub := &compiler{plan: c.plan, rollupAlias: rollupTargetAlias}
	sql, params, err := sub.compileExpr(e.Args[1])
	if err != nil {
		return nil, fmt.Errorf("rollup(): %w", err)
	}

	return []compiledArg{relation, {SQL: sql, Params: params}}, nil
}

func (c *compiler) compileList(e *ListExpr) (string, []any, error) {
	if len(e.Items) == 0 {
		return "1=0", nil, nil
	}
	parts := make([]string, len(e.Items))
	var allParams []any
	for i, item := range e.Items {
		sql, params, err := c.compileExpr(item)
		if err != nil {
			return "", nil, err
		}
		parts[i] = sql
		allParams = append(allParams, params...)
	}
	return fmt.Sprintf("(%s)", strings.Join(parts, ", ")), allParams, nil
}

func (c *compiler) compileBetween(e *BetweenExpr) (string, []any, error) {
	expr, ep, err := c.compileExpr(e.Expr)
	if err != nil {
		return "", nil, err
	}
	low, lp, err := c.compileExpr(e.Low)
	if err != nil {
		return "", nil, err
	}
	high, hp, err := c.compileExpr(e.High)
	if err != nil {
		return "", nil, err
	}
	var params []any
	params = append(params, ep...)
	params = append(params, lp...)
	params = append(params, hp...)
	return fmt.Sprintf("%s BETWEEN %s AND %s", expr, low, high), params, nil
}

func (c *compiler) compileIsNull(e *IsNullExpr) (string, []any, error) {
	expr, params, err := c.compileExpr(e.Expr)
	if err != nil {
		return "", nil, err
	}
	op := "IS NULL"
	if e.Negate {
		op = "IS NOT NULL"
	}
	return fmt.Sprintf("%s %s", expr, op), params, nil
}

// ValidFieldName reports whether s is a safe field name for use in DQL.
func ValidFieldName(s string) bool {
	return s != "" && validFieldRe.MatchString(s)
}

func validateFieldPath(field string) error {
	if field == "" {
		return fmt.Errorf("empty field path")
	}
	if !validFieldRe.MatchString(field) {
		return fmt.Errorf("invalid field path %q", field)
	}
	return nil
}
