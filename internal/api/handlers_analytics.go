package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/kiwifs/kiwifs/internal/janitor"
	"github.com/kiwifs/kiwifs/internal/search"
	"github.com/labstack/echo/v4"
)

type IssueGroup struct {
	Count int      `json:"count"`
	Paths []string `json:"paths"`
}

type HealthStats struct {
	Stale         IssueGroup `json:"stale"`
	Orphans       IssueGroup `json:"orphans"`
	BrokenLinks   IssueGroup `json:"broken_links"`
	Empty         IssueGroup `json:"empty"`
	NoFrontmatter IssueGroup `json:"no_frontmatter"`
}

type CoverageStats struct {
	PagesWithLinks    int     `json:"pages_with_links"`
	PagesWithoutLinks int     `json:"pages_without_links"`
	AvgLinksPerPage   float64 `json:"avg_links_per_page"`
}

type PageStat struct {
	Path      string `json:"path"`
	UpdatedAt string `json:"updated_at"`
}

type EngagementStats struct {
	TotalViews     int                       `json:"total_views"`
	TopViewed      []search.PageViewStat     `json:"top_viewed"`
	FailedSearches []search.FailedSearchStat `json:"failed_searches"`
}

type AnalyticsResponse struct {
	TotalPages int             `json:"total_pages"`
	TotalWords int             `json:"total_words"`
	Health     HealthStats     `json:"health"`
	Coverage   CoverageStats   `json:"coverage"`
	TopUpdated []PageStat      `json:"top_updated"`
	Engagement EngagementStats `json:"engagement"`
}

type FailedSearchesResponse struct {
	Top     int                       `json:"top"`
	Since   int64                     `json:"since,omitempty"`
	Results []search.FailedSearchStat `json:"results"`
}

type PageViewsResponse struct {
	Top     int                   `json:"top"`
	Path    string                `json:"path,omitempty"`
	Since   int64                 `json:"since,omitempty"`
	Results []search.PageViewStat `json:"results"`
}

// Analytics godoc
//
//	@Summary		Get system-wide analytics
//	@Description	Retrieve system-wide analytics, including document health, coverage, engagement metrics, and top updated pages. Requires SQLite search backend.
//	@Tags			analytics
//	@Security		BearerAuth
//	@Produce		json
//	@Param			scope			query		string	false	"Directory path prefix to filter statistics"
//	@Param			stale_threshold	query		int		false	"Number of days since update to consider a page stale (default: 30)"
//	@Success		200				{object}	AnalyticsResponse
//	@Failure		501				{object}	map[string]string	"Analytics not implemented for non-SQLite backends"
//	@Failure		500				{object}	map[string]string	"Internal server error while building stats"
//	@Router			/api/kiwi/analytics [get]
func (h *Handlers) Analytics(c echo.Context) error {
	sq, ok := h.searcher.(*search.SQLite)
	if !ok {
		return echo.NewHTTPError(http.StatusNotImplemented, "analytics requires sqlite search backend")
	}
	ctx := c.Request().Context()
	scope := c.QueryParam("scope")
	staleThreshold := parseIntParam(c, "stale_threshold", 30)
	if staleThreshold <= 0 {
		staleThreshold = 30
	}

	resp, err := BuildAnalytics(ctx, sq, h.janitorSched, scope, staleThreshold)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.JSON(http.StatusOK, resp)
}

// FailedSearches godoc
//
//	@Summary		Get top failed search queries
//	@Description	Retrieve the top failed search queries within a specified timeframe. Requires SQLite search backend.
//	@Tags			analytics
//	@Security		BearerAuth
//	@Produce		json
//	@Param			top		query		int		false	"Maximum number of failed queries to return (default: 20)"
//	@Param			since	query		string	false	"Retrieve stats since this Unix timestamp or RFC3339 date"
//	@Success		200		{object}	FailedSearchesResponse
//	@Failure		400		{object}	map[string]string	"Invalid since date format"
//	@Failure		501		{object}	map[string]string	"Failed search analytics not implemented for non-SQLite backends"
//	@Failure		500		{object}	map[string]string	"Internal query error"
//	@Router			/api/kiwi/analytics/failed-searches [get]
func (h *Handlers) FailedSearches(c echo.Context) error {
	recorder, ok := h.searcher.(search.FailedSearchRecorder)
	if !ok {
		return echo.NewHTTPError(http.StatusNotImplemented, "failed search analytics requires sqlite search backend")
	}
	top := search.NormalizeLimit(parseIntParam(c, "top", 20))
	since, err := parseAnalyticsSince(c.QueryParam("since"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid since: expected unix timestamp or RFC3339 date")
	}

	results, err := recorder.FailedSearches(c.Request().Context(), top, since)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	if results == nil {
		results = []search.FailedSearchStat{}
	}
	return c.JSON(http.StatusOK, FailedSearchesResponse{
		Top:     top,
		Since:   since,
		Results: results,
	})
}

// PageViews godoc
//
//	@Summary		Get page views statistics
//	@Description	Retrieve page view statistics for pages in the wiki database. Requires SQLite search backend.
//	@Tags			analytics
//	@Security		BearerAuth
//	@Produce		json
//	@Param			top		query		int		false	"Maximum number of records to return (default: 20)"
//	@Param			path	query		string	false	"Specific page path to filter stats"
//	@Param			since	query		string	false	"Retrieve stats since this Unix timestamp or RFC3339 date"
//	@Success		200		{object}	PageViewsResponse
//	@Failure		400		{object}	map[string]string	"Invalid since date format"
//	@Failure		501		{object}	map[string]string	"Page view analytics not implemented for non-SQLite backends"
//	@Failure		500		{object}	map[string]string	"Internal query error"
//	@Router			/api/kiwi/analytics/views [get]
func (h *Handlers) PageViews(c echo.Context) error {
	recorder, ok := h.searcher.(search.PageViewRecorder)
	if !ok {
		return echo.NewHTTPError(http.StatusNotImplemented, "page view analytics requires sqlite search backend")
	}
	top := search.NormalizeLimit(parseIntParam(c, "top", 20))
	path := c.QueryParam("path")
	since, err := parseAnalyticsSince(c.QueryParam("since"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid since: expected unix timestamp or RFC3339 date")
	}

	results, err := recorder.PageViews(c.Request().Context(), top, path, since)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	if results == nil {
		results = []search.PageViewStat{}
	}
	return c.JSON(http.StatusOK, PageViewsResponse{
		Top:     top,
		Path:    path,
		Since:   since,
		Results: results,
	})
}

func parseAnalyticsSince(raw string) (int64, error) {
	if raw == "" {
		return 0, nil
	}
	if unix, err := strconv.ParseInt(raw, 10, 64); err == nil {
		return unix, nil
	}
	t, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return 0, err
	}
	return t.Unix(), nil
}

func BuildAnalytics(ctx context.Context, sq *search.SQLite, janitorSched *janitor.Scheduler, scope string, staleThreshold int) (*AnalyticsResponse, error) {
	db := sq.ReadDB()
	resp := &AnalyticsResponse{}

	scopeSQL := ""
	var scopeArgs []any
	if scope != "" {
		scopeSQL = " WHERE path LIKE ? || '%'"
		scopeArgs = append(scopeArgs, scope)
	}

	var totalWordsNull *float64
	err := db.QueryRowContext(ctx,
		`SELECT COUNT(*), SUM(json_extract(frontmatter, '$._word_count')) FROM file_meta`+scopeSQL,
		scopeArgs...,
	).Scan(&resp.TotalPages, &totalWordsNull)
	if err != nil {
		return nil, err
	}
	if totalWordsNull != nil {
		resp.TotalWords = int(*totalWordsNull)
	}

	// Stale pages
	if sd, ok := interface{}(sq).(search.StaleDetector); ok {
		stale, serr := sd.StalePages(ctx, staleThreshold)
		if serr != nil {
			return nil, fmt.Errorf("stale pages: %w", serr)
		}
		for _, s := range stale {
			if scope == "" || hasPrefix(s.Path, scope) {
				resp.Health.Stale.Count++
				resp.Health.Stale.Paths = append(resp.Health.Stale.Paths, s.Path)
			}
		}
	}

	// Janitor-based health metrics
	if janitorSched != nil {
		if scan := janitorSched.LastResult(); scan != nil {
			for _, issue := range scan.Issues {
				if scope != "" && !hasPrefix(issue.Path, scope) {
					continue
				}
				switch issue.Kind {
				case janitor.IssueOrphan:
					resp.Health.Orphans.Count++
					resp.Health.Orphans.Paths = append(resp.Health.Orphans.Paths, issue.Path)
				case janitor.IssueBrokenLink:
					resp.Health.BrokenLinks.Count++
					resp.Health.BrokenLinks.Paths = append(resp.Health.BrokenLinks.Paths, issue.Path)
				case janitor.IssueEmptyPage:
					resp.Health.Empty.Count++
					resp.Health.Empty.Paths = append(resp.Health.Empty.Paths, issue.Path)
				}
			}
		}
	}

	// No-frontmatter count
	nfSQL := `SELECT COUNT(*) FROM file_meta WHERE json_extract(frontmatter, '$._has_frontmatter') = 0 OR json_extract(frontmatter, '$._has_frontmatter') IS NULL`
	if scope != "" {
		nfSQL += ` AND path LIKE ? || '%'`
	}
	var nfCount int
	if scope != "" {
		if err := db.QueryRowContext(ctx, nfSQL, scope).Scan(&nfCount); err != nil && err != sql.ErrNoRows {
			return nil, fmt.Errorf("no-frontmatter count: %w", err)
		}
	} else {
		if err := db.QueryRowContext(ctx, nfSQL).Scan(&nfCount); err != nil && err != sql.ErrNoRows {
			return nil, fmt.Errorf("no-frontmatter count: %w", err)
		}
	}
	resp.Health.NoFrontmatter = IssueGroup{Count: nfCount}

	// Coverage
	if err := buildCoverageFromDB(ctx, db, scopeSQL, scopeArgs, resp); err != nil {
		return nil, fmt.Errorf("coverage: %w", err)
	}

	// Top updated
	topSQL := `SELECT path, updated_at FROM file_meta` + scopeSQL + ` ORDER BY updated_at DESC LIMIT 10`
	rows, err := db.QueryContext(ctx, topSQL, scopeArgs...)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var path, updatedAt string
			if rows.Scan(&path, &updatedAt) == nil {
				resp.TopUpdated = append(resp.TopUpdated, PageStat{Path: path, UpdatedAt: updatedAt})
			}
		}
	}
	if resp.TopUpdated == nil {
		resp.TopUpdated = []PageStat{}
	}
	if resp.Health.Stale.Paths == nil {
		resp.Health.Stale.Paths = []string{}
	}
	if resp.Health.Orphans.Paths == nil {
		resp.Health.Orphans.Paths = []string{}
	}
	if resp.Health.BrokenLinks.Paths == nil {
		resp.Health.BrokenLinks.Paths = []string{}
	}
	if resp.Health.Empty.Paths == nil {
		resp.Health.Empty.Paths = []string{}
	}
	if resp.Health.NoFrontmatter.Paths == nil {
		resp.Health.NoFrontmatter.Paths = []string{}
	}

	eng, err := buildEngagementStats(ctx, sq, scope)
	if err != nil {
		return nil, fmt.Errorf("engagement: %w", err)
	}
	resp.Engagement = eng

	return resp, nil
}

func buildEngagementStats(ctx context.Context, sq *search.SQLite, scope string) (EngagementStats, error) {
	eng := EngagementStats{
		TopViewed:      []search.PageViewStat{},
		FailedSearches: []search.FailedSearchStat{},
	}
	if pv, ok := interface{}(sq).(search.PageViewRecorder); ok {
		total, err := pv.PageViewTotal(ctx, scope, 0)
		if err != nil {
			return eng, err
		}
		eng.TotalViews = total

		top, err := pv.PageViews(ctx, 50, "", 0)
		if err != nil {
			return eng, err
		}
		if top == nil {
			top = []search.PageViewStat{}
		}
		if scope != "" {
			filtered := top[:0]
			for _, v := range top {
				if hasPrefix(v.Path, scope) {
					filtered = append(filtered, v)
				}
			}
			top = filtered
		}
		if len(top) > 10 {
			top = top[:10]
		}
		eng.TopViewed = top
	}
	if fr, ok := interface{}(sq).(search.FailedSearchRecorder); ok {
		failed, err := fr.FailedSearches(ctx, 10, 0)
		if err != nil {
			return eng, err
		}
		if failed == nil {
			failed = []search.FailedSearchStat{}
		}
		eng.FailedSearches = failed
	}
	return eng, nil
}

func buildCoverageFromDB(ctx context.Context, db *sql.DB, scopeSQL string, scopeArgs []any, resp *AnalyticsResponse) error {
	row := db.QueryRowContext(ctx,
		`SELECT
			COUNT(CASE WHEN COALESCE(json_extract(frontmatter, '$._link_count'), 0) > 0 THEN 1 END),
			COUNT(CASE WHEN COALESCE(json_extract(frontmatter, '$._link_count'), 0) = 0 THEN 1 END),
			COALESCE(AVG(json_extract(frontmatter, '$._link_count')), 0)
		FROM file_meta`+scopeSQL,
		scopeArgs...,
	)
	return row.Scan(&resp.Coverage.PagesWithLinks, &resp.Coverage.PagesWithoutLinks, &resp.Coverage.AvgLinksPerPage)
}

func hasPrefix(s, prefix string) bool {
	return len(s) >= len(prefix) && s[:len(prefix)] == prefix
}

// HealthCheck returns per-page health information.
type HealthCheckResponse struct {
	Path            string   `json:"path"`
	WordCount       int      `json:"word_count"`
	LinkCount       int      `json:"link_count"`
	BacklinkCount   int      `json:"backlink_count"`
	DaysSinceUpdate float64  `json:"days_since_update"`
	QualityScore    *float64 `json:"quality_score,omitempty"`
	Issues          []string `json:"issues"`
}

// HealthCheck godoc
//
//	@Summary		Get page health check details
//	@Description	Returns health, quality metrics, and issues list for a single page. Requires SQLite search backend.
//	@Tags			analytics
//	@Security		BearerAuth
//	@Produce		json
//	@Param			path	query		string	true	"Path of the page to inspect"
//	@Success		200		{object}	HealthCheckResponse
//	@Failure		400		{object}	map[string]string	"Path parameter is missing"
//	@Failure		501		{object}	map[string]string	"Health check not implemented for non-SQLite backends"
//	@Failure		500		{object}	map[string]string	"Internal metadata retrieval error"
//	@Router			/api/kiwi/health-check [get]
func (h *Handlers) HealthCheck(c echo.Context) error {
	sq, ok := h.searcher.(*search.SQLite)
	if !ok {
		return echo.NewHTTPError(http.StatusNotImplemented, "health check requires sqlite search backend")
	}
	path := c.QueryParam("path")
	if path == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "path is required")
	}
	ctx := c.Request().Context()
	resp, err := buildHealthCheck(ctx, sq, h.janitorSched, path)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.JSON(http.StatusOK, resp)
}

func buildHealthCheck(ctx context.Context, sq *search.SQLite, janitorSched *janitor.Scheduler, path string) (*HealthCheckResponse, error) {
	db := sq.ReadDB()
	resp := &HealthCheckResponse{Path: path, Issues: []string{}}

	var fm string
	var updatedAt string
	err := db.QueryRowContext(ctx,
		`SELECT frontmatter, updated_at FROM file_meta WHERE path = ?`, path,
	).Scan(&fm, &updatedAt)
	if err == sql.ErrNoRows {
		resp.Issues = append(resp.Issues, "page not found in index")
		return resp, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query file_meta: %w", err)
	}

	var parsed map[string]any
	if err := unmarshalJSON([]byte(fm), &parsed); err == nil {
		if v, ok := parsed["_word_count"]; ok {
			resp.WordCount = toInt(v)
		}
		if v, ok := parsed["_link_count"]; ok {
			resp.LinkCount = toInt(v)
		}
		if v, ok := parsed["_backlink_count"]; ok {
			resp.BacklinkCount = toInt(v)
		}
		if v, ok := parsed["quality_score"]; ok {
			f := toFloat64(v)
			resp.QualityScore = &f
		}
	}

	if updatedAt != "" {
		resp.DaysSinceUpdate = daysSince(updatedAt)
	}

	// Gather issues from last janitor scan
	if janitorSched != nil {
		if scan := janitorSched.LastResult(); scan != nil {
			for _, issue := range scan.Issues {
				if issue.Path == path {
					resp.Issues = append(resp.Issues, issue.Kind+": "+issue.Message)
				}
			}
		}
	}

	return resp, nil
}

func toInt(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case int64:
		return int(n)
	}
	return 0
}

func toFloat64(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	case int64:
		return float64(n)
	}
	return 0
}

func unmarshalJSON(data []byte, v any) error {
	return json.Unmarshal(data, v)
}

func daysSince(rfc3339 string) float64 {
	t, err := time.Parse(time.RFC3339, rfc3339)
	if err != nil {
		return 0
	}
	return time.Since(t).Hours() / 24
}
