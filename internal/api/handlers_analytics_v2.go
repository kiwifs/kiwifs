package api

import (
	"net/http"
	"strings"
	"time"

	"github.com/kiwifs/kiwifs/internal/search"
	"github.com/labstack/echo/v4"
)

// parsePeriodSeconds converts a period string like "7d", "30d", "90d" to seconds.
func parsePeriodSeconds(raw string) int64 {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		raw = "7d"
	}
	// Strip trailing 'd' and parse as days.
	if strings.HasSuffix(raw, "d") {
		ds := strings.TrimSuffix(raw, "d")
		var days int
		for _, c := range ds {
			if c >= '0' && c <= '9' {
				days = days*10 + int(c-'0')
			} else {
				days = 7
				break
			}
		}
		if days <= 0 {
			days = 7
		}
		return int64(days) * 86400
	}
	return 7 * 86400
}

// bucketSizeForPeriod returns a sensible time-series bucket size for a period.
func bucketSizeForPeriod(periodSeconds int64) int64 {
	switch {
	case periodSeconds <= 7*86400:
		return 3600 // hourly for <=7d
	case periodSeconds <= 30*86400:
		return 86400 // daily for <=30d
	default:
		return 86400 // daily for >30d
	}
}

// --- Overview endpoint ---

type AnalyticsOverviewResponse struct {
	Period            string  `json:"period"`
	TotalViews        int     `json:"total_views"`
	ViewsDelta        float64 `json:"views_delta_percent"`
	TotalSearches     int     `json:"total_searches"`
	SearchesDelta     float64 `json:"searches_delta_percent"`
	SearchSuccessRate float64 `json:"search_success_rate"`
	SuccessRateDelta  float64 `json:"success_rate_delta_pp"`
	UniquePages       int     `json:"unique_pages_viewed"`
	UniquePagesDelta  float64 `json:"unique_pages_delta_percent"`
}

// AnalyticsOverview godoc
//
//	@Summary		Get analytics overview
//	@Description	Retrieve high-level analytics overview metrics (total page views, total search queries, search success rate, unique pages viewed) and their delta percentages compared to the previous period. Requires SQLite search backend.
//	@Tags			analytics
//	@Security		BearerAuth
//	@Produce		json
//	@Param			period	query		string	false	"Time period to analyze (e.g. '7d', '30d', '90d', default: '7d')"
//	@Success		200		{object}	AnalyticsOverviewResponse
//	@Failure		501		{object}	map[string]string	"Analytics v2 not implemented for non-SQLite backends"
//	@Failure		500		{object}	map[string]string	"Internal server error while loading overview stats"
//	@Router			/api/kiwi/analytics/overview [get]
func (h *Handlers) AnalyticsOverview(c echo.Context) error {
	aq, ok := h.searcher.(search.AnalyticsQuerier)
	if !ok {
		return echo.NewHTTPError(http.StatusNotImplemented, "analytics v2 requires sqlite search backend")
	}
	period := c.QueryParam("period")
	periodSec := parsePeriodSeconds(period)
	if period == "" {
		period = "7d"
	}

	stats, err := aq.AnalyticsOverview(c.Request().Context(), periodSec)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.JSON(http.StatusOK, AnalyticsOverviewResponse{
		Period:            period,
		TotalViews:        stats.TotalViews,
		ViewsDelta:        stats.ViewsDelta,
		TotalSearches:     stats.TotalSearches,
		SearchesDelta:     stats.SearchesDelta,
		SearchSuccessRate: stats.SearchSuccessRate,
		SuccessRateDelta:  stats.SuccessRateDelta,
		UniquePages:       stats.UniquePages,
		UniquePagesDelta:  stats.UniquePagesDelta,
	})
}

// --- Views endpoint ---

type AnalyticsViewsResponse struct {
	Period     string                `json:"period"`
	Path       string                `json:"path,omitempty"`
	Source     string                `json:"source,omitempty"`
	TimeSeries []search.TimePoint    `json:"time_series"`
	TopPages   []search.PageViewStat `json:"top_pages"`
}

// AnalyticsViews godoc
//
//	@Summary		Get page view time-series and top pages
//	@Description	Retrieve detailed page view statistics including time-series data and top pages in the wiki database. Requires SQLite search backend.
//	@Tags			analytics
//	@Security		BearerAuth
//	@Produce		json
//	@Param			period	query		string	false	"Time period to analyze (e.g. '7d', '30d', '90d', default: '30d')"
//	@Param			path	query		string	false	"Specific page path to filter views"
//	@Param			source	query		string	false	"Source connector filter"
//	@Success		200		{object}	AnalyticsViewsResponse
//	@Failure		501		{object}	map[string]string	"Analytics v2 not implemented for non-SQLite backends"
//	@Failure		500		{object}	map[string]string	"Internal server error querying page views"
//	@Router			/api/kiwi/analytics/views/v2 [get]
func (h *Handlers) AnalyticsViews(c echo.Context) error {
	aq, ok := h.searcher.(search.AnalyticsQuerier)
	if !ok {
		return echo.NewHTTPError(http.StatusNotImplemented, "analytics v2 requires sqlite search backend")
	}
	period := c.QueryParam("period")
	periodSec := parsePeriodSeconds(period)
	if period == "" {
		period = "30d"
	}
	path := c.QueryParam("path")
	source := c.QueryParam("source")
	_ = source // TODO: source filtering

	now := time.Now().Unix()
	since := now - periodSec
	bucket := bucketSizeForPeriod(periodSec)

	ts, err := aq.PageViewTimeSeries(c.Request().Context(), path, since, now, bucket)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	if ts == nil {
		ts = []search.TimePoint{}
	}

	topPages, err := aq.PageViewsInRange(c.Request().Context(), "", since, now)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	if topPages == nil {
		topPages = []search.PageViewStat{}
	}
	if len(topPages) > 20 {
		topPages = topPages[:20]
	}

	return c.JSON(http.StatusOK, AnalyticsViewsResponse{
		Period:     period,
		Path:       path,
		Source:     source,
		TimeSeries: ts,
		TopPages:   topPages,
	})
}

// --- Searches endpoint ---

type AnalyticsSearchesResponse struct {
	Period            string              `json:"period"`
	SearchSuccessRate float64             `json:"search_success_rate"`
	TimeSeries        []search.TimePoint  `json:"time_series"`
	TopFailed         []search.SearchStat `json:"top_failed"`
}

// AnalyticsSearches godoc
//
//	@Summary		Get search success and queries analysis
//	@Description	Retrieve detailed search analytics including time-series search success rates and top failed search terms. Requires SQLite search backend.
//	@Tags			analytics
//	@Security		BearerAuth
//	@Produce		json
//	@Param			period	query		string	false	"Time period to analyze (e.g. '7d', '30d', '90d', default: '30d')"
//	@Success		200		{object}	AnalyticsSearchesResponse
//	@Failure		501		{object}	map[string]string	"Analytics v2 not implemented for non-SQLite backends"
//	@Failure		500		{object}	map[string]string	"Internal query error"
//	@Router			/api/kiwi/analytics/searches [get]
func (h *Handlers) AnalyticsSearches(c echo.Context) error {
	aq, ok := h.searcher.(search.AnalyticsQuerier)
	if !ok {
		return echo.NewHTTPError(http.StatusNotImplemented, "analytics v2 requires sqlite search backend")
	}
	period := c.QueryParam("period")
	periodSec := parsePeriodSeconds(period)
	if period == "" {
		period = "30d"
	}

	now := time.Now().Unix()
	since := now - periodSec
	bucket := bucketSizeForPeriod(periodSec)

	rate, err := aq.SearchSuccessRate(c.Request().Context(), since, now)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	ts, err := aq.SearchTimeSeries(c.Request().Context(), since, now, bucket)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	if ts == nil {
		ts = []search.TimePoint{}
	}

	topFailed, err := aq.TopSearches(c.Request().Context(), 20, since, true)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	if topFailed == nil {
		topFailed = []search.SearchStat{}
	}

	return c.JSON(http.StatusOK, AnalyticsSearchesResponse{
		Period:            period,
		SearchSuccessRate: rate,
		TimeSeries:        ts,
		TopFailed:         topFailed,
	})
}

// --- Trends endpoint ---

type AnalyticsTrendsResponse struct {
	Period    string             `json:"period"`
	Trending  []search.TrendStat `json:"trending"`
	Declining []search.TrendStat `json:"declining"`
}

// AnalyticsTrends godoc
//
//	@Summary		Get trending and declining pages
//	@Description	Lists the trending and declining pages in the wiki based on traffic delta. Requires SQLite search backend.
//	@Tags			analytics
//	@Security		BearerAuth
//	@Produce		json
//	@Param			period	query		string	false	"Time period to evaluate (e.g. '7d', '30d', default: '7d')"
//	@Success		200		{object}	AnalyticsTrendsResponse
//	@Failure		501		{object}	map[string]string	"Analytics v2 not implemented for non-SQLite backends"
//	@Failure		500		{object}	map[string]string	"Internal query error"
//	@Router			/api/kiwi/analytics/trends [get]
func (h *Handlers) AnalyticsTrends(c echo.Context) error {
	aq, ok := h.searcher.(search.AnalyticsQuerier)
	if !ok {
		return echo.NewHTTPError(http.StatusNotImplemented, "analytics v2 requires sqlite search backend")
	}
	period := c.QueryParam("period")
	periodSec := parsePeriodSeconds(period)
	if period == "" {
		period = "7d"
	}
	days := int(periodSec / 86400)

	trending, err := aq.TrendingPages(c.Request().Context(), days)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	if trending == nil {
		trending = []search.TrendStat{}
	}

	declining, err := aq.DecliningPages(c.Request().Context(), days)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	if declining == nil {
		declining = []search.TrendStat{}
	}

	return c.JSON(http.StatusOK, AnalyticsTrendsResponse{
		Period:    period,
		Trending:  trending,
		Declining: declining,
	})
}

// --- Content Gaps endpoint ---

type AnalyticsContentGapsResponse struct {
	Results []search.FailedSearchStat `json:"results"`
}

// AnalyticsContentGaps godoc
//
//	@Summary		Get search content gaps
//	@Description	Identifies missing documentation or search gaps by listing queries that returned zero results. Requires SQLite search backend.
//	@Tags			analytics
//	@Security		BearerAuth
//	@Produce		json
//	@Param			limit	query		int		false	"Maximum number of content gaps to return (default: 20)"
//	@Success		200		{object}	AnalyticsContentGapsResponse
//	@Failure		501		{object}	map[string]string	"Analytics v2 not implemented for non-SQLite backends"
//	@Failure		500		{object}	map[string]string	"Internal query error"
//	@Router			/api/kiwi/analytics/content-gaps [get]
func (h *Handlers) AnalyticsContentGaps(c echo.Context) error {
	aq, ok := h.searcher.(search.AnalyticsQuerier)
	if !ok {
		return echo.NewHTTPError(http.StatusNotImplemented, "analytics v2 requires sqlite search backend")
	}

	limit := search.NormalizeLimit(parseIntParam(c, "limit", 20))
	results, err := aq.ContentGaps(c.Request().Context(), limit)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	if results == nil {
		results = []search.FailedSearchStat{}
	}
	return c.JSON(http.StatusOK, AnalyticsContentGapsResponse{Results: results})
}

// --- Dismiss Content Gap ---

type dismissRequest struct {
	Query      string `json:"query"`
	SearchType string `json:"search_type"`
}

// AnalyticsDismissContentGap godoc
//
//	@Summary		Dismiss a search content gap
//	@Description	Dismisses or hides a specific failed search query from the content gaps listing. Requires SQLite search backend.
//	@Tags			analytics
//	@Security		BearerAuth
//	@Accept			json
//	@Produce		json
//	@Param			request	body		dismissRequest	true	"The search query to dismiss"
//	@Success		200		{object}	map[string]string	"Result confirmation message"
//	@Failure		400		{object}	map[string]string	"Query parameter is missing"
//	@Failure		501		{object}	map[string]string	"Analytics v2 not implemented for non-SQLite backends"
//	@Failure		500		{object}	map[string]string	"Failed to dismiss query"
//	@Router			/api/kiwi/analytics/content-gaps/dismiss [post]
func (h *Handlers) AnalyticsDismissContentGap(c echo.Context) error {
	aq, ok := h.searcher.(search.AnalyticsQuerier)
	if !ok {
		return echo.NewHTTPError(http.StatusNotImplemented, "analytics v2 requires sqlite search backend")
	}

	var req dismissRequest
	if err := bindJSON(c, &req); err != nil {
		return err
	}
	if req.Query == "" {
		// Try from URL param
		req.Query = c.Param("query")
	}
	if req.Query == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "query is required")
	}
	if req.SearchType == "" {
		req.SearchType = "search"
	}

	if err := aq.DismissContentGap(c.Request().Context(), req.Query, req.SearchType); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.JSON(http.StatusOK, map[string]string{"dismissed": req.Query})
}

// --- Source Breakdown endpoint ---

type AnalyticsSourcesResponse struct {
	Period  string         `json:"period"`
	Sources map[string]int `json:"sources"`
}

// AnalyticsSources godoc
//
//	@Summary		Get views source breakdown
//	@Description	Returns a breakdown of page views by source connector type. Requires SQLite search backend.
//	@Tags			analytics
//	@Security		BearerAuth
//	@Produce		json
//	@Param			period	query		string	false	"Time period to analyze (e.g. '7d', '30d', default: '7d')"
//	@Success		200		{object}	AnalyticsSourcesResponse
//	@Failure		501		{object}	map[string]string	"Analytics v2 not implemented for non-SQLite backends"
//	@Failure		500		{object}	map[string]string	"Internal query error"
//	@Router			/api/kiwi/analytics/sources [get]
func (h *Handlers) AnalyticsSources(c echo.Context) error {
	aq, ok := h.searcher.(search.AnalyticsQuerier)
	if !ok {
		return echo.NewHTTPError(http.StatusNotImplemented, "analytics v2 requires sqlite search backend")
	}
	period := c.QueryParam("period")
	periodSec := parsePeriodSeconds(period)
	if period == "" {
		period = "7d"
	}
	now := time.Now().Unix()
	since := now - periodSec

	sources, err := aq.SourceBreakdown(c.Request().Context(), since, now)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	if sources == nil {
		sources = map[string]int{}
	}
	return c.JSON(http.StatusOK, AnalyticsSourcesResponse{
		Period:  period,
		Sources: sources,
	})
}
