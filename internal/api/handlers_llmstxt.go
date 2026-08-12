package api

import (
	"fmt"
	"net/http"
	"path"
	"sort"
	"strings"

	"github.com/kiwifs/kiwifs/internal/config"
	"github.com/kiwifs/kiwifs/internal/markdown"
	"github.com/kiwifs/kiwifs/internal/storage"
	"github.com/labstack/echo/v4"
)

// maxLLMsFullBytes caps /llms-full.txt. A knowledge base can be arbitrarily
// large and this endpoint is unauthenticated-adjacent and uncached; a hard cap
// with an explicit truncation notice beats streaming a gigabyte to a crawler.
const maxLLMsFullBytes = 5 << 20

// LLMsTxt godoc
//
//	@Summary		llms.txt index
//	@Description	Emits the workspace as an llms.txt index (llmstxt.org): a title, a summary, and every page grouped by folder with links. Makes a published workspace legible to agents that have never heard of MCP.
//	@Tags			search
//	@Produce		plain
//	@Success		200	{string}	string
//	@Router			/llms.txt [get]
func (h *Handlers) LLMsTxt(c echo.Context) error {
	pages, err := h.llmsPages(c)
	if err != nil {
		return err
	}

	var sb strings.Builder
	fmt.Fprintf(&sb, "# %s\n\n", h.brandingName())
	fmt.Fprintf(&sb, "> %s\n\n", h.brandingSummary())
	sb.WriteString("Every entry below is a markdown page. Append `?raw=1` to a link, or fetch `/llms-full.txt`, to get the full text of everything at once.\n")

	// Group by top-level folder so the index has the shape of the workspace
	// rather than one undifferentiated list.
	groups := map[string][]llmsPage{}
	for _, p := range pages {
		groups[topFolder(p.Path)] = append(groups[topFolder(p.Path)], p)
	}
	names := make([]string, 0, len(groups))
	for name := range groups {
		names = append(names, name)
	}
	sort.Strings(names)

	for _, name := range names {
		fmt.Fprintf(&sb, "\n## %s\n\n", name)
		for _, p := range groups[name] {
			link := config.Permalink(h.publicURL, p.Path)
			if link == "" {
				link = "/" + p.Path
			}
			if p.Summary != "" {
				fmt.Fprintf(&sb, "- [%s](%s): %s\n", p.Title, link, p.Summary)
			} else {
				fmt.Fprintf(&sb, "- [%s](%s)\n", p.Title, link)
			}
		}
	}
	return c.String(http.StatusOK, sb.String())
}

// LLMsFullTxt godoc
//
//	@Summary		llms-full.txt full corpus
//	@Description	Emits every page's full markdown, concatenated, for agents that would rather read once than crawl. Truncated with an explicit notice past a size cap.
//	@Tags			search
//	@Produce		plain
//	@Success		200	{string}	string
//	@Router			/llms-full.txt [get]
func (h *Handlers) LLMsFullTxt(c echo.Context) error {
	pages, err := h.llmsPages(c)
	if err != nil {
		return err
	}
	ctx := c.Request().Context()

	var sb strings.Builder
	fmt.Fprintf(&sb, "# %s\n\n", h.brandingName())
	fmt.Fprintf(&sb, "> %s\n", h.brandingSummary())

	truncated := 0
	for _, p := range pages {
		if sb.Len() >= maxLLMsFullBytes {
			truncated++
			continue
		}
		raw, rerr := h.store.Read(ctx, p.Path)
		if rerr != nil {
			continue
		}
		body := strings.TrimSpace(markdown.BodyAfterFrontmatter(raw))
		if body == "" {
			continue
		}
		fmt.Fprintf(&sb, "\n---\n\n<!-- source: %s -->\n\n%s\n", p.Path, body)
	}
	if truncated > 0 {
		// Say what was left out rather than letting the reader assume the
		// corpus ends here.
		fmt.Fprintf(&sb, "\n---\n\n<!-- truncated: %d further page(s) omitted at the %d MiB cap; fetch them individually or use POST /api/kiwi/brief -->\n",
			truncated, maxLLMsFullBytes>>20)
	}
	return c.String(http.StatusOK, sb.String())
}

type llmsPage struct {
	Path    string
	Title   string
	Summary string
}

func (h *Handlers) llmsPages(c echo.Context) ([]llmsPage, error) {
	ctx := c.Request().Context()
	var pages []llmsPage
	err := storage.Walk(ctx, h.store, "", func(e storage.Entry) error {
		raw, rerr := h.store.Read(ctx, e.Path)
		if rerr != nil {
			return nil
		}
		page := llmsPage{Path: e.Path, Title: strings.TrimSuffix(path.Base(e.Path), ".md")}
		if parsed, perr := markdown.Parse(raw); perr == nil && parsed != nil {
			if t, ok := parsed.Frontmatter["title"].(string); ok && strings.TrimSpace(t) != "" {
				page.Title = strings.TrimSpace(t)
			}
			if d, ok := parsed.Frontmatter["description"].(string); ok {
				page.Summary = strings.TrimSpace(d)
			}
		}
		if page.Summary == "" {
			page.Summary = firstParagraph(markdown.BodyAfterFrontmatter(raw))
		}
		pages = append(pages, page)
		return nil
	})
	if err != nil {
		return nil, echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	sort.Slice(pages, func(i, j int) bool { return pages[i].Path < pages[j].Path })
	return pages, nil
}

func (h *Handlers) brandingName() string {
	if h.cfg != nil && strings.TrimSpace(h.cfg.UI.Branding.Name) != "" {
		return h.cfg.UI.Branding.Name
	}
	return config.DefaultBrandingName
}

func (h *Handlers) brandingSummary() string {
	if h.cfg != nil && strings.TrimSpace(h.cfg.UI.Branding.WelcomeMessage) != "" {
		return oneLine(h.cfg.UI.Branding.WelcomeMessage)
	}
	return "A markdown knowledge base served by KiwiFS."
}

// firstParagraph returns the first non-heading, non-empty paragraph, collapsed
// to a single line for use as a link description.
func firstParagraph(body string) string {
	for _, block := range strings.Split(body, "\n\n") {
		block = strings.TrimSpace(block)
		if block == "" || strings.HasPrefix(block, "#") || strings.HasPrefix(block, "```") {
			continue
		}
		return truncateRunes(oneLine(block), 200)
	}
	return ""
}

func oneLine(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return strings.TrimSpace(string(r[:n])) + "…"
}

func topFolder(p string) string {
	if i := strings.Index(p, "/"); i > 0 {
		return p[:i]
	}
	return "Root"
}
