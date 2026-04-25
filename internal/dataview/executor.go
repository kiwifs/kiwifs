package dataview

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"time"
)

// Executor runs DQL queries against a SQLite database.
type Executor struct {
	db           *sql.DB
	indexer      *AutoIndexer
	maxScanRows  int
	queryTimeout time.Duration
}

// NewExecutor creates an executor using the given read-only database connection.
func NewExecutor(db *sql.DB) *Executor {
	return &Executor{db: db}
}

// SetAutoIndexer enables auto-indexing for frequently queried fields.
func (e *Executor) SetAutoIndexer(ai *AutoIndexer) {
	e.indexer = ai
}

// SetLimits configures resource limits for query execution.
func (e *Executor) SetLimits(maxRows int, timeout time.Duration) {
	e.maxScanRows = maxRows
	e.queryTimeout = timeout
}

// Query parses DQL, compiles to SQL, executes, and returns a QueryResult.
func (e *Executor) Query(ctx context.Context, dql string, limitOverride, offsetOverride int) (*QueryResult, error) {
	plan, err := ParseQuery(dql)
	if err != nil {
		return nil, fmt.Errorf("parse: %w", err)
	}
	if limitOverride > 0 {
		plan.Limit = limitOverride
		if plan.Limit > maxLimit {
			plan.Limit = maxLimit
		}
	}
	if offsetOverride > 0 {
		plan.Offset = offsetOverride
	}
	result, err := e.Execute(ctx, plan)
	if err == nil && e.indexer != nil {
		for _, field := range CollectFields(plan) {
			e.indexer.EnsureIndex(ctx, field)
		}
	}
	return result, err
}

// Execute runs a pre-parsed QueryPlan and returns results.
func (e *Executor) Execute(ctx context.Context, plan *QueryPlan) (*QueryResult, error) {
	if e.maxScanRows > 0 && (plan.Limit == 0 || plan.Limit > e.maxScanRows) {
		plan = &QueryPlan{
			Type: plan.Type, From: plan.From, FromTags: plan.FromTags,
			Fields: plan.Fields, WithoutID: plan.WithoutID,
			Where: plan.Where, Sort: plan.Sort, Order: plan.Order,
			Sorts: plan.Sorts, GroupBy: plan.GroupBy, Flatten: plan.Flatten,
			Limit: e.maxScanRows, Offset: plan.Offset,
		}
	}
	if e.queryTimeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, e.queryTimeout)
		defer cancel()
	}

	start := time.Now()
	var sqlStr string
	var args []any
	var err error
	if e.indexer != nil {
		sqlStr, args, err = CompileSQLWithIndexer(plan, e.indexer)
	} else {
		sqlStr, args, err = CompileSQL(plan)
	}
	if err != nil {
		return nil, fmt.Errorf("compile: %w", err)
	}

	var result *QueryResult
	switch plan.Type {
	case "count":
		result, err = e.execCount(ctx, sqlStr, args)
	case "distinct":
		result, err = e.execDistinct(ctx, sqlStr, args, plan)
	case "task":
		result, err = e.execTask(ctx, sqlStr, args, plan)
	case "table", "list", "json", "calendar", "":
		if plan.GroupBy != "" {
			result, err = e.execGroupBy(ctx, sqlStr, args, plan)
		} else {
			result, err = e.execSelect(ctx, sqlStr, args, plan)
		}
	default:
		return nil, fmt.Errorf("unknown query type %q", plan.Type)
	}

	if elapsed := time.Since(start); elapsed > time.Second {
		log.Printf("dataview: slow query (%s): %s", elapsed, sqlStr)
	}
	return result, err
}

func (e *Executor) execCount(ctx context.Context, sqlStr string, args []any) (*QueryResult, error) {
	var cnt int
	if err := e.db.QueryRowContext(ctx, sqlStr, args...).Scan(&cnt); err != nil {
		return nil, fmt.Errorf("count: %w", err)
	}
	return &QueryResult{
		Columns: []string{"count"},
		Rows:    []map[string]any{{"cnt": int64(cnt)}},
		Total:   cnt,
	}, nil
}

func (e *Executor) execDistinct(ctx context.Context, sqlStr string, args []any, plan *QueryPlan) (*QueryResult, error) {
	rows, err := e.db.QueryContext(ctx, sqlStr, args...)
	if err != nil {
		return nil, fmt.Errorf("distinct: %w", err)
	}
	defer rows.Close()

	field := ""
	if len(plan.Fields) > 0 {
		field = plan.Fields[0].Expr
	}
	result := &QueryResult{
		Columns: []string{field},
	}
	for rows.Next() {
		var val any
		if err := rows.Scan(&val); err != nil {
			return nil, err
		}
		result.Rows = append(result.Rows, map[string]any{field: val})
	}
	result.Total = len(result.Rows)
	return result, rows.Err()
}

func (e *Executor) execGroupBy(ctx context.Context, sqlStr string, args []any, plan *QueryPlan) (*QueryResult, error) {
	rows, err := e.db.QueryContext(ctx, sqlStr, args...)
	if err != nil {
		return nil, fmt.Errorf("group by: %w", err)
	}
	defer rows.Close()

	fieldNames := plan.FieldNames()
	displayNames := make([]string, len(plan.Fields))
	for i, fs := range plan.Fields {
		if fs.Alias != "" {
			displayNames[i] = fs.Alias
		} else {
			displayNames[i] = fs.Expr
		}
	}

	cols := append([]string{plan.GroupBy}, displayNames...)
	if !plan.WithoutID {
		cols = append([]string{plan.GroupBy, "_path"}, displayNames...)
	}

	groups := make(map[string]*GroupResult)
	var groupOrder []string

	for rows.Next() {
		var grp any
		fieldVals := make([]any, len(fieldNames))
		fieldPtrs := make([]any, len(fieldNames))
		for i := range fieldVals {
			fieldPtrs[i] = &fieldVals[i]
		}
		var path string
		var fmRaw string

		scanDest := make([]any, 0, 3+len(fieldNames))
		scanDest = append(scanDest, &grp)
		scanDest = append(scanDest, fieldPtrs...)
		scanDest = append(scanDest, &path, &fmRaw)

		if err := rows.Scan(scanDest...); err != nil {
			return nil, err
		}

		grpStr := fmt.Sprintf("%v", grp)
		if grp == nil {
			grpStr = ""
		}

		g, exists := groups[grpStr]
		if !exists {
			g = &GroupResult{Key: grpStr}
			groups[grpStr] = g
			groupOrder = append(groupOrder, grpStr)
		}
		g.Count++

		row := make(map[string]any)
		if !plan.WithoutID {
			row["_path"] = path
			row["path"] = path
		}
		for i, fs := range plan.Fields {
			val := fieldVals[i]
			if b, ok := val.([]byte); ok {
				val = string(b)
			}
			name := fs.Expr
			if fs.Alias != "" {
				name = fs.Alias
			}
			row[name] = val
		}
		g.Rows = append(g.Rows, row)
	}

	result := &QueryResult{Columns: cols}
	for _, key := range groupOrder {
		g := groups[key]
		result.Groups = append(result.Groups, *g)
		for _, r := range g.Rows {
			rowWithGroup := make(map[string]any)
			for k, v := range r {
				rowWithGroup[k] = v
			}
			rowWithGroup[plan.GroupBy] = g.Key
			rowWithGroup["count"] = int64(g.Count)
			result.Rows = append(result.Rows, rowWithGroup)
		}
	}
	result.Total = len(result.Groups)
	return result, rows.Err()
}

// taskRow is used to parse the JSON tasks column from file_meta.
type taskRow struct {
	Text      string         `json:"text"`
	Completed bool           `json:"completed"`
	Line      int            `json:"line"`
	Tags      []string       `json:"tags,omitempty"`
	Due       string         `json:"due,omitempty"`
	Meta      map[string]any `json:"meta,omitempty"`
}

func (e *Executor) execTask(ctx context.Context, sqlStr string, args []any, plan *QueryPlan) (*QueryResult, error) {
	rows, err := e.db.QueryContext(ctx, sqlStr, args...)
	if err != nil {
		return nil, fmt.Errorf("task query: %w", err)
	}
	defer rows.Close()

	cols := []string{"_path", "text", "completed", "line", "tags", "due"}
	result := &QueryResult{Columns: cols}

	for rows.Next() {
		var path string
		var tasksJSON string
		if err := rows.Scan(&path, &tasksJSON); err != nil {
			return nil, err
		}

		var fileTasks []taskRow
		if err := json.Unmarshal([]byte(tasksJSON), &fileTasks); err != nil {
			continue
		}

		for _, t := range fileTasks {
			// Apply WHERE filter on task-level fields if present
			if plan.Where != nil && !matchTaskWhere(plan.Where, t) {
				continue
			}

			row := map[string]any{
				"_path":     path,
				"path":      path,
				"text":      t.Text,
				"completed": t.Completed,
				"line":      int64(t.Line),
				"due":       t.Due,
			}
			if len(t.Tags) > 0 {
				row["tags"] = t.Tags
			}
			result.Rows = append(result.Rows, row)
		}
	}

	result.Total = len(result.Rows)
	return result, rows.Err()
}

// matchTaskWhere evaluates a WHERE expression against task-level fields.
func matchTaskWhere(expr Expr, t taskRow) bool {
	switch e := expr.(type) {
	case *BinaryExpr:
		switch e.Op {
		case OpAnd:
			return matchTaskWhere(e.Left, t) && matchTaskWhere(e.Right, t)
		case OpOr:
			return matchTaskWhere(e.Left, t) || matchTaskWhere(e.Right, t)
		case OpEq:
			left := evalTaskField(e.Left, t)
			right := evalTaskField(e.Right, t)
			return fmt.Sprintf("%v", left) == fmt.Sprintf("%v", right)
		case OpNeq:
			left := evalTaskField(e.Left, t)
			right := evalTaskField(e.Right, t)
			return fmt.Sprintf("%v", left) != fmt.Sprintf("%v", right)
		}
	case *UnaryExpr:
		if e.Op == OpNot {
			return !matchTaskWhere(e.Expr, t)
		}
	}
	return true
}

func evalTaskField(expr Expr, t taskRow) any {
	switch e := expr.(type) {
	case *FieldRef:
		switch e.Path {
		case "completed":
			return t.Completed
		case "text":
			return t.Text
		case "due":
			return t.Due
		case "line":
			return int64(t.Line)
		}
		return nil
	case *Literal:
		return e.Value
	}
	return nil
}

func (e *Executor) execSelect(ctx context.Context, sqlStr string, args []any, plan *QueryPlan) (*QueryResult, error) {
	rows, err := e.db.QueryContext(ctx, sqlStr, args...)
	if err != nil {
		return nil, fmt.Errorf("select: %w", err)
	}
	defer rows.Close()

	displayNames := make([]string, len(plan.Fields))
	for i, fs := range plan.Fields {
		if fs.Alias != "" {
			displayNames[i] = fs.Alias
		} else {
			displayNames[i] = fs.Expr
		}
	}

	var cols []string
	if !plan.WithoutID {
		cols = append(cols, "_path")
	}
	cols = append(cols, displayNames...)

	result := &QueryResult{Columns: cols}

	var fetched int
	for rows.Next() {
		fetched++
		if fetched > plan.Limit {
			result.HasMore = true
			continue
		}

		fieldVals := make([]any, len(plan.Fields))
		fieldPtrs := make([]any, len(plan.Fields))
		for i := range fieldVals {
			fieldPtrs[i] = &fieldVals[i]
		}
		var fmRaw string

		var scanDest []any
		if plan.WithoutID {
			scanDest = append(scanDest, fieldPtrs...)
			scanDest = append(scanDest, &fmRaw)
		} else {
			var path string
			scanDest = append(scanDest, &path)
			scanDest = append(scanDest, fieldPtrs...)
			scanDest = append(scanDest, &fmRaw)

			if err := rows.Scan(scanDest...); err != nil {
				return nil, err
			}

			var fm map[string]any
			if fmRaw != "" {
				_ = json.Unmarshal([]byte(fmRaw), &fm)
			}

			row := map[string]any{
				"_path": path,
				"path":  path,
			}
			for i, fs := range plan.Fields {
				val := fieldVals[i]
				if b, ok := val.([]byte); ok {
					val = string(b)
				}
				name := fs.Expr
				if fs.Alias != "" {
					name = fs.Alias
				}
				row[name] = val
			}
			result.Rows = append(result.Rows, row)
			continue
		}

		if err := rows.Scan(scanDest...); err != nil {
			return nil, err
		}

		var fm map[string]any
		if fmRaw != "" {
			_ = json.Unmarshal([]byte(fmRaw), &fm)
		}

		row := make(map[string]any)
		for i, fs := range plan.Fields {
			val := fieldVals[i]
			if b, ok := val.([]byte); ok {
				val = string(b)
			}
			name := fs.Expr
			if fs.Alias != "" {
				name = fs.Alias
			}
			row[name] = val
		}
		result.Rows = append(result.Rows, row)
	}

	result.Total = len(result.Rows)
	if result.HasMore {
		result.Total = -1
	}

	return result, rows.Err()
}
