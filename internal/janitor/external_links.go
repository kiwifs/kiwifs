package janitor

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/kiwifs/kiwifs/internal/config"
	"github.com/kiwifs/kiwifs/internal/markdown"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
)

const externalLinkRotRule = "external-link-rot"

// ExternalLinkFinding is one broken or unhealthy external URL in markdown content.
type ExternalLinkFinding struct {
	Path   string `json:"path"`
	URL    string `json:"url"`
	Status int    `json:"status"`
	Rule   string `json:"rule"`
}

type linkCacheEntry struct {
	Status    int       `json:"status"`
	CheckedAt time.Time `json:"checked_at"`
	Error     string    `json:"error,omitempty"`
}

type linkCacheFile struct {
	Entries map[string]linkCacheEntry `json:"entries"`
}

// ExternalLinkChecker validates http(s) URLs referenced in markdown bodies.
type ExternalLinkChecker struct {
	root          string
	cfg           config.ExternalLinkCheckConfig
	client        *http.Client
	cachePath     string
	mu            sync.Mutex
	cache         linkCacheFile
	onRefreshDone func([]ExternalLinkFinding)
}

var externalURLRe = regexp.MustCompile(`https?://[^\s\)<>"\]]+`)

func newExternalLinkChecker(root string, cfg config.ExternalLinkCheckConfig) *ExternalLinkChecker {
	if cfg.MaxConcurrent <= 0 {
		cfg.MaxConcurrent = 10
	}
	if cfg.RequestDelay <= 0 {
		cfg.RequestDelay = 100 * time.Millisecond
	}
	if cfg.MaxRedirects <= 0 {
		cfg.MaxRedirects = 3
	}
	if cfg.UserAgent == "" {
		cfg.UserAgent = "KiwiFS-LinkChecker/1.0"
	}
	if cfg.CacheTTL <= 0 {
		cfg.CacheTTL = 24 * time.Hour
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 5 * time.Second
	}

	c := &ExternalLinkChecker{
		root:      root,
		cfg:       cfg,
		cachePath: filepath.Join(root, ".kiwi", "cache", "link-check.json"),
		cache: linkCacheFile{
			Entries: make(map[string]linkCacheEntry),
		},
	}
	c.client = &http.Client{
		Timeout: cfg.Timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= cfg.MaxRedirects {
				return fmt.Errorf("stopped after %d redirects", cfg.MaxRedirects)
			}
			return nil
		},
	}
	c.loadCache()
	return c
}

// Enabled reports whether external link checking is active.
func (c *ExternalLinkChecker) Enabled() bool {
	return c != nil && c.cfg.Enabled()
}

// SetRefreshCallback is invoked after a background refresh completes (scheduler use).
func (c *ExternalLinkChecker) SetRefreshCallback(fn func([]ExternalLinkFinding)) {
	if c == nil {
		return
	}
	c.onRefreshDone = fn
}

func (c *ExternalLinkChecker) loadCache() {
	if c == nil {
		return
	}
	data, err := os.ReadFile(c.cachePath)
	if err != nil {
		return
	}
	var file linkCacheFile
	if err := json.Unmarshal(data, &file); err != nil {
		return
	}
	if file.Entries == nil {
		file.Entries = make(map[string]linkCacheEntry)
	}
	c.cache = file
}

func (c *ExternalLinkChecker) saveCache() error {
	if c == nil {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(c.cachePath), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(c.cache, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(c.cachePath, data, 0o644)
}

func (c *ExternalLinkChecker) cacheFresh(u string, now time.Time) (linkCacheEntry, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	ent, ok := c.cache.Entries[u]
	if !ok {
		return linkCacheEntry{}, false
	}
	if now.Sub(ent.CheckedAt) > c.cfg.CacheTTL {
		return linkCacheEntry{}, false
	}
	return ent, true
}

func (c *ExternalLinkChecker) putCache(u string, ent linkCacheEntry) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cache.Entries == nil {
		c.cache.Entries = make(map[string]linkCacheEntry)
	}
	c.cache.Entries[u] = ent
}

// FindingsFromCache returns cached broken links without network I/O.
func (c *ExternalLinkChecker) FindingsFromCache(pages []pageInfo) []ExternalLinkFinding {
	if !c.Enabled() {
		return nil
	}
	now := time.Now()
	var findings []ExternalLinkFinding
	seen := make(map[string]struct{})
	for _, p := range pages {
		for _, rawURL := range extractExternalURLs(p.content) {
			if c.shouldIgnore(rawURL) {
				continue
			}
			key := p.path + "\x00" + rawURL
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			ent, fresh := c.cacheFresh(rawURL, now)
			if !fresh {
				continue
			}
			if isBrokenStatus(ent.Status) {
				findings = append(findings, ExternalLinkFinding{
					Path:   p.path,
					URL:    rawURL,
					Status: ent.Status,
					Rule:   externalLinkRotRule,
				})
			}
		}
	}
	return findings
}

// CheckPages checks all external URLs and returns broken links. When Background
// is set, returns cached findings immediately and refreshes asynchronously.
func (c *ExternalLinkChecker) CheckPages(ctx context.Context, pages []pageInfo) []ExternalLinkFinding {
	if !c.Enabled() {
		return nil
	}
	if c.cfg.Background {
		findings := c.FindingsFromCache(pages)
		go c.refresh(context.Background(), pages)
		return findings
	}
	return c.refresh(ctx, pages)
}

func (c *ExternalLinkChecker) refresh(ctx context.Context, pages []pageInfo) []ExternalLinkFinding {
	type pageURL struct {
		path string
		url  string
	}
	var jobs []pageURL
	seen := make(map[string]struct{})
	now := time.Now()

	for _, p := range pages {
		for _, rawURL := range extractExternalURLs(p.content) {
			if c.shouldIgnore(rawURL) {
				continue
			}
			key := p.path + "\x00" + rawURL
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			if _, fresh := c.cacheFresh(rawURL, now); fresh {
				continue
			}
			jobs = append(jobs, pageURL{path: p.path, url: rawURL})
		}
	}

	uniqueURLs := make(map[string]struct{})
	for _, job := range jobs {
		uniqueURLs[job.url] = struct{}{}
	}

	statusByURL := c.checkURLs(ctx, keys(uniqueURLs))
	for u, status := range statusByURL {
		c.putCache(u, linkCacheEntry{
			Status:    status,
			CheckedAt: time.Now(),
		})
	}
	_ = c.saveCache()

	findings := c.FindingsFromCache(pages)

	if c.onRefreshDone != nil {
		c.onRefreshDone(findings)
	}
	return findings
}

func keys(m map[string]struct{}) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

func (c *ExternalLinkChecker) checkURLs(ctx context.Context, urls []string) map[string]int {
	out := make(map[string]int, len(urls))
	if len(urls) == 0 {
		return out
	}

	sem := make(chan struct{}, c.cfg.MaxConcurrent)
	var wg sync.WaitGroup
	var mu sync.Mutex

	for _, raw := range urls {
		raw := raw
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
			case <-ctx.Done():
				return
			}
			defer func() { <-sem }()

			time.Sleep(c.cfg.RequestDelay)

			status, err := c.probeURL(ctx, raw)
			mu.Lock()
			if err != nil {
				out[raw] = 0
				c.putCache(raw, linkCacheEntry{
					Status:    0,
					CheckedAt: time.Now(),
					Error:     err.Error(),
				})
			} else {
				out[raw] = status
			}
			mu.Unlock()
		}()
	}
	wg.Wait()
	return out
}

func (c *ExternalLinkChecker) probeURL(ctx context.Context, raw string) (int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, raw, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("User-Agent", c.cfg.UserAgent)

	resp, err := c.client.Do(req)
	if err != nil {
		return 0, err
	}
	resp.Body.Close()

	if resp.StatusCode == http.StatusMethodNotAllowed || resp.StatusCode == http.StatusNotImplemented {
		return c.probeURLGet(ctx, raw)
	}
	return resp.StatusCode, nil
}

func (c *ExternalLinkChecker) probeURLGet(ctx context.Context, raw string) (int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("User-Agent", c.cfg.UserAgent)
	req.Header.Set("Range", "bytes=0-0")

	resp, err := c.client.Do(req)
	if err != nil {
		return 0, err
	}
	resp.Body.Close()
	return resp.StatusCode, nil
}

func isBrokenStatus(status int) bool {
	return status >= 400 && status < 600
}

func (c *ExternalLinkChecker) shouldIgnore(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil {
		return true
	}
	host := strings.ToLower(strings.TrimSpace(u.Hostname()))
	if host == "" {
		return true
	}
	for _, pattern := range c.cfg.IgnoreHosts {
		pattern = strings.ToLower(strings.TrimSpace(pattern))
		if pattern == "" {
			continue
		}
		if host == pattern || strings.HasSuffix(host, "."+pattern) {
			return true
		}
	}
	return false
}

// extractExternalURLs pulls http(s) URLs from markdown body text, excluding
// frontmatter and fenced/inline code blocks.
func extractExternalURLs(content []byte) []string {
	body := markdown.BodyAfterFrontmatter(content)
	if body == "" {
		return nil
	}
	bodyBytes := []byte(body)

	md := goldmark.New(goldmark.WithExtensions(extension.Linkify))
	doc := md.Parser().Parse(text.NewReader(bodyBytes), parser.WithContext(parser.NewContext()))
	reader := text.NewReader(bodyBytes)

	var urls []string
	var walk func(n ast.Node)
	walk = func(n ast.Node) {
		switch n := n.(type) {
		case *ast.FencedCodeBlock, *ast.CodeBlock:
			return
		case *ast.CodeSpan:
			return
		case *ast.AutoLink:
			dest := string(n.URL(bodyBytes))
			if strings.HasPrefix(dest, "http://") || strings.HasPrefix(dest, "https://") {
				urls = append(urls, dest)
			}
		case *ast.Link:
			dest := string(n.Destination)
			if strings.HasPrefix(dest, "http://") || strings.HasPrefix(dest, "https://") {
				urls = append(urls, dest)
			}
		case *ast.Text:
			if n.Segment.Start < 0 {
				return
			}
			segment := reader.Source()[n.Segment.Start:n.Segment.Stop]
			for _, m := range externalURLRe.FindAllString(string(segment), -1) {
				urls = append(urls, strings.TrimRight(m, ".,;:!?)"))
			}
		}
		for child := n.FirstChild(); child != nil; child = child.NextSibling() {
			walk(child)
		}
	}
	walk(doc)

	for _, part := range bodyPartsWithoutCodeFences(body) {
		for _, m := range externalURLRe.FindAllString(part, -1) {
			urls = append(urls, strings.TrimRight(m, ".,;:!?)"))
		}
	}
	return uniqueStrings(urls)
}

func uniqueStrings(in []string) []string {
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, s := range in {
		if s == "" {
			continue
		}
		if _, ok := seen[s]; ok {
			continue
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	return out
}

func bodyPartsWithoutCodeFences(body string) []string {
	lines := strings.Split(body, "\n")
	var parts []string
	var buf strings.Builder
	inFence := false
	for _, line := range lines {
		trim := strings.TrimSpace(line)
		if strings.HasPrefix(trim, "```") || strings.HasPrefix(trim, "~~~") {
			if buf.Len() > 0 {
				parts = append(parts, buf.String())
				buf.Reset()
			}
			inFence = !inFence
			continue
		}
		if inFence {
			continue
		}
		if buf.Len() > 0 {
			buf.WriteByte('\n')
		}
		buf.WriteString(line)
	}
	if buf.Len() > 0 {
		parts = append(parts, buf.String())
	}
	return parts
}

// ExternalLinkCheckConfigFromJanitor maps [janitor] TOML fields to checker settings.
func ExternalLinkCheckConfigFromJanitor(j config.JanitorConfig) config.ExternalLinkCheckConfig {
	base := j.ExternalLinkCheckConfig()
	timeout := 5 * time.Second
	if base.TimeoutRaw != "" {
		if d, err := time.ParseDuration(base.TimeoutRaw); err == nil && d > 0 {
			timeout = d
		}
	}
	cacheTTL := 24 * time.Hour
	if base.CacheTTLRaw != "" {
		if d, err := time.ParseDuration(base.CacheTTLRaw); err == nil && d > 0 {
			cacheTTL = d
		}
	}
	base.Timeout = timeout
	base.CacheTTL = cacheTTL
	base.MaxConcurrent = 10
	base.RequestDelay = 100 * time.Millisecond
	base.MaxRedirects = 3
	base.UserAgent = "KiwiFS-LinkChecker/1.0"
	base.Background = true
	return base
}
