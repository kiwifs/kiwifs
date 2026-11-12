package janitor

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestExtractExternalURLs(t *testing.T) {
	body := strings.Join([]string{
		"See https://a.example/docs, and (https://b.example/x).",
		"[wiki](https://en.wikipedia.org/wiki/Foo_(bar)) and <https://c.example/p?q=1#frag>.",
		"Inline `https://code.example/skip` is ignored.",
		"```sh",
		"curl https://fenced.example/skip",
		"```",
		"~~~~",
		"```",
		"https://tilde.example/skip",
		"~~~~",
		"Repeat https://a.example/docs and ftp://nope.example and mailto:x@y.z",
		"After https://d.example/end.",
	}, "\n")
	want := []string{
		"https://a.example/docs",
		"https://b.example/x",
		"https://en.wikipedia.org/wiki/Foo_(bar)",
		"https://c.example/p?q=1",
		"https://d.example/end",
	}
	if got := ExtractExternalURLs(body); !reflect.DeepEqual(got, want) {
		t.Fatalf("ExtractExternalURLs =\n%v\nwant\n%v", got, want)
	}
}

type linkServer struct {
	*httptest.Server
	mu   sync.Mutex
	hits map[string][]string // path -> methods seen
}

func newLinkServer(t *testing.T) *linkServer {
	t.Helper()
	ls := &linkServer{hits: map[string][]string{}}
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		ls.mu.Lock()
		ls.hits[r.URL.Path] = append(ls.hits[r.URL.Path], r.Method)
		ls.mu.Unlock()
		if ua := r.Header.Get("User-Agent"); ua != externalLinkUserAgent {
			t.Errorf("User-Agent = %q", ua)
		}
		switch r.URL.Path {
		case "/ok":
		case "/gone":
			http.NotFound(w, r)
		case "/boom":
			http.Error(w, "boom", http.StatusInternalServerError)
		case "/nohead":
			if r.Method == http.MethodHead {
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			if r.Header.Get("Range") != "bytes=0-0" {
				t.Errorf("GET fallback missing Range header")
			}
			w.WriteHeader(http.StatusPartialContent)
		case "/moved":
			http.Redirect(w, r, "/ok", http.StatusMovedPermanently)
		case "/loop":
			http.Redirect(w, r, "/loop", http.StatusFound)
		default:
			http.NotFound(w, r)
		}
	})
	ls.Server = httptest.NewServer(mux)
	t.Cleanup(ls.Close)
	return ls
}

func (ls *linkServer) count(path string) int {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	return len(ls.hits[path])
}

func scanExternal(t *testing.T, files map[string]string, opts ExternalLinkOptions) (*ScanResult, string) {
	t.Helper()
	store, root := buildStore(t, files)
	opts.Enabled = true
	if opts.Delay == 0 {
		opts.Delay = -1
	}
	sc := New(root, store, nil, 90, WithExternalLinks(opts))
	res, err := sc.Scan(context.Background())
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	return res, root
}

func TestScan_ExternalLinkRot(t *testing.T) {
	ls := newLinkServer(t)
	page := fmt.Sprintf(`---
owner: me
status: published
source: %[1]s/frontmatter-skipped
---
# Links

Good: %[1]s/ok and %[1]s/moved and %[1]s/nohead.
Bad: %[1]s/gone, %[1]s/boom and %[1]s/loop.
`+"`%[1]s/inline-skipped`\n```\n%[1]s/fenced-skipped\n```\n", ls.URL)

	res, _ := scanExternal(t, map[string]string{"docs/links.md": page, "other.md": "See " + ls.URL + "/gone for the rest of this page content."}, ExternalLinkOptions{})
	rot := issuesByKind(res.Issues)[IssueExternalLinkRot]

	got := map[string]string{}
	for _, is := range rot {
		if is.Severity != "warning" || len(is.Related) != 1 {
			t.Errorf("unexpected issue shape: %+v", is)
		}
		got[is.Path+" "+strings.TrimPrefix(is.Related[0], ls.URL)] = is.Message
	}
	for _, want := range []string{"docs/links.md /gone", "docs/links.md /boom", "docs/links.md /loop", "other.md /gone"} {
		if _, ok := got[want]; !ok {
			t.Errorf("missing external-link-rot for %s; got %v", want, got)
		}
	}
	if len(rot) != 4 {
		t.Errorf("want 4 issues, got %d: %v", len(rot), got)
	}
	if m := got["docs/links.md /gone"]; !strings.Contains(m, "HTTP 404") {
		t.Errorf("message = %q", m)
	}
	if m := got["docs/links.md /boom"]; !strings.Contains(m, "HTTP 500") {
		t.Errorf("message = %q", m)
	}
	for _, p := range []string{"/frontmatter-skipped", "/inline-skipped", "/fenced-skipped"} {
		if ls.count(p) != 0 {
			t.Errorf("%s must not be probed", p)
		}
	}
	// A URL shared by two pages is probed once (HEAD, then GET fallback).
	if n := ls.count("/gone"); n != 2 {
		t.Errorf("/gone requests = %d, want 2 (HEAD + GET)", n)
	}
}

func TestScan_ExternalLinkUnreachable(t *testing.T) {
	ls := newLinkServer(t)
	dead := ls.URL
	ls.Close()
	res, _ := scanExternal(t, map[string]string{"a.md": "A page that links to " + dead + "/x which is down."}, ExternalLinkOptions{Timeout: time.Second})
	rot := issuesByKind(res.Issues)[IssueExternalLinkRot]
	if len(rot) != 1 || !strings.Contains(rot[0].Message, "unreachable") {
		t.Fatalf("want one unreachable issue, got %+v", rot)
	}
}

func TestScan_ExternalLinkDisabledByDefault(t *testing.T) {
	ls := newLinkServer(t)
	store, root := buildStore(t, map[string]string{"a.md": "A page that links to " + ls.URL + "/gone for testing."})
	res, err := New(root, store, nil, 90).Scan(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(issuesByKind(res.Issues)[IssueExternalLinkRot]) != 0 || ls.count("/gone") != 0 {
		t.Fatal("external links must not be probed unless enabled")
	}
	if _, err := os.Stat(linkCachePath(root)); err == nil {
		t.Fatal("cache must not be written when disabled")
	}
}

func TestScan_ExternalLinkIgnoreList(t *testing.T) {
	ls := newLinkServer(t)
	host := strings.TrimPrefix(ls.URL, "http://")
	host = host[:strings.LastIndex(host, ":")]
	res, _ := scanExternal(t,
		map[string]string{"a.md": "A page that links to " + ls.URL + "/gone for testing."},
		ExternalLinkOptions{Ignore: []string{" " + strings.ToUpper(host)}})
	if len(issuesByKind(res.Issues)[IssueExternalLinkRot]) != 0 || ls.count("/gone") != 0 {
		t.Fatal("ignored host must not be probed")
	}
}

func TestLinkChecker_IgnoreMatchesSubdomainsOnly(t *testing.T) {
	c := newLinkChecker(ExternalLinkOptions{Ignore: []string{"example.com"}}, nil)
	for u, want := range map[string]bool{
		"https://example.com/a":     true,
		"https://docs.example.com/": true,
		"https://notexample.com/":   false,
		"https://example.com.evil/": false,
	} {
		if got := c.ignored(u); got != want {
			t.Errorf("ignored(%s) = %v, want %v", u, got, want)
		}
	}
}

func TestScan_ExternalLinkCache(t *testing.T) {
	ls := newLinkServer(t)
	files := map[string]string{"a.md": "A page that links to " + ls.URL + "/gone and " + ls.URL + "/ok."}
	store, root := buildStore(t, files)
	scan := func(ttl time.Duration) *ScanResult {
		sc := New(root, store, nil, 90, WithExternalLinks(ExternalLinkOptions{Enabled: true, CacheTTL: ttl, Delay: -1}))
		res, err := sc.Scan(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		return res
	}

	first := scan(time.Hour)
	afterFirst := ls.count("/gone") + ls.count("/ok")
	second := scan(time.Hour)
	if n := ls.count("/gone") + ls.count("/ok"); n != afterFirst {
		t.Fatalf("second scan hit the network (%d -> %d requests)", afterFirst, n)
	}
	if len(issuesByKind(first.Issues)[IssueExternalLinkRot]) != 1 || len(issuesByKind(second.Issues)[IssueExternalLinkRot]) != 1 {
		t.Fatal("cached scan must still report the broken link")
	}

	raw, err := os.ReadFile(linkCachePath(root))
	if err != nil {
		t.Fatalf("cache not written: %v", err)
	}
	var cached map[string]linkResult
	if err := json.Unmarshal(raw, &cached); err != nil || len(cached) != 2 || cached[ls.URL+"/gone"].Status != 404 {
		t.Fatalf("cache contents = %s (%v)", raw, err)
	}

	// An expired entry is re-probed.
	time.Sleep(5 * time.Millisecond)
	scan(time.Millisecond)
	if n := ls.count("/gone") + ls.count("/ok"); n == afterFirst {
		t.Fatal("expired cache entries must be re-probed")
	}

	// Links removed from the workspace are pruned from the cache.
	if err := os.WriteFile(root+"/a.md", []byte("A page that now only links to "+ls.URL+"/ok in its body."), 0o644); err != nil {
		t.Fatal(err)
	}
	scan(time.Hour)
	raw, _ = os.ReadFile(linkCachePath(root))
	cached = nil
	_ = json.Unmarshal(raw, &cached)
	if _, stale := cached[ls.URL+"/gone"]; stale || len(cached) != 1 {
		t.Fatalf("cache not pruned: %s", raw)
	}
}

func TestLinkChecker_ConcurrencyLimit(t *testing.T) {
	var cur, peak int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&cur, 1)
		for {
			p := atomic.LoadInt32(&peak)
			if n <= p || atomic.CompareAndSwapInt32(&peak, p, n) {
				break
			}
		}
		time.Sleep(20 * time.Millisecond)
		atomic.AddInt32(&cur, -1)
	}))
	defer srv.Close()

	var urls []string
	for i := 0; i < 12; i++ {
		urls = append(urls, fmt.Sprintf("%s/%d", srv.URL, i))
	}
	c := newLinkChecker(ExternalLinkOptions{Concurrency: 3, Delay: -1}, nil)
	if res := c.checkAll(context.Background(), urls); len(res) != len(urls) {
		t.Fatalf("results = %d, want %d", len(res), len(urls))
	}
	if p := atomic.LoadInt32(&peak); p > 3 {
		t.Fatalf("peak concurrency %d exceeds limit 3", p)
	}
}

func TestLinkChecker_DelaySpacesRequests(t *testing.T) {
	var mu sync.Mutex
	var starts []time.Time
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		starts = append(starts, time.Now())
		mu.Unlock()
	}))
	defer srv.Close()
	c := newLinkChecker(ExternalLinkOptions{Delay: 60 * time.Millisecond, Concurrency: 4}, nil)
	begin := time.Now()
	c.checkAll(context.Background(), []string{srv.URL + "/1", srv.URL + "/2", srv.URL + "/3"})
	if el := time.Since(begin); el < 110*time.Millisecond {
		t.Fatalf("3 requests finished in %v; starts are not spaced", el)
	}
}

func TestLinkChecker_CancelledResultsAreNotCached(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	c := newLinkChecker(ExternalLinkOptions{Timeout: 5 * time.Second, Delay: -1}, nil)
	res := c.checkAll(ctx, []string{srv.URL + "/slow"})
	if len(res) != 0 || len(c.cache) != 0 {
		t.Fatalf("cancelled probe recorded: results=%v cache=%v", res, c.cache)
	}
}

func TestOptionsFromExternalLinks(t *testing.T) {
	if OptionsFromExternalLinks(false, "5s", nil, "1h") != nil {
		t.Fatal("disabled config must yield no options")
	}
	s := New(t.TempDir(), nil, nil, 90, OptionsFromExternalLinks(true, "2s", []string{"x.test"}, "bogus")...)
	if s.externalLinks == nil || s.externalLinks.Timeout != 2*time.Second || s.externalLinks.CacheTTL != 0 || len(s.externalLinks.Ignore) != 1 {
		t.Fatalf("options = %+v", s.externalLinks)
	}
}
