package api

import "testing"

func TestDetectContentTypeNeverServesActiveMarkup(t *testing.T) {
	for _, c := range []struct {
		path    string
		content string
		want    string
	}{
		{"guides/apps/lease.html", "<script>alert(1)</script>", "text/plain; charset=utf-8"},
		{"a.htm", "<p>x</p>", "text/plain; charset=utf-8"},
		{"a.xhtml", "<html/>", "text/plain; charset=utf-8"},
		{"feed.xml", "<rss/>", "text/plain; charset=utf-8"},
		{"noext", "<!DOCTYPE html><html><body>x</body></html>", "text/plain; charset=utf-8"},
		{"page.md", "# x", "text/markdown; charset=utf-8"},
		{"img.png", "\x89PNG\r\n\x1a\n", "image/png"},
	} {
		if got := detectContentType(c.path, []byte(c.content)); got != c.want {
			t.Errorf("detectContentType(%q) = %q, want %q", c.path, got, c.want)
		}
	}
}
