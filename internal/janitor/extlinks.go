package janitor

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// IssueExternalLinkRot flags an http(s) URL in a page that no longer answers
// with a successful response.
const IssueExternalLinkRot = "external-link-rot"

const (
	defaultExternalLinkTimeout     = 5 * time.Second
	defaultExternalLinkCacheTTL    = 24 * time.Hour
	defaultExternalLinkConcurrency = 10
	defaultExternalLinkDelay       = 100 * time.Millisecond
	maxExternalLinkRedirects       = 3
	externalLinkUserAgent          = "KiwiFS-LinkChecker/1.0"
	externalLinkCacheFile          = "link-check.json"
)

// ExternalLinkOptions configures the opt-in external link rot check.
type ExternalLinkOptions struct {
	Enabled bool
	// Timeout bounds each individual request. Defaults to 5s.
	Timeout time.Duration
	// Ignore lists hosts that are never probed. An entry matches the host
	// itself and any of its subdomains.
	Ignore []string
	// CacheTTL is how long a probe result is reused. Defaults to 24h.
	CacheTTL time.Duration

	// Concurrency caps in-flight requests (default 10). Delay spaces request
	// starts apart (default 100ms; negative disables pacing).
	Concurrency int
	Delay       time.Duration
}

// WithExternalLinks enables the external link rot check on the scanner.
func WithExternalLinks(o ExternalLinkOptions) Option {
	return func(s *Scanner) {
		if o.Enabled {
			cp := o
			s.externalLinks = &cp
		}
	}
}

// OptionsFromExternalLinks builds scanner options from the [janitor]
// external_link_* config.toml fields. It returns nil when the check is
// disabled. Unparseable or non-positive durations fall back to the defaults.
func OptionsFromExternalLinks(enabled bool, timeout string, ignore []string, cacheTTL string) []Option {
	if !enabled {
		return nil
	}
	return []Option{WithExternalLinks(ExternalLinkOptions{
		Enabled:  true,
		Timeout:  parsePositiveDuration(timeout),
		Ignore:   ignore,
		CacheTTL: parsePositiveDuration(cacheTTL),
	})}
}

func parsePositiveDuration(s string) time.Duration {
	d, err := time.ParseDuration(strings.TrimSpace(s))
	if err != nil || d <= 0 {
		return 0
	}
	return d
}

var (
	externalURLRe   = regexp.MustCompile(`https?://[^\s<>\[\]"'` + "`" + `]+`)
	inlineCodeRe    = regexp.MustCompile("`[^`\n]*`")
	fenceOpenRe     = regexp.MustCompile("^ {0,3}(`{3,}|~{3,})")
	trailingPunctRe = ".,;:!?*_"
)

// ExtractExternalURLs returns the unique http(s) URLs in a markdown body, in
// order of appearance. Fenced code blocks and inline code spans are skipped;
// pass the body without frontmatter.
func ExtractExternalURLs(body string) []string {
	var (
		out      []string
		seen     = map[string]bool{}
		fence    string
		inFenced bool
	)
	for _, line := range strings.Split(body, "\n") {
		if inFenced {
			t := strings.TrimSpace(line)
			if strings.HasPrefix(t, fence) && strings.Trim(t, fence[:1]) == "" {
				inFenced = false
			}
			continue
		}
		if m := fenceOpenRe.FindStringSubmatch(line); m != nil {
			fence, inFenced = m[1], true
			continue
		}
		line = inlineCodeRe.ReplaceAllString(line, " ")
		for _, raw := range externalURLRe.FindAllString(line, -1) {
			u := cleanURL(raw)
			if u == "" || seen[u] {
				continue
			}
			seen[u] = true
			out = append(out, u)
		}
	}
	return out
}

// cleanURL trims trailing sentence punctuation and unbalanced closing
// parentheses, so "(see https://a.com/x)." yields https://a.com/x while
// https://en.wikipedia.org/wiki/Foo_(bar) keeps its parenthesis.
func cleanURL(u string) string {
	for {
		trimmed := strings.TrimRight(u, trailingPunctRe)
		if strings.HasSuffix(trimmed, ")") && strings.Count(trimmed, ")") > strings.Count(trimmed, "(") {
			trimmed = trimmed[:len(trimmed)-1]
		}
		if trimmed == u {
			break
		}
		u = trimmed
	}
	if i := strings.IndexByte(u, '#'); i >= 0 {
		u = u[:i]
	}
	parsed, err := url.Parse(u)
	if err != nil || parsed.Hostname() == "" {
		return ""
	}
	return u
}

// linkResult is the outcome of probing one URL.
type linkResult struct {
	Status    int       `json:"status"`
	Error     string    `json:"error,omitempty"`
	CheckedAt time.Time `json:"checked_at"`
}

func (r linkResult) broken() bool { return r.Error != "" || r.Status >= 400 }

type linkChecker struct {
	opts   ExternalLinkOptions
	client *http.Client
	cache  map[string]linkResult
	mu     sync.Mutex // guards cache and next
	next   time.Time  // earliest start of the next request
}

func newLinkChecker(o ExternalLinkOptions, cache map[string]linkResult) *linkChecker {
	if o.Timeout <= 0 {
		o.Timeout = defaultExternalLinkTimeout
	}
	if o.CacheTTL <= 0 {
		o.CacheTTL = defaultExternalLinkCacheTTL
	}
	if o.Concurrency <= 0 {
		o.Concurrency = defaultExternalLinkConcurrency
	}
	switch {
	case o.Delay == 0:
		o.Delay = defaultExternalLinkDelay
	case o.Delay < 0:
		o.Delay = 0
	}
	rt := &http.Transport{
		Proxy:               http.ProxyFromEnvironment,
		DialContext:         (&net.Dialer{Timeout: o.Timeout}).DialContext,
		TLSClientConfig:     &tls.Config{MinVersion: tls.VersionTLS12},
		TLSHandshakeTimeout: o.Timeout,
		MaxIdleConnsPerHost: 2,
		DisableKeepAlives:   true,
	}
	c := &linkChecker{
		opts:  o,
		cache: cache,
		client: &http.Client{
			Transport: rt,
			Timeout:   o.Timeout,
			CheckRedirect: func(_ *http.Request, via []*http.Request) error {
				if len(via) > maxExternalLinkRedirects {
					return fmt.Errorf("stopped after %d redirects", maxExternalLinkRedirects)
				}
				return nil
			},
		},
	}
	if c.cache == nil {
		c.cache = map[string]linkResult{}
	}
	return c
}

func (c *linkChecker) ignored(rawURL string) bool {
	u, err := url.Parse(rawURL)
	if err != nil {
		return true
	}
	host := strings.ToLower(u.Hostname())
	for _, ig := range c.opts.Ignore {
		ig = strings.ToLower(strings.TrimSpace(ig))
		if ig == "" {
			continue
		}
		if host == ig || strings.HasSuffix(host, "."+ig) {
			return true
		}
	}
	return false
}

// checkAll probes every URL not already cached within the TTL and returns the
// result for each. At most Concurrency requests are in flight and request
// starts are spaced Delay apart. Results interrupted by ctx are omitted and
// never cached.
func (c *linkChecker) checkAll(ctx context.Context, urls []string) map[string]linkResult {
	results := make(map[string]linkResult, len(urls))
	var todo []string
	now := time.Now()
	for _, u := range urls {
		if r, ok := c.cache[u]; ok && now.Sub(r.CheckedAt) < c.opts.CacheTTL && !r.CheckedAt.After(now) {
			results[u] = r
			continue
		}
		todo = append(todo, u)
	}

	var (
		wg  sync.WaitGroup
		sem = make(chan struct{}, c.opts.Concurrency)
		rmu sync.Mutex
	)
	for _, u := range todo {
		select {
		case sem <- struct{}{}:
		case <-ctx.Done():
		}
		if ctx.Err() != nil {
			break
		}
		wg.Add(1)
		go func(u string) {
			defer wg.Done()
			defer func() { <-sem }()
			if !c.pace(ctx) {
				return
			}
			r, ok := c.probe(ctx, u)
			if !ok {
				return
			}
			c.mu.Lock()
			c.cache[u] = r
			c.mu.Unlock()
			rmu.Lock()
			results[u] = r
			rmu.Unlock()
		}(u)
	}
	wg.Wait()
	return results
}

// pace blocks until this request may start, spacing starts Delay apart across
// all workers. It reports false if ctx ended first.
func (c *linkChecker) pace(ctx context.Context) bool {
	if c.opts.Delay <= 0 {
		return ctx.Err() == nil
	}
	c.mu.Lock()
	start := c.next
	if now := time.Now(); start.Before(now) {
		start = now
	}
	c.next = start.Add(c.opts.Delay)
	c.mu.Unlock()

	t := time.NewTimer(time.Until(start))
	defer t.Stop()
	select {
	case <-t.C:
		return true
	case <-ctx.Done():
		return false
	}
}

// probe sends HEAD and, because many servers reject it, retries with a
// one-byte ranged GET whenever HEAD does not succeed. ok is false when ctx was
// cancelled mid-probe, in which case the result must not be recorded.
func (c *linkChecker) probe(ctx context.Context, u string) (res linkResult, ok bool) {
	status, err := c.do(ctx, http.MethodHead, u)
	if err != nil || status >= 400 {
		if ctx.Err() != nil {
			return linkResult{}, false
		}
		status, err = c.do(ctx, http.MethodGet, u)
		if ctx.Err() != nil {
			return linkResult{}, false
		}
	}
	res = linkResult{Status: status, CheckedAt: time.Now().UTC()}
	if err != nil {
		res.Status = 0
		res.Error = describeLinkError(err)
	}
	return res, true
}

func (c *linkChecker) do(ctx context.Context, method, u string) (int, error) {
	req, err := http.NewRequestWithContext(ctx, method, u, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("User-Agent", externalLinkUserAgent)
	if method == http.MethodGet {
		req.Header.Set("Range", "bytes=0-0")
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return 0, err
	}
	resp.Body.Close()
	return resp.StatusCode, nil
}

func describeLinkError(err error) string {
	var ue *url.Error
	if errors.As(err, &ue) {
		err = ue.Err
	}
	var ne net.Error
	if errors.As(err, &ne) && ne.Timeout() {
		return "request timed out"
	}
	return err.Error()
}

func linkCachePath(root string) string {
	return filepath.Join(root, ".kiwi", "cache", externalLinkCacheFile)
}

func loadLinkCache(root string) map[string]linkResult {
	data, err := os.ReadFile(linkCachePath(root))
	if err != nil {
		return nil
	}
	var m map[string]linkResult
	if json.Unmarshal(data, &m) != nil {
		return nil
	}
	return m
}

// saveLinkCache persists results for URLs still present in the workspace; a
// failure only costs re-probing next scan, so it is not reported.
func saveLinkCache(root string, cache map[string]linkResult, live map[string]bool) {
	pruned := make(map[string]linkResult, len(live))
	for u, r := range cache {
		if live[u] {
			pruned[u] = r
		}
	}
	data, err := json.Marshal(pruned)
	if err != nil {
		return
	}
	path := linkCachePath(root)
	if os.MkdirAll(filepath.Dir(path), 0o755) != nil {
		return
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), externalLinkCacheFile+".*")
	if err != nil {
		return
	}
	_, werr := tmp.Write(data)
	cerr := tmp.Close()
	if werr != nil || cerr != nil || os.Rename(tmp.Name(), path) != nil {
		os.Remove(tmp.Name())
	}
}

// checkExternalLinks probes every external URL referenced by pages and
// reports the ones that are dead.
func (s *Scanner) checkExternalLinks(ctx context.Context, pages []pageInfo) []Issue {
	if s.externalLinks == nil {
		return nil
	}
	checker := newLinkChecker(*s.externalLinks, loadLinkCache(s.root))

	pageURLs := make(map[string][]string, len(pages))
	live := map[string]bool{}
	var all []string
	for _, p := range pages {
		if !strings.HasSuffix(strings.ToLower(p.path), ".md") {
			continue
		}
		for _, u := range ExtractExternalURLs(p.bodyText) {
			if checker.ignored(u) {
				continue
			}
			pageURLs[p.path] = append(pageURLs[p.path], u)
			if !live[u] {
				live[u] = true
				all = append(all, u)
			}
		}
	}
	if len(all) == 0 {
		return nil
	}
	sort.Strings(all)

	results := checker.checkAll(ctx, all)
	saveLinkCache(s.root, checker.cache, live)

	var issues []Issue
	for _, p := range pages {
		for _, u := range pageURLs[p.path] {
			r, ok := results[u]
			if !ok || !r.broken() {
				continue
			}
			msg := fmt.Sprintf("%s returned HTTP %d", u, r.Status)
			if r.Error != "" {
				msg = fmt.Sprintf("%s is unreachable: %s", u, r.Error)
			}
			issues = append(issues, Issue{
				Kind:       IssueExternalLinkRot,
				Path:       p.path,
				Message:    msg,
				Related:    []string{u},
				Severity:   "warning",
				Suggestion: "update or remove the link, or add its host to [janitor] external_link_ignore",
			})
		}
	}
	return issues
}
