package api

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/kiwifs/kiwifs/internal/links"
	"github.com/kiwifs/kiwifs/internal/markdown"
	"github.com/kiwifs/kiwifs/internal/storage"
	"github.com/labstack/echo/v4"
)

type peekResponse struct {
	Path        string   `json:"path" example:"/docs/getting-started.md"`
	Title       string   `json:"title" example:"Getting Started"`
	Frontmatter any      `json:"frontmatter"`
	Snippet     string   `json:"snippet" example:"This guide will help you set up and run KiwiFS in less than 5 minutes..."`
	LinksOut    []string `json:"links_out" example:"/docs/install.md"`
	LinksIn     []string `json:"links_in" example:"/docs/index.md"`
	WordCount   int      `json:"word_count" example:"450"`
	Headings    []string `json:"headings" example:"KiwiFS CLI,Installation,Running Server"`
}

type sectionReadResponse struct {
	Path      string `json:"path" example:"/docs/getting-started.md"`
	Heading   string `json:"heading" example:"Installation"`
	Level     int    `json:"level" example:"2"`
	Content   string `json:"content" example:"To install KiwiFS, run the following command..."`
	LineStart int    `json:"line_start" example:"14"`
	LineEnd   int    `json:"line_end" example:"28"`
}

type graphWalkNeighbor struct {
	Path      string `json:"path" example:"/docs/advanced.md"`
	Relation  string `json:"relation" example:"sibling_tag"`
	SharedTag string `json:"shared_tag,omitempty" example:"setup"`
}

type graphWalkResponse struct {
	Path      string              `json:"path" example:"/docs/getting-started.md"`
	LinksOut  []string            `json:"links_out" example:"/docs/install.md"`
	LinksIn   []string            `json:"links_in" example:"/docs/index.md"`
	Siblings  []graphWalkNeighbor `json:"siblings"`
	HubScore  float64             `json:"hub_score" example:"0.125"`
	InDegree  int                 `json:"in_degree" example:"2"`
	OutDegree int                 `json:"out_degree" example:"1"`
}

// Peek godoc
//
//	@Summary		Get a lightweight summary of a file
//	@Description	Parses the markdown file at the given path to return metadata, title, YAML frontmatter, a text snippet, outgoing/incoming links, word count, and a list of headings.
//	@Tags			graph
//	@Security		BearerAuth
//	@Produce		json
//	@Param			path	query		string	true	"File path in kiwifs"
//	@Success		200		{object}	peekResponse
//	@Failure		400		{object}	map[string]string
//	@Failure		404		{object}	map[string]string
//	@Router			/api/kiwi/peek [get]
func (h *Handlers) Peek(c echo.Context) error {
	path, err := requirePath(c)
	if err != nil {
		return err
	}
	ctx := c.Request().Context()

	raw, err := readFileOr404(ctx, h.store, path)
	if err != nil {
		return err
	}

	_, body, _ := markdown.SplitFrontmatter(raw)
	if body == nil {
		body = raw
	}

	parsed, _ := markdown.Parse(raw)

	title := ""
	if parsed != nil && len(parsed.Headings) > 0 {
		title = parsed.Headings[0].Text
	}
	if title == "" {
		parts := strings.Split(path, "/")
		title = parts[len(parts)-1]
	}

	snippet := extractFirstParagraphAPI(body, 300)

	linksOut := links.Extract(body)
	linksOut = links.Unique(linksOut)
	if linksOut == nil {
		linksOut = []string{}
	}

	var linksIn []string
	if h.linker != nil {
		entries, _ := h.linker.Backlinks(ctx, path)
		for _, e := range entries {
			linksIn = append(linksIn, e.Path)
		}
	}
	if linksIn == nil {
		linksIn = []string{}
	}

	var headings []string
	if parsed != nil {
		for _, hd := range parsed.Headings {
			headings = append(headings, hd.Text)
		}
	}
	if headings == nil {
		headings = []string{}
	}

	wordCount := len(strings.Fields(string(body)))

	return c.JSON(http.StatusOK, peekResponse{
		Path:        path,
		Title:       title,
		Frontmatter: sanitizeForJSON(parsed.Frontmatter),
		Snippet:     snippet,
		LinksOut:    linksOut,
		LinksIn:     linksIn,
		WordCount:   wordCount,
		Headings:    headings,
	})
}

// SectionRead godoc
//
//	@Summary		Read a single heading section from a file
//	@Description	Extracts a single section from a markdown file by heading text or section index.
//	@Tags			graph
//	@Security		BearerAuth
//	@Produce		json
//	@Param			path	query		string	true	"File path in kiwifs"
//	@Param			heading	query		string	false	"Heading text of the section to extract"
//	@Param			index	query		int		false	"Index of the section to extract"
//	@Success		200		{object}	sectionReadResponse
//	@Failure		400		{object}	map[string]string
//	@Failure		404		{object}	map[string]string
//	@Router			/api/kiwi/section [get]
func (h *Handlers) SectionRead(c echo.Context) error {
	path, err := requirePath(c)
	if err != nil {
		return err
	}
	ctx := c.Request().Context()

	raw, err := readFileOr404(ctx, h.store, path)
	if err != nil {
		return err
	}

	_, body, _ := markdown.SplitFrontmatter(raw)
	if body == nil {
		body = raw
	}

	heading := c.QueryParam("heading")
	indexStr := c.QueryParam("index")

	var section *markdown.Section
	if heading != "" {
		section, err = markdown.ExtractSection(body, heading)
	} else if indexStr != "" {
		idx, parseErr := strconv.Atoi(indexStr)
		if parseErr != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "invalid index")
		}
		section, err = markdown.ExtractSectionByIndex(body, idx)
	} else {
		return echo.NewHTTPError(http.StatusBadRequest, "heading or index is required")
	}
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, err.Error())
	}

	return c.JSON(http.StatusOK, sectionReadResponse{
		Path:      path,
		Heading:   section.Heading,
		Level:     section.Level,
		Content:   section.Content,
		LineStart: section.LineStart,
		LineEnd:   section.LineEnd,
	})
}

// GraphWalk godoc
//
//	@Summary		Perform a one-hop graph traversal from a page
//	@Description	Walks the links graph from a page, returning outgoing links, incoming backlinks, directory/tag siblings, degree metrics, and page centrality/hub score.
//	@Tags			graph
//	@Security		BearerAuth
//	@Produce		json
//	@Param			path			query		string	true	"File path in kiwifs"
//	@Param			include_siblings	query		string	false	"Include tag/directory siblings in walk (default 'true')"
//	@Success		200				{object}	graphWalkResponse
//	@Failure		400				{object}	map[string]string
//	@Failure		404				{object}	map[string]string
//	@Router			/api/kiwi/graph/walk [get]
func (h *Handlers) GraphWalk(c echo.Context) error {
	path, err := requirePath(c)
	if err != nil {
		return err
	}
	ctx := c.Request().Context()

	raw, err := readFileOr404(ctx, h.store, path)
	if err != nil {
		return err
	}

	_, body, _ := markdown.SplitFrontmatter(raw)
	if body == nil {
		body = raw
	}

	includeSiblings := c.QueryParam("include_siblings") != "false"

	outLinks := links.Extract(body)
	outLinks = links.Unique(outLinks)
	if outLinks == nil {
		outLinks = []string{}
	}

	var inLinks []string
	if h.linker != nil {
		entries, _ := h.linker.Backlinks(ctx, path)
		for _, e := range entries {
			inLinks = append(inLinks, e.Path)
		}
	}
	if inLinks == nil {
		inLinks = []string{}
	}

	var siblings []graphWalkNeighbor
	if includeSiblings {
		dir := dirOf(path)
		var fileTags []string
		fm, _ := markdown.Frontmatter(raw)
		if fm != nil {
			fileTags = extractFrontmatterTags(raw)
		}

		_ = storage.Walk(ctx, h.store, "/", func(e storage.Entry) error {
			if e.Path == path {
				return nil
			}
			if dirOf(e.Path) == dir {
				siblings = append(siblings, graphWalkNeighbor{
					Path:     e.Path,
					Relation: "sibling_dir",
				})
			}
			if len(fileTags) > 0 {
				raw2, err2 := h.store.Read(ctx, e.Path)
				if err2 == nil {
					otherTags := extractFrontmatterTags(raw2)
					for _, ft := range fileTags {
						for _, ot := range otherTags {
							if strings.EqualFold(ft, ot) {
								siblings = append(siblings, graphWalkNeighbor{
									Path:      e.Path,
									Relation:  "sibling_tag",
									SharedTag: ft,
								})
							}
						}
					}
				}
			}
			return nil
		})
	}
	if siblings == nil {
		siblings = []graphWalkNeighbor{}
	}

	var hubScore float64
	if h.linker != nil {
		edges, _ := h.linker.AllEdges(ctx)
		if len(edges) > 0 {
			nodeSet := make(map[string]struct{})
			inCount := 0
			for _, e := range edges {
				nodeSet[e.Source] = struct{}{}
				nodeSet[e.Target] = struct{}{}
				for _, form := range links.TargetForms(path) {
					if strings.EqualFold(e.Target, form) {
						inCount++
						break
					}
				}
			}
			if len(nodeSet) > 0 {
				hubScore = float64(inCount) / float64(len(nodeSet))
			}
		}
	}

	return c.JSON(http.StatusOK, graphWalkResponse{
		Path:      path,
		LinksOut:  outLinks,
		LinksIn:   inLinks,
		Siblings:  siblings,
		HubScore:  hubScore,
		InDegree:  len(inLinks),
		OutDegree: len(outLinks),
	})
}

func dirOf(path string) string {
	if idx := strings.LastIndex(path, "/"); idx >= 0 {
		return path[:idx]
	}
	return ""
}

// sanitizeForJSON recursively converts map[interface{}]interface{} (YAML native)
// to map[string]interface{} (JSON-compatible). Go's encoding/json rejects the former.
func sanitizeForJSON(v any) any {
	switch val := v.(type) {
	case map[interface{}]interface{}:
		m := make(map[string]any, len(val))
		for k, v2 := range val {
			m[fmt.Sprint(k)] = sanitizeForJSON(v2)
		}
		return m
	case map[string]any:
		m := make(map[string]any, len(val))
		for k, v2 := range val {
			m[k] = sanitizeForJSON(v2)
		}
		return m
	case []interface{}:
		for i, v2 := range val {
			val[i] = sanitizeForJSON(v2)
		}
		return val
	default:
		return v
	}
}

func extractFirstParagraphAPI(body []byte, maxLen int) string {
	lines := strings.Split(string(body), "\n")
	var para strings.Builder
	inParagraph := false

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if !inParagraph {
			if trimmed == "" || strings.HasPrefix(trimmed, "#") {
				continue
			}
			inParagraph = true
		}
		if inParagraph && trimmed == "" {
			break
		}
		if para.Len() > 0 {
			para.WriteByte(' ')
		}
		para.WriteString(trimmed)
		if para.Len() >= maxLen {
			break
		}
	}

	result := para.String()
	if len(result) > maxLen {
		result = result[:maxLen]
		if idx := strings.LastIndex(result, " "); idx > 0 {
			result = result[:idx]
		}
		result += "…"
	}
	return result
}
