package api

import (
	"bytes"
	"fmt"
	"html/template"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/kiwifs/kiwifs/internal/markdown"
	"github.com/kiwifs/kiwifs/internal/rbac"
	"github.com/labstack/echo/v4"
	goldmark "github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	gmhtml "github.com/yuin/goldmark/renderer/html"
)

var mdRenderer = goldmark.New(
	goldmark.WithExtensions(extension.GFM),
	goldmark.WithRendererOptions(gmhtml.WithUnsafe()),
)

type tocEntry struct {
	ID    string
	Title string
	Level int
}

type readerData struct {
	Title       string
	Description string
	PublishedAt string
	BodyHTML    template.HTML
	TOC         []tocEntry
	HasTOC      bool
}

var headingRe = regexp.MustCompile(`<h([2-4])>(.*?)</h[2-4]>`)
var tagStripRe = regexp.MustCompile(`<[^>]*>`)

func slugify(s string) string {
	s = tagStripRe.ReplaceAllString(s, "")
	s = strings.ToLower(s)
	s = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			return r
		}
		if r == ' ' || r == '-' || r == '_' {
			return '-'
		}
		return -1
	}, s)
	for strings.Contains(s, "--") {
		s = strings.ReplaceAll(s, "--", "-")
	}
	return strings.Trim(s, "-")
}

func addHeadingIDs(html string) (string, []tocEntry) {
	var toc []tocEntry
	seen := map[string]int{}

	result := headingRe.ReplaceAllStringFunc(html, func(match string) string {
		subs := headingRe.FindStringSubmatch(match)
		if len(subs) < 3 {
			return match
		}
		level := int(subs[1][0] - '0')
		inner := subs[2]
		plain := tagStripRe.ReplaceAllString(inner, "")
		id := slugify(plain)
		if id == "" {
			id = "section"
		}
		if n, ok := seen[id]; ok {
			seen[id] = n + 1
			id = fmt.Sprintf("%s-%d", id, n+1)
		} else {
			seen[id] = 1
		}
		toc = append(toc, tocEntry{ID: id, Title: plain, Level: level})
		return fmt.Sprintf(`<h%s id="%s">%s</h%s>`, subs[1], id, inner, subs[1])
	})
	return result, toc
}

// PublishedPage godoc
//
//	@Summary		Serve a published page
//	@Description	Serves a rendered HTML view of a published markdown page, or serves co-located static assets (images, PDFs) publicly if they inherit access from their parent pages.
//	@Tags			reader
//	@Param			path	path		string	true	"Path to the published page or static asset"
//	@Success		200		{string}	string	"Rendered HTML content or raw asset binary content"
//	@Failure		404		{object}	map[string]string
//	@Failure		500		{object}	map[string]string
//	@Router			/p/{path} [get]
func (h *Handlers) PublishedPage(c echo.Context) error {
	raw := c.Param("*")
	cleaned := strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(raw, "/"), "/"))
	if cleaned == "" {
		return echo.NewHTTPError(http.StatusNotFound, "not found")
	}
	if filepath.Ext(cleaned) == "" {
		cleaned += ".md"
	}

	ctx := c.Request().Context()
	content, err := h.store.Read(ctx, cleaned)
	if err != nil {
		if fallback := trimCopiedMarkdownTitleSuffix(cleaned); fallback != cleaned {
			cleaned = fallback
			content, err = h.store.Read(ctx, cleaned)
		}
	}
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "not found")
	}

	ext := strings.ToLower(filepath.Ext(cleaned))
	isMarkdown := ext == ".md" || ext == ".markdown"

	if !isMarkdown {
		if !h.hasPublicSibling(ctx, cleaned) {
			return echo.NewHTTPError(http.StatusNotFound, "not found")
		}
		return c.Blob(http.StatusOK, detectContentType(cleaned, content), content)
	}

	if rbac.PageVisibility(content) != rbac.VisibilityPublic && !rbac.PagePublished(content) {
		return echo.NewHTTPError(http.StatusNotFound, "not found")
	}

	if h.publishMetrics != nil && rbac.PagePublished(content) {
		h.publishMetrics.Increment(cleaned)
	}

	fm, err := markdown.Frontmatter(content)
	if err != nil {
		fm = map[string]any{}
	}

	_, bodyBytes, _ := markdown.SplitFrontmatter(content)

	pageDir := filepath.Dir(cleaned)
	bodyStr := rewriteRelativeAssets(string(bodyBytes), pageDir)

	var htmlBuf bytes.Buffer
	if err := mdRenderer.Convert([]byte(bodyStr), &htmlBuf); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "render failed")
	}

	bodyHTML, toc := addHeadingIDs(htmlBuf.String())

	title, _ := fm["title"].(string)
	if title == "" {
		title = strings.TrimSuffix(filepath.Base(cleaned), filepath.Ext(cleaned))
	}
	description, _ := fm["description"].(string)

	var publishedAt string
	if pat := rbac.PagePublishedAt(content); pat != nil {
		publishedAt = pat.Format("January 2, 2006")
	}

	data := readerData{
		Title:       title,
		Description: description,
		PublishedAt: publishedAt,
		BodyHTML:    template.HTML(bodyHTML),
		TOC:         toc,
		HasTOC:      len(toc) >= 2,
	}

	c.Response().Header().Set("Content-Type", "text/html; charset=utf-8")
	c.Response().Header().Set("Cache-Control", "public, max-age=60")
	return readerTmpl.Execute(c.Response(), data)
}

func trimCopiedMarkdownTitleSuffix(path string) string {
	lower := strings.ToLower(path)
	for _, ext := range []string{".markdown", ".md"} {
		marker := ext + " "
		if idx := strings.Index(lower, marker); idx >= 0 {
			return strings.TrimSpace(path[:idx+len(ext)])
		}
	}
	return path
}

func rewriteRelativeAssets(body string, pageDir string) string {
	body = strings.ReplaceAll(body, "](./", "](/p/"+pageDir+"/")
	body = strings.ReplaceAll(body, "](../", "](/p/"+filepath.Dir(pageDir)+"/")
	return body
}

var readerTmpl = template.Must(template.New("reader").Parse(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{.Title}}</title>
{{if .Description}}<meta name="description" content="{{.Description}}">{{end}}
<meta property="og:title" content="{{.Title}}">
{{if .Description}}<meta property="og:description" content="{{.Description}}">{{end}}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
:root {
  --bg: #ffffff; --fg: #1a1a1a; --muted: #6b7280;
  --border: #e5e7eb; --link: #1d4ed8; --accent: #7fbc3d;
  --code-bg: #f3f4f6; --max-w: 42rem; --toc-w: 14rem;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d0d0d; --fg: #e5e5e5; --muted: #9ca3af;
    --border: #262626; --link: #93c5fd; --accent: #a3d977;
    --code-bg: #1a1a1a;
  }
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  background: var(--bg); color: var(--fg);
  line-height: 1.75; font-size: 1.0625rem;
  -webkit-font-smoothing: antialiased;
}

.page-layout { display: flex; justify-content: center; gap: 2rem; }

.reader {
  max-width: var(--max-w); width: 100%;
  padding: 3rem 1.5rem 6rem;
}

.toc-aside {
  position: sticky; top: 2rem; align-self: flex-start;
  width: var(--toc-w); flex-shrink: 0;
  padding-top: 3rem; display: none;
}
@media (min-width: 1100px) {
  .toc-aside { display: block; }
}
.toc-aside h2 {
  font-size: 0.6875rem; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.05em; color: var(--muted); margin-bottom: 0.75rem;
}
.toc-aside ul { list-style: none; }
.toc-aside li { margin: 0; }
.toc-aside a {
  display: block; padding: 0.2rem 0; font-size: 0.8125rem;
  color: var(--muted); text-decoration: none;
  border-left: 2px solid transparent; padding-left: 0.75rem;
  transition: color 0.15s, border-color 0.15s;
  line-height: 1.4;
}
.toc-aside a:hover { color: var(--fg); }
.toc-aside a.active { color: var(--fg); border-left-color: var(--accent); }
.toc-aside .toc-h3 { padding-left: 1.5rem; }
.toc-aside .toc-h4 { padding-left: 2.25rem; }

.reader-header { margin-bottom: 2.5rem; }
.reader-header h1 {
  font-size: 2rem; font-weight: 700; line-height: 1.2;
  letter-spacing: -0.02em; margin-bottom: 0.75rem;
}
.reader-meta {
  font-size: 0.875rem; color: var(--muted);
  display: flex; gap: 1rem; flex-wrap: wrap;
}
.reader-desc {
  font-size: 1.125rem; color: var(--muted);
  line-height: 1.6; margin-top: 1rem;
}

.reader-body h1 { font-size: 1.875rem; font-weight: 700; margin: 2rem 0 1rem; }
.reader-body h2 { font-size: 1.5rem; font-weight: 600; margin: 2.5rem 0 0.75rem; padding-bottom: 0.375rem; border-bottom: 1px solid var(--border); }
.reader-body h3 { font-size: 1.25rem; font-weight: 600; margin: 1.75rem 0 0.5rem; }
.reader-body h4 { font-size: 1.125rem; font-weight: 600; margin: 1.5rem 0 0.5rem; }
.reader-body p { margin: 1rem 0; }
.reader-body a { color: var(--link); text-decoration: underline; text-underline-offset: 2px; }
.reader-body a:hover { opacity: 0.8; }
.reader-body img {
  max-width: 100%; height: auto; border-radius: 0.5rem;
  margin: 1.5rem 0; display: block;
}
.reader-body blockquote {
  border-left: 3px solid var(--accent); padding: 0.5rem 1rem;
  margin: 1rem 0; color: var(--muted);
}
.reader-body ul, .reader-body ol { padding-left: 1.5rem; margin: 1rem 0; }
.reader-body li { margin: 0.25rem 0; }
.reader-body code {
  background: var(--code-bg); padding: 0.15em 0.4em;
  border-radius: 0.25rem; font-size: 0.875em;
  font-family: ui-monospace, 'Cascadia Code', monospace;
}
.reader-body pre {
  background: var(--code-bg); border-radius: 0.5rem;
  padding: 1rem; overflow-x: auto; margin: 1.5rem 0;
  font-size: 0.875rem; line-height: 1.6;
}
.reader-body pre code { background: none; padding: 0; font-size: inherit; }
.reader-body table {
  width: 100%; border-collapse: collapse; margin: 1.5rem 0;
  font-size: 0.9375rem;
}
.reader-body th, .reader-body td {
  padding: 0.5rem 0.75rem; border: 1px solid var(--border);
  text-align: left;
}
.reader-body th { font-weight: 600; background: var(--code-bg); }
.reader-body hr { border: none; border-top: 1px solid var(--border); margin: 2.5rem 0; }
.reader-body strong { font-weight: 600; }

.reader-footer {
  margin-top: 4rem; padding-top: 1.5rem;
  border-top: 1px solid var(--border);
  font-size: 0.8125rem; color: var(--muted);
  display: flex; align-items: center; justify-content: center; gap: 0.5rem;
}
.reader-footer img { width: 20px; height: 20px; border-radius: 4px; }
.reader-footer a {
  color: var(--accent); text-decoration: none;
  display: inline-flex; align-items: center; gap: 0.375rem;
}
.reader-footer a:hover { text-decoration: underline; }
</style>
</head>
<body>
<div class="page-layout">
  <article class="reader">
    <header class="reader-header">
      <h1>{{.Title}}</h1>
      {{if .PublishedAt}}<div class="reader-meta"><span>{{.PublishedAt}}</span></div>{{end}}
      {{if .Description}}<p class="reader-desc">{{.Description}}</p>{{end}}
    </header>
    <div class="reader-body">{{.BodyHTML}}</div>
    <footer class="reader-footer">
      Published with <a href="https://kiwifs.com"><img src="/kiwifs.png" alt="KiwiFS">KiwiFS</a>
    </footer>
  </article>
  {{if .HasTOC}}
  <aside class="toc-aside">
    <h2>On this page</h2>
    <ul>
      {{range .TOC}}<li><a href="#{{.ID}}" class="toc-h{{.Level}}">{{.Title}}</a></li>
      {{end}}
    </ul>
  </aside>
  {{end}}
</div>
{{if .HasTOC}}
<script>
(function(){
  const links = document.querySelectorAll('.toc-aside a');
  if (!links.length) return;
  const ids = Array.from(links).map(a => a.getAttribute('href').slice(1));
  function update() {
    let active = ids[0];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el && el.getBoundingClientRect().top <= 120) active = id;
    }
    links.forEach(a => {
      a.classList.toggle('active', a.getAttribute('href') === '#' + active);
    });
  }
  window.addEventListener('scroll', update, { passive: true });
  update();
})();
</script>
{{end}}
</body>
</html>`))
