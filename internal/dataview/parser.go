package dataview

import (
	"fmt"
	"strconv"
	"strings"
)

const (
	defaultLimit = 50
	maxLimit     = 200
)

// ParseQuery parses a DQL statement into a QueryPlan.
//
// Grammar:
//
//	TABLE [WITHOUT ID] field1 [AS alias], field2, ...
//	LIST [WITHOUT ID]
//	COUNT
//	DISTINCT field
//	CALENDAR date_field
//	FROM "folder/" | FROM #tag [OR #tag2] [AND -#tag3]
//	WHERE <expression>         ← can appear multiple times (AND-joined)
//	SORT field ASC|DESC        ← can appear multiple times
//	GROUP BY field
//	FLATTEN field
//	LIMIT n
//	OFFSET n
func ParseQuery(dql string) (*QueryPlan, error) {
	dql = strings.TrimSpace(dql)
	if dql == "" {
		return nil, fmt.Errorf("empty query")
	}

	if isLegacyFormat(dql) {
		return parseLegacy(dql)
	}

	plan := &QueryPlan{
		Limit: defaultLimit,
		Order: "asc",
	}

	remaining := dql
	var err error

	remaining, err = parseType(remaining, plan)
	if err != nil {
		return nil, err
	}

	for remaining != "" {
		remaining = strings.TrimSpace(remaining)
		if remaining == "" {
			break
		}
		upper := strings.ToUpper(firstWord(remaining))
		switch upper {
		case "FROM":
			remaining, err = parseFrom(remaining, plan)
		case "WHERE":
			remaining, err = parseWhere(remaining, plan)
		case "SORT":
			remaining, err = parseSort(remaining, plan)
		case "GROUP":
			remaining, err = parseGroupBy(remaining, plan)
		case "FLATTEN":
			remaining, err = parseFlatten(remaining, plan)
		case "LIMIT":
			remaining, err = parseLimitClause(remaining, plan)
		case "OFFSET":
			remaining, err = parseOffset(remaining, plan)
		default:
			return nil, fmt.Errorf("unexpected keyword %q", firstWord(remaining))
		}
		if err != nil {
			return nil, err
		}
	}

	if plan.Limit > maxLimit {
		plan.Limit = maxLimit
	}

	return plan, nil
}

func parseType(s string, plan *QueryPlan) (string, error) {
	word := strings.ToUpper(firstWord(s))
	rest := strings.TrimSpace(s[len(firstWord(s)):])

	switch word {
	case "TABLE":
		plan.Type = "table"
		rest = parseWithoutID(rest, plan)
		return parseFieldList(rest, plan)
	case "LIST":
		plan.Type = "list"
		rest = parseWithoutID(rest, plan)
		if rest != "" && !isClauseKeyword(firstWord(rest)) {
			return parseFieldList(rest, plan)
		}
		return rest, nil
	case "COUNT":
		plan.Type = "count"
		return rest, nil
	case "DISTINCT":
		plan.Type = "distinct"
		if rest == "" || isClauseKeyword(firstWord(rest)) {
			return "", fmt.Errorf("DISTINCT requires a field name")
		}
		field, remaining, err := scanField(rest)
		if err != nil {
			return "", fmt.Errorf("DISTINCT field: %w", err)
		}
		if field == "" {
			return "", fmt.Errorf("DISTINCT requires a field name")
		}
		plan.Fields = []FieldSpec{{Expr: field}}
		return strings.TrimSpace(remaining), nil
	case "JSON":
		plan.Type = "json"
		return parseFieldList(rest, plan)
	case "CALENDAR":
		plan.Type = "calendar"
		if rest == "" || isClauseKeyword(firstWord(rest)) {
			return "", fmt.Errorf("CALENDAR requires a date field")
		}
		field, remaining, err := scanField(rest)
		if err != nil {
			return "", fmt.Errorf("CALENDAR field: %w", err)
		}
		if field == "" {
			return "", fmt.Errorf("CALENDAR requires a date field")
		}
		plan.Fields = []FieldSpec{{Expr: field}}
		return strings.TrimSpace(remaining), nil
	case "TASK":
		plan.Type = "task"
		return rest, nil
	default:
		return "", fmt.Errorf("expected TABLE, LIST, COUNT, DISTINCT, CALENDAR, TASK, or JSON — got %q", word)
	}
}

func parseWithoutID(s string, plan *QueryPlan) string {
	rest := strings.TrimSpace(s)
	if strings.ToUpper(firstWord(rest)) == "WITHOUT" {
		r2 := strings.TrimSpace(skipWord(rest))
		if strings.ToUpper(firstWord(r2)) == "ID" {
			plan.WithoutID = true
			return strings.TrimSpace(skipWord(r2))
		}
	}
	return rest
}

func parseFieldList(s string, plan *QueryPlan) (string, error) {
	var fields []FieldSpec
	rest := s
	for rest != "" {
		rest = strings.TrimSpace(rest)
		if rest == "" || isClauseKeyword(firstWord(rest)) {
			break
		}

		// Backtick fields: use scanField for proper error handling
		if rest[0] == '`' {
			field, r, err := scanField(rest)
			if err != nil {
				return "", err
			}
			if field == "" {
				break
			}
			rest = strings.TrimSpace(r)
			var alias string
			if strings.ToUpper(firstWord(rest)) == "AS" {
				rest = strings.TrimSpace(skipWord(rest))
				alias, rest, err = scanAlias(rest)
				if err != nil {
					return "", err
				}
				rest = strings.TrimSpace(rest)
			}
			fields = append(fields, FieldSpec{Expr: field, Alias: alias})
			if strings.HasPrefix(rest, ",") {
				rest = strings.TrimSpace(rest[1:])
			}
			continue
		}

		exprText, remaining := scanColumnExpr(rest)
		if exprText == "" {
			break
		}
		rest = strings.TrimSpace(remaining)

		var alias string
		var err error
		if strings.ToUpper(firstWord(rest)) == "AS" {
			rest = strings.TrimSpace(skipWord(rest))
			alias, rest, err = scanAlias(rest)
			if err != nil {
				return "", err
			}
			rest = strings.TrimSpace(rest)
		}

		fs := FieldSpec{Expr: exprText, Alias: alias}

		// If the expression contains parens (function call) or operators,
		// parse it as a full expression AST
		if strings.ContainsAny(exprText, "()+*/-") {
			parsed, parseErr := ParseExpr(exprText)
			if parseErr == nil {
				fs.Parsed = parsed
			}
		}

		fields = append(fields, fs)

		if strings.HasPrefix(rest, ",") {
			rest = strings.TrimSpace(rest[1:])
		}
	}
	plan.Fields = fields
	return rest, nil
}

// scanColumnExpr extracts a column expression, handling parenthesized sub-expressions.
// It stops at a comma, AS keyword, or clause keyword at depth 0.
func scanColumnExpr(s string) (string, string) {
	if len(s) > 0 && s[0] == '`' {
		end := strings.IndexByte(s[1:], '`')
		if end < 0 {
			return "", "" // unterminated backtick — let scanField produce the error
		}
		return s[1 : end+1], strings.TrimSpace(s[end+2:])
	}

	depth := 0
	i := 0
	for i < len(s) {
		ch := s[i]
		if ch == '(' {
			depth++
			i++
			continue
		}
		if ch == ')' {
			depth--
			i++
			continue
		}
		if depth > 0 {
			i++
			continue
		}
		if ch == ',' {
			return strings.TrimSpace(s[:i]), s[i:]
		}
		if ch == ' ' || ch == '\t' || ch == '\n' {
			word := strings.TrimSpace(s[:i])
			rest := strings.TrimSpace(s[i:])
			fw := strings.ToUpper(firstWord(rest))
			if fw == "AS" || isClauseKeyword(fw) {
				return word, rest
			}
			if rest != "" && rest[0] == ',' {
				return word, rest
			}
		}
		i++
	}
	return strings.TrimSpace(s), ""
}

func scanAlias(s string) (string, string, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", "", fmt.Errorf("expected alias after AS")
	}
	if s[0] == '"' || s[0] == '\'' {
		quote := s[0]
		end := strings.IndexByte(s[1:], quote)
		if end < 0 {
			return "", "", fmt.Errorf("unterminated string in alias")
		}
		return s[1 : end+1], strings.TrimSpace(s[end+2:]), nil
	}
	word := firstWord(s)
	if word == "" {
		return "", "", fmt.Errorf("expected alias after AS")
	}
	return word, strings.TrimSpace(s[len(word):]), nil
}

func scanField(s string) (string, string, error) {
	if len(s) > 0 && s[0] == '`' {
		end := strings.IndexByte(s[1:], '`')
		if end < 0 {
			return "", "", fmt.Errorf("unterminated backtick in field name")
		}
		field := s[1 : end+1]
		return field, strings.TrimSpace(s[end+2:]), nil
	}
	i := 0
	for i < len(s) {
		ch := s[i]
		if ch == ',' {
			return s[:i], s[i:], nil
		}
		if ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' {
			word := strings.TrimSpace(s[:i])
			rest := strings.TrimSpace(s[i:])
			if isClauseKeyword(firstWord(rest)) {
				return word, rest, nil
			}
			if strings.ToUpper(firstWord(rest)) == "AS" {
				return word, rest, nil
			}
			if rest != "" && rest[0] == ',' {
				return word, rest, nil
			}
			return word, rest, nil
		}
		i++
	}
	return s, "", nil
}

func parseFrom(s string, plan *QueryPlan) (string, error) {
	rest := skipWord(s) // skip "FROM"
	rest = strings.TrimSpace(rest)
	if rest == "" {
		return "", fmt.Errorf("FROM requires a folder path or #tag")
	}

	if rest[0] == '#' || (rest[0] == '-' && len(rest) > 1 && rest[1] == '#') {
		return parseFromTags(rest, plan)
	}

	if rest[0] == '"' || rest[0] == '\'' {
		quote := rest[0]
		end := strings.IndexByte(rest[1:], quote)
		if end < 0 {
			return "", fmt.Errorf("unterminated string in FROM clause")
		}
		plan.From = rest[1 : end+1]
		return strings.TrimSpace(rest[end+2:]), nil
	}
	word := firstWord(rest)
	plan.From = word
	return strings.TrimSpace(rest[len(word):]), nil
}

func parseFromTags(s string, plan *QueryPlan) (string, error) {
	rest := s
	for rest != "" {
		rest = strings.TrimSpace(rest)
		if rest == "" {
			break
		}

		negate := false
		if rest[0] == '-' && len(rest) > 1 && rest[1] == '#' {
			negate = true
			rest = rest[1:]
		}

		if rest[0] != '#' {
			upper := strings.ToUpper(firstWord(rest))
			if upper == "AND" || upper == "OR" {
				rest = strings.TrimSpace(skipWord(rest))
				continue
			}
			break
		}

		rest = rest[1:] // skip #
		tag := ""
		i := 0
		for i < len(rest) {
			ch := rest[i]
			if ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' || ch == ',' {
				break
			}
			i++
		}
		tag = rest[:i]
		rest = strings.TrimSpace(rest[i:])

		if tag == "" {
			return "", fmt.Errorf("empty tag in FROM clause")
		}
		plan.FromTags = append(plan.FromTags, TagFilter{Tag: tag, Negate: negate})
	}
	if len(plan.FromTags) == 0 {
		return "", fmt.Errorf("FROM requires at least one #tag")
	}
	return rest, nil
}

func parseWhere(s string, plan *QueryPlan) (string, error) {
	rest := skipWord(s) // skip "WHERE"
	rest = strings.TrimSpace(rest)
	if rest == "" {
		return "", fmt.Errorf("WHERE requires an expression")
	}

	whereText, remaining := splitAtClause(rest)
	whereText = strings.TrimSpace(whereText)
	if whereText == "" {
		return "", fmt.Errorf("WHERE requires an expression")
	}

	expr, err := ParseExpr(whereText)
	if err != nil {
		return "", fmt.Errorf("WHERE: %w", err)
	}

	if plan.Where != nil {
		plan.Where = &BinaryExpr{Left: plan.Where, Op: OpAnd, Right: expr}
	} else {
		plan.Where = expr
	}
	return remaining, nil
}

func parseSort(s string, plan *QueryPlan) (string, error) {
	rest := skipWord(s) // skip "SORT"
	rest = strings.TrimSpace(rest)
	if rest == "" {
		return "", fmt.Errorf("SORT requires a field name")
	}
	field := firstWord(rest)
	rest = strings.TrimSpace(rest[len(field):])

	order := "asc"
	if rest != "" {
		dir := strings.ToUpper(firstWord(rest))
		if dir == "ASC" || dir == "DESC" {
			order = strings.ToLower(dir)
			rest = strings.TrimSpace(rest[len(dir):])
		}
	}

	plan.Sorts = append(plan.Sorts, SortSpec{Field: field, Order: order})

	if plan.Sort == "" {
		plan.Sort = field
		plan.Order = order
	}

	return rest, nil
}

func parseGroupBy(s string, plan *QueryPlan) (string, error) {
	rest := skipWord(s) // skip "GROUP"
	rest = strings.TrimSpace(rest)
	if strings.ToUpper(firstWord(rest)) != "BY" {
		return "", fmt.Errorf("expected BY after GROUP")
	}
	rest = skipWord(rest)
	rest = strings.TrimSpace(rest)
	if rest == "" {
		return "", fmt.Errorf("GROUP BY requires a field name")
	}
	field := firstWord(rest)
	plan.GroupBy = field
	return strings.TrimSpace(rest[len(field):]), nil
}

func parseFlatten(s string, plan *QueryPlan) (string, error) {
	rest := skipWord(s) // skip "FLATTEN"
	rest = strings.TrimSpace(rest)
	if rest == "" {
		return "", fmt.Errorf("FLATTEN requires a field name")
	}
	field := firstWord(rest)
	plan.Flatten = field
	return strings.TrimSpace(rest[len(field):]), nil
}

func parseLimitClause(s string, plan *QueryPlan) (string, error) {
	rest := skipWord(s) // skip "LIMIT"
	rest = strings.TrimSpace(rest)
	word := firstWord(rest)
	n, err := strconv.Atoi(word)
	if err != nil {
		return "", fmt.Errorf("LIMIT: invalid number %q", word)
	}
	plan.Limit = n
	return strings.TrimSpace(rest[len(word):]), nil
}

func parseOffset(s string, plan *QueryPlan) (string, error) {
	rest := skipWord(s) // skip "OFFSET"
	rest = strings.TrimSpace(rest)
	word := firstWord(rest)
	n, err := strconv.Atoi(word)
	if err != nil {
		return "", fmt.Errorf("OFFSET: invalid number %q", word)
	}
	plan.Offset = n
	return strings.TrimSpace(rest[len(word):]), nil
}

// splitAtClause splits text at the first occurrence of a top-level clause
// keyword (SORT, GROUP, FLATTEN, LIMIT, OFFSET, WHERE). It respects quoted
// strings and parenthesised expressions so a keyword inside quotes or parens
// doesn't trigger a split.
func splitAtClause(s string) (string, string) {
	depth := 0
	inQuote := byte(0)
	i := 0
	for i < len(s) {
		ch := s[i]
		if inQuote != 0 {
			if ch == '\\' && i+1 < len(s) {
				i += 2
				continue
			}
			if ch == inQuote {
				inQuote = 0
			}
			i++
			continue
		}
		if ch == '"' || ch == '\'' {
			inQuote = ch
			i++
			continue
		}
		if ch == '(' {
			depth++
			i++
			continue
		}
		if ch == ')' {
			depth--
			i++
			continue
		}
		if depth == 0 && (ch == ' ' || ch == '\t' || ch == '\n') {
			rest := strings.TrimSpace(s[i:])
			word := strings.ToUpper(firstWord(rest))
			if word == "FROM" || word == "SORT" || word == "GROUP" || word == "FLATTEN" || word == "LIMIT" || word == "OFFSET" || word == "WHERE" {
				return s[:i], rest
			}
		}
		i++
	}
	return s, ""
}

func firstWord(s string) string {
	s = strings.TrimSpace(s)
	for i, ch := range s {
		if ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' {
			return s[:i]
		}
	}
	return s
}

func skipWord(s string) string {
	s = strings.TrimSpace(s)
	i := 0
	for i < len(s) && s[i] != ' ' && s[i] != '\t' && s[i] != '\n' && s[i] != '\r' {
		i++
	}
	return s[i:]
}

var clauseKeywords = map[string]bool{
	"FROM": true, "WHERE": true, "SORT": true, "GROUP": true,
	"FLATTEN": true, "LIMIT": true, "OFFSET": true,
}

func isClauseKeyword(word string) bool {
	return clauseKeywords[strings.ToUpper(word)]
}

func isLegacyFormat(s string) bool {
	lines := strings.Split(s, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "where:") || strings.HasPrefix(line, "sort:") ||
			strings.HasPrefix(line, "columns:") || strings.HasPrefix(line, "type:") {
			return true
		}
	}
	return false
}

func parseLegacy(s string) (*QueryPlan, error) {
	plan := &QueryPlan{
		Type:  "table",
		Limit: defaultLimit,
		Order: "asc",
	}
	lines := strings.Split(s, "\n")
	var whereExprs []string
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		key, val, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		val = strings.TrimSpace(val)
		switch key {
		case "type":
			plan.Type = val
		case "columns":
			for _, f := range strings.Split(val, ",") {
				f = strings.TrimSpace(f)
				if f != "" {
					plan.Fields = append(plan.Fields, FieldSpec{Expr: f})
				}
			}
		case "where":
			if val != "" {
				whereExprs = append(whereExprs, val)
			}
		case "sort":
			parts := strings.Fields(val)
			if len(parts) > 0 {
				plan.Sort = parts[0]
				order := "asc"
				if len(parts) > 1 {
					order = strings.ToLower(parts[1])
				}
				plan.Order = order
				plan.Sorts = append(plan.Sorts, SortSpec{Field: parts[0], Order: order})
			}
		case "from":
			plan.From = strings.Trim(val, `"'`)
		case "limit":
			if n, err := strconv.Atoi(val); err == nil {
				plan.Limit = n
			}
		case "group_by", "group-by":
			plan.GroupBy = val
		case "flatten":
			plan.Flatten = val
		}
	}

	if len(whereExprs) > 0 {
		combined := strings.Join(whereExprs, " AND ")
		expr, err := ParseExpr(combined)
		if err != nil {
			return nil, fmt.Errorf("legacy where: %w", err)
		}
		plan.Where = expr
	}

	if plan.Limit > maxLimit {
		plan.Limit = maxLimit
	}
	return plan, nil
}
