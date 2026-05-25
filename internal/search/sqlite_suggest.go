package search

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

func (s *SQLite) ListPageTitles(ctx context.Context, pathPrefix string) ([]PageTitle, error) {
	sqlQ := `SELECT path, json_extract(frontmatter, '$.title') FROM file_meta`
	args := []any{}
	if pathPrefix != "" {
		sqlQ += ` WHERE path LIKE ?`
		args = append(args, pathPrefix+"%")
	}
	sqlQ += ` ORDER BY path`

	rows, err := s.readDB.QueryContext(ctx, sqlQ, args...)
	if err != nil {
		return nil, fmt.Errorf("list page titles: %w", err)
	}
	defer rows.Close()

	var pages []PageTitle
	for rows.Next() {
		var path string
		var title sql.NullString
		if err := rows.Scan(&path, &title); err != nil {
			return nil, err
		}
		entry := PageTitle{Path: path}
		if title.Valid {
			entry.Title = strings.TrimSpace(title.String)
		}
		pages = append(pages, entry)
	}
	return pages, rows.Err()
}

func (s *SQLite) SuggestTitles(ctx context.Context, query, pathPrefix string, maxDistance, limit int) ([]TitleSuggestion, error) {
	query = NormalizeSuggestQuery(query)
	if query == "" {
		return nil, nil
	}
	if maxDistance <= 0 {
		maxDistance = DefaultSuggestMaxDistance
	}
	if limit <= 0 {
		limit = DefaultSuggestLimit
	}

	pages, err := s.ListPageTitles(ctx, pathPrefix)
	if err != nil {
		return nil, err
	}
	suggestions := SuggestTitles(query, pages, maxDistance, limit)
	if suggestions == nil {
		suggestions = []TitleSuggestion{}
	}
	return suggestions, nil
}
