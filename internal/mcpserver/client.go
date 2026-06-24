package mcpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/kiwifs/kiwifs/internal/claims"
)

type RemoteBackend struct {
	base      string
	apiKey    string
	apiPrefix string
	client    *http.Client
}

func NewRemoteBackend(baseURL, apiKey, space string) *RemoteBackend {
	prefix := "/api/kiwi"
	if space != "" && space != "default" {
		prefix = "/api/kiwi/" + space
	}
	return &RemoteBackend{
		base:      strings.TrimRight(baseURL, "/"),
		apiKey:    apiKey,
		apiPrefix: prefix,
		client:    &http.Client{Timeout: 30 * time.Second},
	}
}

func (r *RemoteBackend) do(ctx context.Context, method, path string, body io.Reader, headers ...string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, r.base+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Actor", "mcp")
	if r.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+r.apiKey)
	}
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	resp, err := r.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("KiwiFS server at %s is not reachable: %w", r.base, err)
	}
	return resp, nil
}

type httpError struct {
	StatusCode int
	Message    string
}

func (e *httpError) Error() string {
	return fmt.Sprintf("%s (HTTP %d)", e.Message, e.StatusCode)
}

const maxResponseSize = 64 * 1024 * 1024 // 64 MiB

func (r *RemoteBackend) readBody(resp *http.Response) ([]byte, error) {
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseSize))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		msg := string(data)
		var errResp struct {
			Message string `json:"message"`
			Error   any    `json:"error"`
		}
		if json.Unmarshal(data, &errResp) == nil {
			if errResp.Message != "" {
				msg = errResp.Message
			} else if s, ok := errResp.Error.(string); ok && s != "" {
				msg = s
			}
		}
		return nil, &httpError{StatusCode: resp.StatusCode, Message: msg}
	}
	return data, nil
}

func (r *RemoteBackend) getJSON(ctx context.Context, path string, out any) error {
	resp, err := r.do(ctx, http.MethodGet, path, nil)
	if err != nil {
		return err
	}
	data, err := r.readBody(resp)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, out)
}

func (r *RemoteBackend) postJSON(ctx context.Context, path string, body, out any) error {
	data, err := json.Marshal(body)
	if err != nil {
		return err
	}
	resp, err := r.do(ctx, http.MethodPost, path, strings.NewReader(string(data)), "Content-Type", "application/json")
	if err != nil {
		return err
	}
	respData, err := r.readBody(resp)
	if err != nil {
		return err
	}
	if out != nil {
		return json.Unmarshal(respData, out)
	}
	return nil
}

func (r *RemoteBackend) Changes(ctx context.Context, since string, limit int) (*ChangesResult, error) {
	params := url.Values{}
	if since != "" {
		params.Set("since", since)
	}
	if limit > 0 {
		params.Set("limit", strconv.Itoa(limit))
	}
	var result ChangesResult
	if err := r.getJSON(ctx, r.apiPrefix+"/changes?"+params.Encode(), &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (r *RemoteBackend) ReadFile(ctx context.Context, path string) (string, string, error) {
	resp, err := r.do(ctx, http.MethodGet, r.apiPrefix+"/file?path="+url.QueryEscape(path), nil)
	if err != nil {
		return "", "", err
	}
	data, err := r.readBody(resp)
	if err != nil {
		return "", "", err
	}
	etag := strings.Trim(resp.Header.Get("ETag"), `"`)
	return string(data), etag, nil
}

func (r *RemoteBackend) WriteFile(ctx context.Context, path, content, actor, provenance string) (string, error) {
	hdrs := []string{"Content-Type", "text/markdown"}
	if actor != "" {
		hdrs = append(hdrs, "X-Actor", actor)
	}
	if provenance != "" {
		hdrs = append(hdrs, "X-Provenance", provenance)
	}
	resp, err := r.do(ctx, http.MethodPut, r.apiPrefix+"/file?path="+url.QueryEscape(path), strings.NewReader(content), hdrs...)
	if err != nil {
		return "", err
	}
	data, err := r.readBody(resp)
	if err != nil {
		return "", err
	}
	var result struct {
		ETag string `json:"etag"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return "", err
	}
	return result.ETag, nil
}

func (r *RemoteBackend) DeleteFile(ctx context.Context, path, actor string) error {
	var hdrs []string
	if actor != "" {
		hdrs = append(hdrs, "X-Actor", actor)
	}
	resp, err := r.do(ctx, http.MethodDelete, r.apiPrefix+"/file?path="+url.QueryEscape(path), nil, hdrs...)
	if err != nil {
		return err
	}
	_, err = r.readBody(resp)
	return err
}

func (r *RemoteBackend) Append(ctx context.Context, path, content, separator, actor string) (string, error) {
	q := r.apiPrefix + "/file/append?path=" + url.QueryEscape(path)
	if separator != "" && separator != "\n" {
		q += "&separator=" + url.QueryEscape(separator)
	}
	hdrs := []string{"Content-Type", "text/plain"}
	if actor != "" {
		hdrs = append(hdrs, "X-Actor", actor)
	}
	resp, err := r.do(ctx, http.MethodPost, q, strings.NewReader(content), hdrs...)
	if err != nil {
		return "", err
	}
	data, err := r.readBody(resp)
	if err != nil {
		return "", err
	}
	var result struct {
		ETag string `json:"etag"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return "", err
	}
	return result.ETag, nil
}

func (r *RemoteBackend) Rename(ctx context.Context, from, to, actor string) (string, error) {
	body := map[string]string{"from": from, "to": to}
	var result struct {
		ETag string `json:"etag"`
	}
	hdrs := []string{"Content-Type", "application/json"}
	if actor != "" {
		hdrs = append(hdrs, "X-Actor", actor)
	}
	if err := r.postJSON(ctx, r.apiPrefix+"/rename", body, &result); err != nil {
		return "", err
	}
	return result.ETag, nil
}

func (r *RemoteBackend) RenameWithLinks(ctx context.Context, from, to, actor string, updateLinks bool) (string, []string, error) {
	body := map[string]string{"from": from, "to": to}
	var result struct {
		ETag         string   `json:"etag"`
		UpdatedLinks []string `json:"updated_links"`
	}
	q := r.apiPrefix + "/rename"
	if !updateLinks {
		q += "?update_links=false"
	}
	if err := r.postJSON(ctx, q, body, &result); err != nil {
		return "", nil, err
	}
	return result.ETag, result.UpdatedLinks, nil
}

func (r *RemoteBackend) Tree(ctx context.Context, path string) (json.RawMessage, error) {
	q := r.apiPrefix + "/tree"
	if path != "" {
		q += "?path=" + url.QueryEscape(path)
	}
	var raw json.RawMessage
	if err := r.getJSON(ctx, q, &raw); err != nil {
		return nil, err
	}
	return raw, nil
}

func (r *RemoteBackend) Search(ctx context.Context, query string, limit, offset int, pathPrefix string) ([]SearchResult, error) {
	return r.SearchScoped(ctx, query, limit, offset, pathPrefix, "")
}

func (r *RemoteBackend) SearchScoped(ctx context.Context, query string, limit, offset int, pathPrefix, scope string) ([]SearchResult, error) {
	return r.searchFull(ctx, query, limit, offset, pathPrefix, scope, 0)
}

func (r *RemoteBackend) SearchWithRecency(ctx context.Context, query string, limit, offset int, pathPrefix string, recencyWeight float64) ([]SearchResult, error) {
	return r.searchFull(ctx, query, limit, offset, pathPrefix, "", recencyWeight)
}

func (r *RemoteBackend) searchFull(ctx context.Context, query string, limit, offset int, pathPrefix, scope string, recencyWeight float64) ([]SearchResult, error) {
	params := url.Values{}
	params.Set("q", query)
	if limit > 0 {
		params.Set("limit", strconv.Itoa(limit))
	}
	if offset > 0 {
		params.Set("offset", strconv.Itoa(offset))
	}
	if pathPrefix != "" {
		params.Set("pathPrefix", pathPrefix)
	}
	if scope != "" {
		params.Set("scope", scope)
	}
	if recencyWeight > 0 {
		params.Set("recency_weight", strconv.FormatFloat(recencyWeight, 'f', -1, 64))
	}
	var result struct {
		Results []SearchResult `json:"results"`
	}
	if err := r.getJSON(ctx, r.apiPrefix+"/search?"+params.Encode(), &result); err != nil {
		return nil, err
	}
	for i := range result.Results {
		result.Results[i].Snippet = stripMarkTags(result.Results[i].Snippet)
	}
	return result.Results, nil
}

func (r *RemoteBackend) SearchSemantic(ctx context.Context, query string, limit int) ([]SearchResult, error) {
	return r.SearchSemanticScoped(ctx, query, limit, "")
}

func (r *RemoteBackend) SearchSemanticScoped(ctx context.Context, query string, limit int, scope string) ([]SearchResult, error) {
	var result struct {
		Results []struct {
			Path  string  `json:"path"`
			Chunk string  `json:"chunk"`
			Score float32 `json:"score"`
		} `json:"results"`
	}
	body := map[string]any{"query": query, "topK": limit}
	if scope != "" {
		body["scope"] = scope
	}
	if err := r.postJSON(ctx, r.apiPrefix+"/search/semantic", body, &result); err != nil {
		return nil, err
	}
	out := make([]SearchResult, len(result.Results))
	for i, sr := range result.Results {
		out[i] = SearchResult{Path: sr.Path, Snippet: sr.Chunk, Score: float64(sr.Score)}
	}
	return out, nil
}

func (r *RemoteBackend) Recall(ctx context.Context, params RecallParams) ([]RecallResult, error) {
	var result struct {
		Results []RecallResult `json:"results"`
	}
	body := map[string]any{
		"query": params.Query,
	}
	if params.Limit > 0 {
		body["limit"] = params.Limit
	}
	if len(params.Sources) > 0 {
		body["sources"] = params.Sources
	}
	if params.Scope != "" {
		body["scope"] = params.Scope
	}
	if params.BoostVerified {
		body["boost_verified"] = true
	}
	if params.K > 0 {
		body["k"] = params.K
	}
	if params.PathPrefix != "" {
		body["path_prefix"] = params.PathPrefix
	}
	if err := r.postJSON(ctx, r.apiPrefix+"/recall", body, &result); err != nil {
		return nil, err
	}
	for i := range result.Results {
		result.Results[i].Snippet = stripMarkTags(result.Results[i].Snippet)
	}
	return result.Results, nil
}

func (r *RemoteBackend) QueryMeta(ctx context.Context, filters []string, sort, order string, limit, offset int) ([]MetaResult, error) {
	return r.QueryMetaOr(ctx, filters, nil, sort, order, limit, offset)
}

func (r *RemoteBackend) QueryMetaOr(ctx context.Context, andFilters, orFilters []string, sort, order string, limit, offset int, paths ...string) ([]MetaResult, error) {
	params := url.Values{}
	for _, f := range andFilters {
		params.Add("where", f)
	}
	for _, f := range orFilters {
		params.Add("or", f)
	}
	for _, p := range paths {
		params.Add("path", p)
	}
	if sort != "" {
		params.Set("sort", sort)
	}
	if order != "" {
		params.Set("order", order)
	}
	if limit > 0 {
		params.Set("limit", strconv.Itoa(limit))
	}
	if offset > 0 {
		params.Set("offset", strconv.Itoa(offset))
	}
	var result struct {
		Results []MetaResult `json:"results"`
	}
	if err := r.getJSON(ctx, r.apiPrefix+"/meta?"+params.Encode(), &result); err != nil {
		return nil, err
	}
	return result.Results, nil
}

func (r *RemoteBackend) ViewRefresh(ctx context.Context, path string) (bool, error) {
	var result struct {
		Status string `json:"status"`
	}
	if err := r.postJSON(ctx, r.apiPrefix+"/view/refresh", map[string]string{"path": path}, &result); err != nil {
		return false, err
	}
	return result.Status == "regenerated", nil
}

func (r *RemoteBackend) QueryDQL(ctx context.Context, dql string, limit, offset int) (*QueryResult, error) {
	q := r.apiPrefix + "/query?q=" + url.QueryEscape(dql)
	if limit > 0 {
		q += "&limit=" + strconv.Itoa(limit)
	}
	if offset > 0 {
		q += "&offset=" + strconv.Itoa(offset)
	}
	var result QueryResult
	if err := r.getJSON(ctx, q, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (r *RemoteBackend) Versions(ctx context.Context, path string) ([]Version, error) {
	var result struct {
		Versions []Version `json:"versions"`
	}
	if err := r.getJSON(ctx, r.apiPrefix+"/versions?path="+url.QueryEscape(path), &result); err != nil {
		return nil, err
	}
	return result.Versions, nil
}

func (r *RemoteBackend) BulkWrite(ctx context.Context, files []BulkFile, actor, provenance string) (map[string]string, error) {
	type reqFile struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	req := struct {
		Files []reqFile `json:"files"`
		Actor string    `json:"actor,omitempty"`
	}{
		Actor: actor,
	}
	for _, f := range files {
		req.Files = append(req.Files, reqFile{Path: f.Path, Content: f.Content})
	}
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal bulk request: %w", err)
	}
	hdrs := []string{"Content-Type", "application/json"}
	if provenance != "" {
		hdrs = append(hdrs, "X-Provenance", provenance)
	}
	resp, err := r.do(ctx, http.MethodPost, r.apiPrefix+"/bulk", strings.NewReader(string(body)), hdrs...)
	if err != nil {
		return nil, err
	}
	data, err := r.readBody(resp)
	if err != nil {
		return nil, err
	}
	var result struct {
		ETags map[string]string `json:"etags"`
	}
	if json.Unmarshal(data, &result) == nil && len(result.ETags) > 0 {
		return result.ETags, nil
	}
	if err := json.Unmarshal(data, &result); err != nil {
		stderr.Printf("bulk write response parse warning: %v", err)
	}
	return map[string]string{}, nil
}

func (r *RemoteBackend) Aggregate(ctx context.Context, groupBy, calc, where, pathPrefix string) (map[string]map[string]any, error) {
	params := url.Values{}
	params.Set("group_by", groupBy)
	if calc != "" {
		params.Set("calc", calc)
	}
	if where != "" {
		params.Add("where", where)
	}
	if pathPrefix != "" {
		params.Set("path_prefix", pathPrefix)
	}
	var result struct {
		Groups map[string]map[string]any `json:"groups"`
	}
	if err := r.getJSON(ctx, r.apiPrefix+"/query/aggregate?"+params.Encode(), &result); err != nil {
		return nil, err
	}
	return result.Groups, nil
}

func (r *RemoteBackend) Analytics(ctx context.Context, scope string, staleThreshold int) (json.RawMessage, error) {
	params := url.Values{}
	if scope != "" {
		params.Set("scope", scope)
	}
	if staleThreshold > 0 {
		params.Set("stale_threshold", strconv.Itoa(staleThreshold))
	}
	var raw json.RawMessage
	if err := r.getJSON(ctx, r.apiPrefix+"/analytics?"+params.Encode(), &raw); err != nil {
		return nil, err
	}
	return raw, nil
}

func (r *RemoteBackend) MemoryReport(ctx context.Context, episodesPrefix string, limit, offset int) (json.RawMessage, error) {
	params := url.Values{}
	if episodesPrefix != "" {
		params.Set("episodes_prefix", episodesPrefix)
	}
	if limit > 0 {
		params.Set("limit", strconv.Itoa(limit))
	}
	if offset > 0 {
		params.Set("offset", strconv.Itoa(offset))
	}
	path := r.apiPrefix + "/memory/report"
	if enc := params.Encode(); enc != "" {
		path += "?" + enc
	}
	var raw json.RawMessage
	if err := r.getJSON(ctx, path, &raw); err != nil {
		return nil, err
	}
	return raw, nil
}

func (r *RemoteBackend) HealthCheckPage(ctx context.Context, path string) (json.RawMessage, error) {
	var raw json.RawMessage
	if err := r.getJSON(ctx, r.apiPrefix+"/health-check?path="+url.QueryEscape(path), &raw); err != nil {
		return nil, err
	}
	return raw, nil
}

func (r *RemoteBackend) Backlinks(ctx context.Context, path string) ([]Backlink, error) {
	var result struct {
		Backlinks []Backlink `json:"backlinks"`
	}
	if err := r.getJSON(ctx, r.apiPrefix+"/backlinks?path="+url.QueryEscape(path), &result); err != nil {
		return nil, err
	}
	return result.Backlinks, nil
}

func (r *RemoteBackend) PublicURL() string { return "" }

func (r *RemoteBackend) ResolveWikiLinks(ctx context.Context, content string) string {
	var result struct {
		Content string `json:"content"`
	}
	if err := r.postJSON(ctx, r.apiPrefix+"/resolve-links", map[string]string{"content": content}, &result); err != nil {
		return content
	}
	if result.Content != "" {
		return result.Content
	}
	return content
}

func (r *RemoteBackend) Context(ctx context.Context) (string, string, string, string, error) {
	var result struct {
		Schema   string `json:"schema"`
		Playbook string `json:"playbook"`
		Index    string `json:"index"`
		Rules    string `json:"rules"`
	}
	if err := r.getJSON(ctx, r.apiPrefix+"/context", &result); err != nil {
		return "", "", "", "", err
	}
	return result.Schema, result.Playbook, result.Index, result.Rules, nil
}

func (r *RemoteBackend) Clip(ctx context.Context, url, title string, tags []string, folder string) (*ClipResultMCP, error) {
	body := map[string]any{
		"url": url,
	}
	if title != "" {
		body["title"] = title
	}
	if len(tags) > 0 {
		body["tags"] = tags
	}
	if folder != "" {
		body["folder"] = folder
	}

	var result ClipResultMCP
	if err := r.postJSON(ctx, r.apiPrefix+"/clip", body, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (r *RemoteBackend) Health(ctx context.Context) error {
	return r.getJSON(ctx, "/health", &json.RawMessage{})
}

func (r *RemoteBackend) Close() error { return nil }

func (r *RemoteBackend) Suggestions(ctx context.Context, path string, limit int) ([]SuggestionResult, error) {
	q := fmt.Sprintf("%s/suggestions?path=%s&limit=%d", r.apiPrefix, url.QueryEscape(path), limit)
	var result struct {
		Suggestions []SuggestionResult `json:"suggestions"`
	}
	if err := r.getJSON(ctx, q, &result); err != nil {
		return nil, err
	}
	return result.Suggestions, nil
}

func (r *RemoteBackend) Embeddings(ctx context.Context, path string) (*EmbeddingsResult, error) {
	q := fmt.Sprintf("%s/embeddings?path=%s", r.apiPrefix, url.QueryEscape(path))
	var result EmbeddingsResult
	if err := r.getJSON(ctx, q, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (r *RemoteBackend) GraphAnalytics(ctx context.Context, limit int) (*GraphAnalyticsResult, error) {
	q := fmt.Sprintf("%s/graph/analytics?limit=%d", r.apiPrefix, limit)
	var result GraphAnalyticsResult
	if err := r.getJSON(ctx, q, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (r *RemoteBackend) GraphCentrality(ctx context.Context, limit int) (*GraphCentralityResult, error) {
	q := fmt.Sprintf("%s/graph/centrality?limit=%d", r.apiPrefix, limit)
	var result GraphCentralityResult
	if err := r.getJSON(ctx, q, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (r *RemoteBackend) GraphCommunities(ctx context.Context) (*GraphCommunitiesResult, error) {
	var result GraphCommunitiesResult
	if err := r.getJSON(ctx, r.apiPrefix+"/graph/communities", &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (r *RemoteBackend) GraphPath(ctx context.Context, from, to string) (*GraphPathResult, error) {
	q := fmt.Sprintf("%s/graph/path?from=%s&to=%s", r.apiPrefix, url.QueryEscape(from), url.QueryEscape(to))
	var result GraphPathResult
	if err := r.getJSON(ctx, q, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (r *RemoteBackend) Peek(ctx context.Context, path string) (*PeekResult, error) {
	var result PeekResult
	if err := r.getJSON(ctx, r.apiPrefix+"/peek?path="+url.QueryEscape(path), &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (r *RemoteBackend) Section(ctx context.Context, path, heading string, index int) (*SectionResult, error) {
	q := r.apiPrefix + "/section?path=" + url.QueryEscape(path)
	if heading != "" {
		q += "&heading=" + url.QueryEscape(heading)
	} else {
		q += "&index=" + strconv.Itoa(index)
	}
	var result SectionResult
	if err := r.getJSON(ctx, q, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (r *RemoteBackend) GraphWalk(ctx context.Context, path string, includeSiblings bool) (*GraphWalkResult, error) {
	q := fmt.Sprintf("%s/graph/walk?path=%s&include_siblings=%t", r.apiPrefix, url.QueryEscape(path), includeSiblings)
	var result GraphWalkResult
	if err := r.getJSON(ctx, q, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (r *RemoteBackend) Velocity(ctx context.Context, period string, limit int, pathPrefix string) (*VelocityResult, error) {
	q := fmt.Sprintf("%s/velocity?period=%s&limit=%d", r.apiPrefix, url.QueryEscape(period), limit)
	if pathPrefix != "" {
		q += "&path_prefix=" + url.QueryEscape(pathPrefix)
	}
	var result VelocityResult
	if err := r.getJSON(ctx, q, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (r *RemoteBackend) Timeline(ctx context.Context, limit, offset int, actor, eventType, pathPrefix string) (*TimelineResult, error) {
	q := fmt.Sprintf("%s/timeline?limit=%d&offset=%d", r.apiPrefix, limit, offset)
	if actor != "" {
		q += "&actor=" + url.QueryEscape(actor)
	}
	if eventType != "" {
		q += "&type=" + url.QueryEscape(eventType)
	}
	if pathPrefix != "" {
		q += "&path_prefix=" + url.QueryEscape(pathPrefix)
	}
	var result TimelineResult
	if err := r.getJSON(ctx, q, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (r *RemoteBackend) Eval(ctx context.Context, queries []EvalQuery) (*EvalResult, error) {
	var result EvalResult
	if err := r.postJSON(ctx, r.apiPrefix+"/eval", map[string]any{"queries": queries}, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (r *RemoteBackend) Eligible(ctx context.Context, limit int, pathPrefix string) (*QueryResult, error) {
	dql := fmt.Sprintf(
		`TABLE _path, title, priority, assignee WHERE type = "task" AND status = "todo" AND _blocked = false SORT priority ASC, _updated ASC LIMIT %d`,
		limit)
	if pathPrefix != "" {
		pathPrefix = sanitizePathPrefix(pathPrefix)
		dql = fmt.Sprintf(
			`TABLE _path, title, priority, assignee WHERE type = "task" AND status = "todo" AND _blocked = false AND _path LIKE "%s%%" SORT priority ASC, _updated ASC LIMIT %d`,
			pathPrefix, limit)
	}
	var result QueryResult
	q := fmt.Sprintf("%s/query?q=%s&limit=%d", r.apiPrefix, url.QueryEscape(dql), limit)
	if err := r.getJSON(ctx, q, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (r *RemoteBackend) Claim(ctx context.Context, path, claimedBy string, leaseDuration time.Duration) (*claims.Claim, error) {
	body := map[string]any{
		"path":           path,
		"lease_duration": leaseDuration.String(),
	}
	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	resp, err := r.do(ctx, http.MethodPost, r.apiPrefix+"/claim",
		strings.NewReader(string(data)), "Content-Type", "application/json", "X-Actor", claimedBy)
	if err != nil {
		return nil, err
	}
	respData, err := r.readBody(resp)
	if err != nil {
		return nil, err
	}
	var result claims.Claim
	return &result, json.Unmarshal(respData, &result)
}

func (r *RemoteBackend) Release(ctx context.Context, path, claimedBy string) error {
	body := map[string]any{"path": path}
	data, err := json.Marshal(body)
	if err != nil {
		return err
	}
	resp, err := r.do(ctx, http.MethodDelete, r.apiPrefix+"/claim",
		strings.NewReader(string(data)), "Content-Type", "application/json", "X-Actor", claimedBy)
	if err != nil {
		return err
	}
	_, err = r.readBody(resp)
	return err
}

func (r *RemoteBackend) ListClaims(ctx context.Context) ([]claims.Claim, error) {
	var result struct {
		Claims []claims.Claim `json:"claims"`
	}
	if err := r.getJSON(ctx, r.apiPrefix+"/claims", &result); err != nil {
		return nil, err
	}
	return result.Claims, nil
}

func (r *RemoteBackend) ViewsList(ctx context.Context) ([]ViewInfo, error) {
	var result struct {
		Views []ViewInfo `json:"views"`
	}
	if err := r.getJSON(ctx, r.apiPrefix+"/views", &result); err != nil {
		return nil, err
	}
	return result.Views, nil
}

func (r *RemoteBackend) ViewsGet(ctx context.Context, name string) (*ViewInfo, error) {
	var view ViewInfo
	if err := r.getJSON(ctx, r.apiPrefix+"/views/"+url.PathEscape(name), &view); err != nil {
		return nil, err
	}
	return &view, nil
}

func (r *RemoteBackend) ViewsSave(ctx context.Context, view ViewInfo) error {
	body, err := json.Marshal(view)
	if err != nil {
		return err
	}
	resp, err := r.do(ctx, http.MethodPut, r.apiPrefix+"/views/"+url.PathEscape(view.Name),
		strings.NewReader(string(body)), "Content-Type", "application/json")
	if err != nil {
		return err
	}
	_, err = r.readBody(resp)
	return err
}

func (r *RemoteBackend) ViewsDelete(ctx context.Context, name string) error {
	resp, err := r.do(ctx, http.MethodDelete, r.apiPrefix+"/views/"+url.PathEscape(name), nil)
	if err != nil {
		return err
	}
	_, err = r.readBody(resp)
	return err
}

func (r *RemoteBackend) ViewsExecute(ctx context.Context, name string, limit, offset int) (*QueryResult, error) {
	q := fmt.Sprintf("%s/views/%s/execute?limit=%d&offset=%d", r.apiPrefix, url.PathEscape(name), limit, offset)
	var result QueryResult
	if err := r.getJSON(ctx, q, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (r *RemoteBackend) Feed(ctx context.Context, limit int) (json.RawMessage, error) {
	q := fmt.Sprintf("%s/feed.json?limit=%d", r.apiPrefix, limit)
	var raw json.RawMessage
	if err := r.getJSON(ctx, q, &raw); err != nil {
		return nil, err
	}
	return raw, nil
}

func (r *RemoteBackend) CanvasList(ctx context.Context) ([]string, error) {
	var result struct {
		Canvases []string `json:"canvases"`
	}
	if err := r.getJSON(ctx, r.apiPrefix+"/canvases", &result); err != nil {
		return nil, err
	}
	return result.Canvases, nil
}

func (r *RemoteBackend) CanvasRead(ctx context.Context, path string) (string, error) {
	resp, err := r.do(ctx, http.MethodGet, r.apiPrefix+"/canvas?path="+url.QueryEscape(path), nil)
	if err != nil {
		return "", err
	}
	body, err := r.readBody(resp)
	if err != nil {
		return "", err
	}
	return string(body), nil
}

func (r *RemoteBackend) CanvasWrite(ctx context.Context, path, content, actor string) (string, error) {
	resp, err := r.do(ctx, http.MethodPut, r.apiPrefix+"/canvas?path="+url.QueryEscape(path),
		strings.NewReader(content), "Content-Type", "application/json", "X-Actor", actor)
	if err != nil {
		return "", err
	}
	body, err := r.readBody(resp)
	if err != nil {
		return "", err
	}
	var result struct {
		ETag string `json:"etag"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", err
	}
	return result.ETag, nil
}

func (r *RemoteBackend) WorkflowList(ctx context.Context) ([]WorkflowDef, error) {
	var result struct {
		Workflows []WorkflowDef `json:"workflows"`
	}
	if err := r.getJSON(ctx, r.apiPrefix+"/workflows", &result); err != nil {
		return nil, err
	}
	return result.Workflows, nil
}

func (r *RemoteBackend) WorkflowGet(ctx context.Context, name string) (*WorkflowDef, error) {
	var w WorkflowDef
	if err := r.getJSON(ctx, r.apiPrefix+"/workflows/"+url.PathEscape(name), &w); err != nil {
		return nil, err
	}
	return &w, nil
}

func (r *RemoteBackend) WorkflowSave(ctx context.Context, w WorkflowDef) error {
	body, err := json.Marshal(w)
	if err != nil {
		return err
	}
	resp, err := r.do(ctx, http.MethodPut, r.apiPrefix+"/workflows/"+url.PathEscape(w.Name),
		strings.NewReader(string(body)), "Content-Type", "application/json")
	if err != nil {
		return err
	}
	_, err = r.readBody(resp)
	return err
}

func (r *RemoteBackend) WorkflowAdvance(ctx context.Context, path, targetState, actor string) (*WorkflowAdvanceResult, error) {
	body, _ := json.Marshal(map[string]string{
		"path":         path,
		"target_state": targetState,
		"actor":        actor,
	})
	resp, err := r.do(ctx, http.MethodPost, r.apiPrefix+"/workflow/advance",
		strings.NewReader(string(body)), "Content-Type", "application/json")
	if err != nil {
		return nil, err
	}
	raw, err := r.readBody(resp)
	if err != nil {
		return nil, err
	}
	var result WorkflowAdvanceResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (r *RemoteBackend) WorkflowBoard(ctx context.Context, workflowName string) (*WorkflowBoardResult, error) {
	var result WorkflowBoardResult
	if err := r.getJSON(ctx, r.apiPrefix+"/workflow/board/"+url.PathEscape(workflowName), &result); err != nil {
		return nil, err
	}
	return &result, nil
}
