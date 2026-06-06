package search

import (
	"context"
	"time"
)

// Match is a single line match within a file.
type Match struct {
	Line int    `json:"line"`
	Text string `json:"text"`
}

// Result is all matches within a single file.
type Result struct {
	Path    string  `json:"path"`
	Matches []Match `json:"matches"`
	// Score is the BM25 relevance score (lower = more relevant in FTS5 ordering,
	// but we flip the sign at the API boundary so "higher is better" for clients).
	// Zero for engines without ranking (grep).
	Score float64 `json:"score,omitempty"`
	// Snippet is a short highlighted excerpt around the best match.
	// Empty for engines that don't produce snippets (grep).
	Snippet string `json:"snippet,omitempty"`
	// TrustScore is the BM25 score adjusted by trust signals (status, confidence,
	// source-of-truth). Only populated by TrustSearcher.SearchVerified.
	TrustScore float64 `json:"trustScore,omitempty"`
}

// FailedSearchStat is an aggregate of zero-result searches.
type FailedSearchStat struct {
	Query      string `json:"query"`
	SearchType string `json:"search_type"`
	Count      int    `json:"count"`
	FirstSeen  int64  `json:"first_seen"`
	LastSeen   int64  `json:"last_seen"`
}

// PageViewStat is an aggregate of successful page reads.
type PageViewStat struct {
	Path      string `json:"path"`
	Count     int    `json:"count"`
	FirstSeen int64  `json:"first_seen"`
	LastSeen  int64  `json:"last_seen"`
}

// TimePoint is a single data point in a time-series.
type TimePoint struct {
	Timestamp int64 `json:"timestamp"`
	Count     int   `json:"count"`
}

// TrendStat is a page with a computed trend (current vs previous period).
type TrendStat struct {
	Path          string  `json:"path"`
	CurrentViews  int     `json:"current_views"`
	PreviousViews int     `json:"previous_views"`
	DeltaPercent  float64 `json:"delta_percent"`
}

// SearchStat is an aggregate of search queries (both successful and failed).
type SearchStat struct {
	Query      string `json:"query"`
	SearchType string `json:"search_type"`
	Count      int    `json:"count"`
	HadResults int    `json:"had_results"`
}

// OverviewStats summarises key metrics for a period with deltas vs the prior period.
type OverviewStats struct {
	TotalViews        int     `json:"total_views"`
	ViewsDelta        float64 `json:"views_delta_percent"`
	TotalSearches     int     `json:"total_searches"`
	SearchesDelta     float64 `json:"searches_delta_percent"`
	SearchSuccessRate float64 `json:"search_success_rate"`
	SuccessRateDelta  float64 `json:"success_rate_delta_pp"`
	UniquePages       int     `json:"unique_pages_viewed"`
	UniquePagesDelta  float64 `json:"unique_pages_delta_percent"`
}

const defaultSearchLimit = 50

const maxSearchLimit = 200

// SearchOptions tune optional search behaviour for backends that support them.
type SearchOptions struct {
	// IncludeSuperseded includes pages whose memory_status is superseded.
	// Default search excludes them.
	IncludeSuperseded bool
	// Scope restricts results to pages whose frontmatter scope exactly matches.
	Scope string
}

// OptionsSearcher supports optional search tuning beyond the base Searcher contract.
type OptionsSearcher interface {
	Searcher
	SearchWithOptions(ctx context.Context, query string, limit, offset int, pathPrefix string, opts SearchOptions) ([]Result, error)
}

// Searcher searches across all knowledge files and (for index-backed engines)
// keeps the index in sync with filesystem writes.
//
// Every method takes context.Context as the first parameter. SQLite-backed
// implementations forward it to QueryContext/ExecContext so a cancelled
// HTTP request frees the DB connection immediately. Grep checks it
// between files during the walk so a long search bows out on cancel.
type Searcher interface {
	// Search runs a full-text query. limit == 0 means "use the engine
	// default" (defaultSearchLimit). Negative values are treated as zero.
	// offset < 0 is treated as zero. Engines should cap limit at
	// maxSearchLimit even if the caller forgets to.
	// pathPrefix, when non-empty, restricts results to paths starting with
	// that prefix (server-side filtering, not post-fetch).
	Search(ctx context.Context, query string, limit, offset int, pathPrefix string) ([]Result, error)
	// Index upserts a file into the search index. No-op for stateless engines.
	Index(ctx context.Context, path string, content []byte) error
	// Remove drops a file from the search index. No-op for stateless engines.
	Remove(ctx context.Context, path string) error
	// Reindex rebuilds the index from scratch by walking the knowledge root.
	// Returns the number of files indexed. No-op for stateless engines (returns 0).
	Reindex(ctx context.Context) (int, error)
	// Close releases any resources (open DB handles, etc.). No-op is fine.
	Close() error
}

// DateFilterer is an optional interface that searchers can implement to
// filter result paths by modification date using indexed data instead of
// per-file stat calls.
type DateFilterer interface {
	FilterByDate(ctx context.Context, paths []string, after time.Time) ([]string, error)
}

// ScopeFilterer is implemented by search backends that can filter result paths
// using the indexed frontmatter scope field.
type ScopeFilterer interface {
	FilterByScope(ctx context.Context, paths []string, scope string) ([]string, error)
}

// TrustSearcher is implemented by search backends that support trust-boosted ranking.
type TrustSearcher interface {
	// SearchVerified returns only pages whose trust signals clear a
	// high bar (status == verified, source-of-truth == true, or a
	// confidence > 0.8). Zero results is normal: the caller explicitly
	// asked for the "only canonical" view.
	SearchVerified(ctx context.Context, query string, limit, offset int, pathPrefix string) ([]Result, error)
	// SearchBoosted returns the same set of hits as a plain BM25
	// search, but re-ranks them with a soft trust multiplier so
	// verified pages bubble up. Unlike SearchVerified, a page with no
	// trust metadata still appears in results — it just doesn't get
	// the boost.
	SearchBoosted(ctx context.Context, query string, limit, offset int, pathPrefix string) ([]Result, error)
}

// StaleDetector is implemented by search backends that can identify pages
// past their review date or not reviewed within a given window.
type StaleDetector interface {
	StalePages(ctx context.Context, staleDays int) ([]MetaResult, error)
}

// ContradictionDetector is implemented by search backends that can find
// pages with overlapping topics but conflicting trust signals.
type ContradictionDetector interface {
	FindContradictions(ctx context.Context, path string) ([]string, error)
}

// IndexEntry is a single file for IndexBatch.
type IndexEntry struct {
	Path    string
	Content []byte
}

// BatchIndexer is implemented by search backends that support batched index
// writes (one transaction for N files instead of N transactions).
type BatchIndexer interface {
	IndexBatch(ctx context.Context, files []IndexEntry) error
}

// Resyncer is implemented by search backends that support an incremental
// reconciliation with underlying storage (used at startup to catch
// out-of-band filesystem changes made while the server was down).
type Resyncer interface {
	Resync(ctx context.Context) (added, removed int, err error)
}

// FailedSearchRecorder is implemented by search backends that can persist
// zero-result search analytics.
type FailedSearchRecorder interface {
	RecordFailedSearch(ctx context.Context, query, searchType string) error
	FailedSearches(ctx context.Context, limit int, since int64) ([]FailedSearchStat, error)
}

// SearchRecorder extends FailedSearchRecorder with success recording.
type SearchRecorder interface {
	RecordSearch(ctx context.Context, query, searchType string, hadResults bool) error
	FailedSearches(ctx context.Context, limit int, since int64) ([]FailedSearchStat, error)
}

// QuerySuggester is implemented by search backends that can suggest
// fuzzy title matches when a query returns zero results.
type QuerySuggester interface {
	SuggestTitles(ctx context.Context, query, pathPrefix string, maxDistance, limit int) ([]TitleSuggestion, error)
}

// PageViewRecorder is implemented by search backends that can persist read
// analytics for knowledge pages.
type PageViewRecorder interface {
	RecordPageView(ctx context.Context, path, source string) error
	PageViews(ctx context.Context, limit int, path string, since int64) ([]PageViewStat, error)
	PageViewTotal(ctx context.Context, pathPrefix string, since int64) (int, error)
}

// AnalyticsQuerier is implemented by search backends that support the v2
// time-bucketed analytics query layer.
type AnalyticsQuerier interface {
	// PageViewsInRange sums page view counts within [since, until].
	PageViewsInRange(ctx context.Context, pathPrefix string, since, until int64) ([]PageViewStat, error)
	// PageViewTimeSeries returns time-bucketed view counts.
	PageViewTimeSeries(ctx context.Context, path string, since, until, bucketSize int64) ([]TimePoint, error)
	// SearchSuccessRate returns the ratio of successful searches in [since, until].
	SearchSuccessRate(ctx context.Context, since, until int64) (float64, error)
	// TrendingPages compares current vs previous period to find trending pages.
	TrendingPages(ctx context.Context, periodDays int) ([]TrendStat, error)
	// DecliningPages returns pages with negative trends or zero views in current period.
	DecliningPages(ctx context.Context, periodDays int) ([]TrendStat, error)
	// ContentGaps returns failed searches not yet dismissed.
	ContentGaps(ctx context.Context, limit int) ([]FailedSearchStat, error)
	// DismissContentGap marks a failed search as noise.
	DismissContentGap(ctx context.Context, query, searchType string) error
	// AnalyticsOverview returns summary stats with deltas.
	AnalyticsOverview(ctx context.Context, periodSeconds int64) (*OverviewStats, error)
	// SearchTimeSeries returns time-bucketed search counts.
	SearchTimeSeries(ctx context.Context, since, until, bucketSize int64) ([]TimePoint, error)
	// TopSearches returns the most popular search queries in a period.
	TopSearches(ctx context.Context, limit int, since int64, failedOnly bool) ([]SearchStat, error)
	// SourceBreakdown returns view counts grouped by source within [since, until].
	SourceBreakdown(ctx context.Context, since, until int64) (map[string]int, error)
	// LeastViewed returns pages with zero views in the given period + their last update date.
	LeastViewed(ctx context.Context, since int64, limit int) ([]PageViewStat, error)
}

// NormalizeLimit clamps a caller-supplied limit into [1, maxSearchLimit].
// Zero (or negative) means "use the default".
func NormalizeLimit(limit int) int {
	if limit <= 0 {
		return defaultSearchLimit
	}
	if limit > maxSearchLimit {
		return maxSearchLimit
	}
	return limit
}

// NormalizeOffset clamps a caller-supplied offset to be non-negative.
func NormalizeOffset(offset int) int {
	if offset < 0 {
		return 0
	}
	return offset
}
