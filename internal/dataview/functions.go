package dataview

import "fmt"

// FuncCompiler emits SQL + bound args for a built-in function call.
// The `args` parameter contains already-compiled SQL fragments for each
// argument (field references are already wrapped in json_extract).
type FuncCompiler func(args []compiledArg) (sql string, params []any, err error)

// compiledArg is the SQL fragment + bound params for one function argument.
type compiledArg struct {
	SQL    string
	Params []any
}

var funcRegistry = map[string]FuncCompiler{
	// Existing
	"contains":   compileContains,
	"startswith": compileStartsWith,
	"endswith":   compileEndsWith,
	"matches":    compileMatches,
	"length":     compileLength,
	"lower":      compileLower,
	"upper":      compileUpper,
	"default":    compileDefault,
	"date":       compileDate,
	"now":        compileNow,
	"days_since": compileDaysSince,

	// Conditional/utility
	"choice": compileChoice,
	"typeof": compileTypeof,
	"number": compileNumber,
	"string": compileString,

	// String functions
	"replace":      compileReplace,
	"substring":    compileSubstring,
	"join":         compileJoin,
	"regextest":    compileRegexTest,
	"regexreplace": compileRegexReplace,

	// Aggregation
	"sum":     compileSum,
	"average": compileAverage,
	"min":     compileMin,
	"max":     compileMax,

	// List/array
	"nonnull": compileNonNull,

	// Date/duration
	"dateformat": compileDateFormat,
	"striptime":  compileStripTime,
	"round":      compileRound,
}

func compileContains(args []compiledArg) (string, []any, error) {
	if len(args) != 2 {
		return "", nil, fmt.Errorf("contains() requires 2 arguments")
	}
	field := args[0]
	value := args[1]
	sql := fmt.Sprintf("EXISTS (SELECT 1 FROM json_each(file_meta.frontmatter, %s) AS _je WHERE _je.value = %s)",
		field.SQL, value.SQL)
	var params []any
	params = append(params, field.Params...)
	params = append(params, value.Params...)
	return sql, params, nil
}

func compileStartsWith(args []compiledArg) (string, []any, error) {
	if len(args) != 2 {
		return "", nil, fmt.Errorf("startsWith() requires 2 arguments")
	}
	sql := fmt.Sprintf("(%s LIKE %s || '%%')", args[0].SQL, args[1].SQL)
	var params []any
	params = append(params, args[0].Params...)
	params = append(params, args[1].Params...)
	return sql, params, nil
}

func compileEndsWith(args []compiledArg) (string, []any, error) {
	if len(args) != 2 {
		return "", nil, fmt.Errorf("endsWith() requires 2 arguments")
	}
	sql := fmt.Sprintf("(%s LIKE '%%' || %s)", args[0].SQL, args[1].SQL)
	var params []any
	params = append(params, args[0].Params...)
	params = append(params, args[1].Params...)
	return sql, params, nil
}

func compileMatches(args []compiledArg) (string, []any, error) {
	if len(args) != 2 {
		return "", nil, fmt.Errorf("matches() requires 2 arguments")
	}
	sql := fmt.Sprintf("(%s LIKE %s)", args[0].SQL, args[1].SQL)
	var params []any
	params = append(params, args[0].Params...)
	params = append(params, args[1].Params...)
	return sql, params, nil
}

func compileLength(args []compiledArg) (string, []any, error) {
	if len(args) != 1 {
		return "", nil, fmt.Errorf("length() requires 1 argument")
	}
	sql := fmt.Sprintf(
		"CASE json_type(file_meta.frontmatter, %s) WHEN 'array' THEN json_array_length(file_meta.frontmatter, %s) ELSE length(%s) END",
		args[0].SQL, args[0].SQL, args[0].SQL)
	var params []any
	params = append(params, args[0].Params...)
	params = append(params, args[0].Params...)
	params = append(params, args[0].Params...)
	return sql, params, nil
}

func compileLower(args []compiledArg) (string, []any, error) {
	if len(args) != 1 {
		return "", nil, fmt.Errorf("lower() requires 1 argument")
	}
	return fmt.Sprintf("lower(%s)", args[0].SQL), args[0].Params, nil
}

func compileUpper(args []compiledArg) (string, []any, error) {
	if len(args) != 1 {
		return "", nil, fmt.Errorf("upper() requires 1 argument")
	}
	return fmt.Sprintf("upper(%s)", args[0].SQL), args[0].Params, nil
}

func compileDefault(args []compiledArg) (string, []any, error) {
	if len(args) != 2 {
		return "", nil, fmt.Errorf("default() requires 2 arguments")
	}
	sql := fmt.Sprintf("COALESCE(%s, %s)", args[0].SQL, args[1].SQL)
	var params []any
	params = append(params, args[0].Params...)
	params = append(params, args[1].Params...)
	return sql, params, nil
}

func compileDate(args []compiledArg) (string, []any, error) {
	if len(args) != 1 {
		return "", nil, fmt.Errorf("date() requires 1 argument")
	}
	return fmt.Sprintf("date(%s)", args[0].SQL), args[0].Params, nil
}

func compileNow(args []compiledArg) (string, []any, error) {
	if len(args) != 0 {
		return "", nil, fmt.Errorf("now() takes no arguments")
	}
	return "datetime('now')", nil, nil
}

func compileDaysSince(args []compiledArg) (string, []any, error) {
	if len(args) != 1 {
		return "", nil, fmt.Errorf("days_since() requires 1 argument")
	}
	sql := fmt.Sprintf("(julianday('now') - julianday(%s))", args[0].SQL)
	return sql, args[0].Params, nil
}

// --- Conditional/utility functions ---

func compileChoice(args []compiledArg) (string, []any, error) {
	if len(args) != 3 {
		return "", nil, fmt.Errorf("choice() requires 3 arguments (condition, ifTrue, ifFalse)")
	}
	sql := fmt.Sprintf("CASE WHEN %s THEN %s ELSE %s END", args[0].SQL, args[1].SQL, args[2].SQL)
	var params []any
	params = append(params, args[0].Params...)
	params = append(params, args[1].Params...)
	params = append(params, args[2].Params...)
	return sql, params, nil
}

func compileTypeof(args []compiledArg) (string, []any, error) {
	if len(args) != 1 {
		return "", nil, fmt.Errorf("typeof() requires 1 argument")
	}
	return fmt.Sprintf("typeof(%s)", args[0].SQL), args[0].Params, nil
}

func compileNumber(args []compiledArg) (string, []any, error) {
	if len(args) != 1 {
		return "", nil, fmt.Errorf("number() requires 1 argument")
	}
	return fmt.Sprintf("CAST(%s AS REAL)", args[0].SQL), args[0].Params, nil
}

func compileString(args []compiledArg) (string, []any, error) {
	if len(args) != 1 {
		return "", nil, fmt.Errorf("string() requires 1 argument")
	}
	return fmt.Sprintf("CAST(%s AS TEXT)", args[0].SQL), args[0].Params, nil
}

// --- String functions ---

func compileReplace(args []compiledArg) (string, []any, error) {
	if len(args) != 3 {
		return "", nil, fmt.Errorf("replace() requires 3 arguments (str, old, new)")
	}
	sql := fmt.Sprintf("REPLACE(%s, %s, %s)", args[0].SQL, args[1].SQL, args[2].SQL)
	var params []any
	params = append(params, args[0].Params...)
	params = append(params, args[1].Params...)
	params = append(params, args[2].Params...)
	return sql, params, nil
}

func compileSubstring(args []compiledArg) (string, []any, error) {
	if len(args) < 2 || len(args) > 3 {
		return "", nil, fmt.Errorf("substring() requires 2 or 3 arguments (str, start[, len])")
	}
	var params []any
	params = append(params, args[0].Params...)
	params = append(params, args[1].Params...)
	if len(args) == 3 {
		params = append(params, args[2].Params...)
		return fmt.Sprintf("SUBSTR(%s, %s, %s)", args[0].SQL, args[1].SQL, args[2].SQL), params, nil
	}
	return fmt.Sprintf("SUBSTR(%s, %s)", args[0].SQL, args[1].SQL), params, nil
}

func compileJoin(args []compiledArg) (string, []any, error) {
	if len(args) != 2 {
		return "", nil, fmt.Errorf("join() requires 2 arguments (list, separator)")
	}
	sql := fmt.Sprintf("GROUP_CONCAT(%s, %s)", args[0].SQL, args[1].SQL)
	var params []any
	params = append(params, args[0].Params...)
	params = append(params, args[1].Params...)
	return sql, params, nil
}

func compileRegexTest(args []compiledArg) (string, []any, error) {
	if len(args) != 2 {
		return "", nil, fmt.Errorf("regextest() requires 2 arguments (pattern, str)")
	}
	sql := fmt.Sprintf("(%s REGEXP %s)", args[1].SQL, args[0].SQL)
	var params []any
	params = append(params, args[1].Params...)
	params = append(params, args[0].Params...)
	return sql, params, nil
}

func compileRegexReplace(args []compiledArg) (string, []any, error) {
	if len(args) != 3 {
		return "", nil, fmt.Errorf("regexreplace() requires 3 arguments (str, pattern, replacement)")
	}
	sql := fmt.Sprintf("regex_replace(%s, %s, %s)", args[0].SQL, args[1].SQL, args[2].SQL)
	var params []any
	params = append(params, args[0].Params...)
	params = append(params, args[1].Params...)
	params = append(params, args[2].Params...)
	return sql, params, nil
}

// --- Aggregation functions ---

func compileSum(args []compiledArg) (string, []any, error) {
	if len(args) != 1 {
		return "", nil, fmt.Errorf("sum() requires 1 argument")
	}
	return fmt.Sprintf("SUM(%s)", args[0].SQL), args[0].Params, nil
}

func compileAverage(args []compiledArg) (string, []any, error) {
	if len(args) != 1 {
		return "", nil, fmt.Errorf("average() requires 1 argument")
	}
	return fmt.Sprintf("AVG(%s)", args[0].SQL), args[0].Params, nil
}

func compileMin(args []compiledArg) (string, []any, error) {
	if len(args) != 1 {
		return "", nil, fmt.Errorf("min() requires 1 argument")
	}
	return fmt.Sprintf("MIN(%s)", args[0].SQL), args[0].Params, nil
}

func compileMax(args []compiledArg) (string, []any, error) {
	if len(args) != 1 {
		return "", nil, fmt.Errorf("max() requires 1 argument")
	}
	return fmt.Sprintf("MAX(%s)", args[0].SQL), args[0].Params, nil
}

// --- List/array functions ---

func compileNonNull(args []compiledArg) (string, []any, error) {
	if len(args) != 1 {
		return "", nil, fmt.Errorf("nonnull() requires 1 argument")
	}
	return fmt.Sprintf("%s IS NOT NULL", args[0].SQL), args[0].Params, nil
}

// --- Date/duration functions ---

func compileDateFormat(args []compiledArg) (string, []any, error) {
	if len(args) != 2 {
		return "", nil, fmt.Errorf("dateformat() requires 2 arguments (date, format)")
	}
	sql := fmt.Sprintf("strftime(%s, %s)", args[1].SQL, args[0].SQL)
	var params []any
	params = append(params, args[1].Params...)
	params = append(params, args[0].Params...)
	return sql, params, nil
}

func compileStripTime(args []compiledArg) (string, []any, error) {
	if len(args) != 1 {
		return "", nil, fmt.Errorf("striptime() requires 1 argument")
	}
	return fmt.Sprintf("date(%s)", args[0].SQL), args[0].Params, nil
}

func compileRound(args []compiledArg) (string, []any, error) {
	if len(args) < 1 || len(args) > 2 {
		return "", nil, fmt.Errorf("round() requires 1 or 2 arguments (num[, digits])")
	}
	var params []any
	params = append(params, args[0].Params...)
	if len(args) == 2 {
		params = append(params, args[1].Params...)
		return fmt.Sprintf("ROUND(%s, %s)", args[0].SQL, args[1].SQL), params, nil
	}
	return fmt.Sprintf("ROUND(%s)", args[0].SQL), params, nil
}
