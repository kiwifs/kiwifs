package api

import (
	"context"
	"net/http"
	"time"

	"github.com/kiwifs/kiwifs/internal/config"
	"github.com/kiwifs/kiwifs/internal/search"
	"github.com/kiwifs/kiwifs/internal/tracing"
	"github.com/kiwifs/kiwifs/internal/vectorstore"
	"github.com/labstack/echo/v4"
)

type searchResultEntry struct {
	Path      string         `json:"path"`
	Matches   []search.Match `json:"matches"`
	Score     float64        `json:"score,omitempty"`
	Snippet   string         `json:"snippet,omitempty"`
	Permalink string         `json:"permalink,omitempty"`
}

type searchSuggestionEntry struct {
	Query    string `json:"query"`
	Path     string `json:"path"`
	Title    string `json:"title"`
	Distance int    `json:"distance"`
}

type searchResponse struct {
	Query       string                  `json:"query"`
	Limit       int                     `json:"limit"`
	Offset      int                     `json:"offset"`
	Results     []searchResultEntry     `json:"results"`
	Suggestions []searchSuggestionEntry `json:"suggestions,omitempty"`
}

// Search godoc
//
//	@Summary		Full-text search
//	@Description	Performs a full-text search query on the repository content.
//	@Tags			search
//	@Security		BearerAuth
//	@Param			q				query		string	true	"Search query string"
//	@Param			limit			query		int		false	"Maximum number of search results to return (default: 15, max: 200)"
//	@Param			offset			query		int		false	"Number of search results to skip (offset) (default: 0)"
//	@Param			boost				query		string	false	"Set to 'none' or 'off' to disable trust boosting in search results"
//	@Param			include_superseded	query		bool	false	"Include pages with memory_status: superseded (excluded by default)"
//	@Param			modifiedAfter		query		string	false	"RFC3339 formatted cutoff date to filter search results by modification time"
//	@Param			scope				query		string	false	"Filter results to pages whose frontmatter scope exactly matches"
//	@Success		200				{object}	searchResponse
//	@Failure		400				{object}	map[string]string
//	@Failure		500				{object}	map[string]string
//	@Router			/api/kiwi/search [get]
func (h *Handlers) Search(c echo.Context) error {
	q := c.QueryParam("q")
	if q == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "q is required")
	}
	limit := search.NormalizeLimit(parseIntParam(c, "limit", 0))
	offset := search.NormalizeOffset(parseIntParam(c, "offset", 0))
	boost := c.QueryParam("boost")
	includeSuperseded := c.QueryParam("include_superseded") == "true"
	scope := c.QueryParam("scope")
	pathPrefix := c.QueryParam("pathPrefix")
	if pathPrefix == "" {
		pathPrefix = c.QueryParam("path_prefix")
	}
	var (
		results []search.Result
		err     error
	)
	switch {
	case includeSuperseded || scope != "":
		if os, ok := h.searcher.(search.OptionsSearcher); ok {
			results, err = os.SearchWithOptions(c.Request().Context(), q, limit, offset, pathPrefix, search.SearchOptions{
				IncludeSuperseded: includeSuperseded,
				Scope:             scope,
			})
		} else if scope == "" {
			results, err = h.searcher.Search(c.Request().Context(), q, limit, offset, pathPrefix)
		} else {
			return echo.NewHTTPError(http.StatusNotImplemented, "scope search requires sqlite search backend")
		}
	case h.searcher != nil:
		if ts, ok := h.searcher.(search.TrustSearcher); ok && boost != "none" && boost != "off" {
			results, err = ts.SearchBoosted(c.Request().Context(), q, limit, offset, pathPrefix)
		} else {
			results, err = h.searcher.Search(c.Request().Context(), q, limit, offset, pathPrefix)
		}
	}
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	if results == nil {
		results = []search.Result{}
	}
	if ma := c.QueryParam("modifiedAfter"); ma != "" {
		cutoff, perr := time.Parse(time.RFC3339, ma)
		if perr != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "invalid modifiedAfter: expected RFC3339 date")
		}
		{
			if df, ok := h.searcher.(search.DateFilterer); ok {
				paths := make([]string, len(results))
				for i, r := range results {
					paths[i] = r.Path
				}
				kept, ferr := df.FilterByDate(c.Request().Context(), paths, cutoff)
				if ferr == nil {
					keptSet := make(map[string]bool, len(kept))
					for _, p := range kept {
						keptSet[p] = true
					}
					filtered := results[:0]
					for _, r := range results {
						if keptSet[r.Path] {
							filtered = append(filtered, r)
						}
					}
					results = filtered
				} else {
					filtered := results[:0]
					for _, r := range results {
						info, serr := h.store.Stat(c.Request().Context(), r.Path)
						if serr == nil && info.ModTime.After(cutoff) {
							filtered = append(filtered, r)
						}
					}
					results = filtered
				}
			} else {
				filtered := results[:0]
				for _, r := range results {
					info, serr := h.store.Stat(c.Request().Context(), r.Path)
					if serr == nil && info.ModTime.After(cutoff) {
						filtered = append(filtered, r)
					}
				}
				results = filtered
			}
		}
	}
	// Record all search events (success and failure) for analytics v2.
	if recorder, ok := h.searcher.(search.SearchRecorder); ok {
		_ = recorder.RecordSearch(c.Request().Context(), q, "search", len(results) > 0)
	} else if len(results) == 0 {
		if recorder, ok := h.searcher.(search.FailedSearchRecorder); ok {
			_ = recorder.RecordFailedSearch(c.Request().Context(), q, "search")
		}
	}
	tracing.Record(c.Request().Context(), tracing.Event{Kind: tracing.KindSearch, Query: q, HitCount: len(results)})
	return c.JSON(http.StatusOK, h.buildSearchResponse(c, q, limit, offset, pathPrefix, results))
}

func (h *Handlers) buildSearchResponse(c echo.Context, q string, limit, offset int, pathPrefix string, results []search.Result) searchResponse {
	resp := searchResponse{
		Query:   q,
		Limit:   limit,
		Offset:  offset,
		Results: buildSearchEntries(results, h.publicURL),
	}
	if len(results) == 0 && offset == 0 {
		maxDist := parseIntParam(c, "suggest_threshold", search.DefaultSuggestMaxDistance)
		if maxDist <= 0 {
			maxDist = search.DefaultSuggestMaxDistance
		}
		if maxDist > search.MaxSuggestMaxDistance {
			maxDist = search.MaxSuggestMaxDistance
		}
		if sg, ok := h.searcher.(search.QuerySuggester); ok {
			suggestions, err := sg.SuggestTitles(c.Request().Context(), q, pathPrefix, maxDist, search.DefaultSuggestLimit)
			if err == nil && len(suggestions) > 0 {
				resp.Suggestions = make([]searchSuggestionEntry, len(suggestions))
				for i, s := range suggestions {
					resp.Suggestions[i] = searchSuggestionEntry{
						Query:    s.Query,
						Path:     s.Path,
						Title:    s.Title,
						Distance: s.Distance,
					}
				}
			}
		}
	}
	return resp
}

// VerifiedSearch godoc
//
//	@Summary		Verified full-text search
//	@Description	Performs a verified full-text search query on the repository using the SQLite search backend.
//	@Tags			search
//	@Security		BearerAuth
//	@Param			q		query		string	true	"Search query string"
//	@Param			limit	query		int		false	"Maximum number of search results to return (default: 15, max: 200)"
//	@Param			offset	query		int		false	"Number of search results to skip (offset) (default: 0)"
//	@Success		200		{object}	searchResponse
//	@Failure		400		{object}	map[string]string
//	@Failure		500		{object}	map[string]string
//	@Failure		501		{object}	map[string]string
//	@Router			/api/kiwi/search/verified [get]
func (h *Handlers) VerifiedSearch(c echo.Context) error {
	q := c.QueryParam("q")
	if q == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "q is required")
	}
	limit := search.NormalizeLimit(parseIntParam(c, "limit", 0))
	offset := search.NormalizeOffset(parseIntParam(c, "offset", 0))

	ts, ok := h.searcher.(search.TrustSearcher)
	if !ok {
		return echo.NewHTTPError(http.StatusNotImplemented, "verified search requires sqlite search backend")
	}
	results, err := ts.SearchVerified(c.Request().Context(), q, limit, offset, "")
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	if results == nil {
		results = []search.Result{}
	}
	if recorder, ok := h.searcher.(search.SearchRecorder); ok {
		_ = recorder.RecordSearch(c.Request().Context(), q, "verified", len(results) > 0)
	} else if len(results) == 0 {
		if recorder, ok := h.searcher.(search.FailedSearchRecorder); ok {
			_ = recorder.RecordFailedSearch(c.Request().Context(), q, "verified")
		}
	}
	tracing.Record(c.Request().Context(), tracing.Event{Kind: tracing.KindSearch, Query: q, HitCount: len(results)})
	return c.JSON(http.StatusOK, h.buildSearchResponse(c, q, limit, offset, "", results))
}

type staleResponse struct {
	StaleDays int                 `json:"staleDays"`
	Count     int                 `json:"count"`
	Results   []search.MetaResult `json:"results"`
}

// StalePages godoc
//
//	@Summary		Get stale pages
//	@Description	Returns pages that have not been modified for a given number of days.
//	@Tags			search
//	@Security		BearerAuth
//	@Param			days	query		int	false	"Number of days threshold for staleness (default 30)"
//	@Success		200		{object}	staleResponse
//	@Failure		500		{object}	map[string]string
//	@Failure		501		{object}	map[string]string
//	@Router			/api/kiwi/stale [get]
func (h *Handlers) StalePages(c echo.Context) error {
	sd, ok := h.searcher.(search.StaleDetector)
	if !ok {
		return echo.NewHTTPError(http.StatusNotImplemented, "stale detection requires sqlite search backend")
	}
	days := parseIntParam(c, "days", 30)
	if days <= 0 {
		days = 30
	}
	results, err := sd.StalePages(c.Request().Context(), days)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	if results == nil {
		results = []search.MetaResult{}
	}
	return c.JSON(http.StatusOK, staleResponse{
		StaleDays: days,
		Count:     len(results),
		Results:   results,
	})
}

type contradictionsResponse struct {
	Path  string   `json:"path"`
	Paths []string `json:"contradictions"`
}

// Contradictions godoc
//
//	@Summary		Find page contradictions
//	@Description	Finds pages that contradict the content of the specified page.
//	@Tags			search
//	@Security		BearerAuth
//	@Param			path	query		string	true	"Path of the file to check for contradictions (must start with '/')"
//	@Success		200		{object}	contradictionsResponse
//	@Failure		400		{object}	map[string]string
//	@Failure		500		{object}	map[string]string
//	@Failure		501		{object}	map[string]string
//	@Router			/api/kiwi/contradictions [get]
func (h *Handlers) Contradictions(c echo.Context) error {
	cd, ok := h.searcher.(search.ContradictionDetector)
	if !ok {
		return echo.NewHTTPError(http.StatusNotImplemented, "contradiction detection requires sqlite search backend")
	}
	path, err := requirePath(c)
	if err != nil {
		return err
	}
	paths, err := cd.FindContradictions(c.Request().Context(), path)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	if paths == nil {
		paths = []string{}
	}
	return c.JSON(http.StatusOK, contradictionsResponse{
		Path:  path,
		Paths: paths,
	})
}

type semanticRequest struct {
	Query         string `json:"query"`
	TopK          int    `json:"topK"`
	Offset        int    `json:"offset"`
	ModifiedAfter string `json:"modifiedAfter,omitempty"`
	Scope         string `json:"scope,omitempty"`
}

type semanticResponse struct {
	Query   string               `json:"query"`
	TopK    int                  `json:"topK"`
	Offset  int                  `json:"offset"`
	Results []vectorstore.Result `json:"results"`
}

// SemanticSearch godoc
//
//	@Summary		Semantic vector search
//	@Description	Performs a semantic/vector search using embeddings. Accepts query parameters or a JSON body.
//	@Tags			search
//	@Security		BearerAuth
//	@Accept			json
//	@Param			body	body		semanticRequest	false	"JSON body containing query, topK, offset, and modifiedAfter filters"
//	@Param			q		query		string			false	"Search query string (used if not provided in JSON body)"
//	@Param			topK	query		int				false	"Maximum number of search results to return (default: 10)"
//	@Param			offset	query		int				false	"Number of search results to skip (offset)"
//	@Param			scope	query		string			false	"Filter results to pages whose frontmatter scope exactly matches"
//	@Success		200		{object}	semanticResponse
//	@Failure		400		{object}	map[string]string
//	@Failure		500		{object}	map[string]string
//	@Failure		503		{object}	map[string]string
//	@Router			/api/kiwi/search/semantic [post]
func (h *Handlers) SemanticSearch(c echo.Context) error {
	if h.vectors == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "semantic search is not enabled")
	}
	req := semanticRequest{}
	if c.Request().Method == http.MethodPost {
		_ = c.Bind(&req)
	}
	if req.Query == "" {
		req.Query = c.QueryParam("q")
	}
	if req.TopK == 0 {
		req.TopK = parseIntParam(c, "topK", 0)
	}
	if req.Offset == 0 {
		req.Offset = parseIntParam(c, "offset", 0)
	}
	if req.Scope == "" {
		req.Scope = c.QueryParam("scope")
	}
	if req.Query == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "query is required")
	}
	topK := req.TopK
	if topK <= 0 {
		topK = vectorstore.DefaultTopK
	}
	offset := req.Offset
	if offset < 0 {
		offset = 0
	}
	searchLimit := topK + offset
	if req.Scope != "" && searchLimit < 200 {
		searchLimit = 200
	}
	results, err := h.vectors.Search(c.Request().Context(), req.Query, searchLimit)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	if req.Scope != "" {
		sf, ok := h.searcher.(search.ScopeFilterer)
		if !ok {
			return echo.NewHTTPError(http.StatusNotImplemented, "scope search requires sqlite search backend")
		}
		results, err = filterVectorResultsByScope(c.Request().Context(), sf, results, req.Scope)
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
		}
	}
	if offset >= len(results) {
		results = nil
	} else {
		results = results[offset:]
	}
	if len(results) > topK {
		results = results[:topK]
	}
	if ma := req.ModifiedAfter; ma != "" {
		cutoff, perr := time.Parse(time.RFC3339, ma)
		if perr != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "invalid modifiedAfter: expected RFC3339 date")
		}
		filtered := results[:0]
		for _, r := range results {
			info, serr := h.store.Stat(c.Request().Context(), r.Path)
			if serr == nil && info.ModTime.After(cutoff) {
				filtered = append(filtered, r)
			}
		}
		results = filtered
	}
	if results == nil {
		results = []vectorstore.Result{}
	}
	if recorder, ok := h.searcher.(search.SearchRecorder); ok {
		_ = recorder.RecordSearch(c.Request().Context(), req.Query, "semantic", len(results) > 0)
	} else if len(results) == 0 {
		if recorder, ok := h.searcher.(search.FailedSearchRecorder); ok {
			_ = recorder.RecordFailedSearch(c.Request().Context(), req.Query, "semantic")
		}
	}
	tracing.Record(c.Request().Context(), tracing.Event{Kind: tracing.KindSearch, Query: req.Query, HitCount: len(results), Detail: "semantic"})
	return c.JSON(http.StatusOK, semanticResponse{
		Query:   req.Query,
		TopK:    topK,
		Offset:  offset,
		Results: results,
	})
}

type metaQuerier interface {
	QueryMeta(ctx context.Context, filters []search.MetaFilter, sort, order string, limit, offset int) ([]search.MetaResult, error)
	QueryMetaOr(ctx context.Context, andFilters, orFilters []search.MetaFilter, sort, order string, limit, offset int) ([]search.MetaResult, error)
}

type metaResultEntry struct {
	Path        string         `json:"path"`
	Frontmatter map[string]any `json:"frontmatter"`
	Permalink   string         `json:"permalink,omitempty"`
}

type metaResponse struct {
	Count   int               `json:"count"`
	Limit   int               `json:"limit"`
	Offset  int               `json:"offset"`
	Results []metaResultEntry `json:"results"`
}

func filterVectorResultsByScope(ctx context.Context, sf search.ScopeFilterer, results []vectorstore.Result, scope string) ([]vectorstore.Result, error) {
	if scope == "" || len(results) == 0 {
		return results, nil
	}
	paths := make([]string, len(results))
	for i, result := range results {
		paths[i] = result.Path
	}
	kept, err := sf.FilterByScope(ctx, paths, scope)
	if err != nil {
		return nil, err
	}
	keep := make(map[string]bool, len(kept))
	for _, path := range kept {
		keep[path] = true
	}
	filtered := results[:0]
	for _, result := range results {
		if keep[result.Path] {
			filtered = append(filtered, result)
		}
	}
	return filtered, nil
}

// Meta godoc
//
//	@Summary		Query page metadata
//	@Description	Queries page metadata using filters, sorting, and pagination.
//	@Tags			search
//	@Security		BearerAuth
//	@Param			where	query		[]string	false	"AND filters in the format 'field operator value' (e.g. 'tags contains project')"
//	@Param			or		query		[]string	false	"OR filters in the format 'field operator value'"
//	@Param			sort	query		string		false	"Field to sort the results by"
//	@Param			order	query		string		false	"Sorting order ('asc' or 'desc')"
//	@Param			limit	query		int			false	"Maximum number of results to return"
//	@Param			offset	query		int			false	"Number of results to skip (offset)"
//	@Param			scope	query		string		false	"Filter results to pages whose frontmatter scope exactly matches"
//	@Success		200		{object}	metaResponse
//	@Failure		400		{object}	map[string]string
//	@Failure		501		{object}	map[string]string
//	@Router			/api/kiwi/meta [get]
func (h *Handlers) Meta(c echo.Context) error {
	mq, ok := h.searcher.(metaQuerier)
	if !ok {
		return echo.NewHTTPError(http.StatusNotImplemented, "metadata index requires sqlite search backend")
	}

	var andFilters []search.MetaFilter
	for _, raw := range c.QueryParams()["where"] {
		f, err := search.ParseMetaFilter(raw)
		if err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, err.Error())
		}
		andFilters = append(andFilters, f)
	}

	var orFilters []search.MetaFilter
	for _, raw := range c.QueryParams()["or"] {
		f, err := search.ParseMetaFilter(raw)
		if err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, err.Error())
		}
		orFilters = append(orFilters, f)
	}
	if scope := c.QueryParam("scope"); scope != "" {
		andFilters = append(andFilters, search.MetaFilter{Field: "$.scope", Op: "=", Value: scope})
	}

	sortField := c.QueryParam("sort")
	order := c.QueryParam("order")
	limit := parseIntParam(c, "limit", 0)
	offset := parseIntParam(c, "offset", 0)

	results, err := mq.QueryMetaOr(c.Request().Context(), andFilters, orFilters, sortField, order, limit, offset)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	entries := make([]metaResultEntry, len(results))
	for i, r := range results {
		entries[i] = metaResultEntry{
			Path:        r.Path,
			Frontmatter: r.Frontmatter,
			Permalink:   config.Permalink(h.publicURL, r.Path),
		}
	}
	return c.JSON(http.StatusOK, metaResponse{
		Count:   len(entries),
		Limit:   search.NormalizeLimit(limit),
		Offset:  search.NormalizeOffset(offset),
		Results: entries,
	})
}
