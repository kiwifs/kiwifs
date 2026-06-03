package importer

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ConfluenceAPISource fetches pages from a Confluence Cloud instance via REST API,
// preserving page tree hierarchy, mapping macros, and importing attachments.
type ConfluenceAPISource struct {
	baseURL  string
	spaceKey string
	email    string
	token    string
	client   *http.Client

	pages       []confluencePage
	attachments map[string][]confluenceAttachment // pageID -> attachments
}

type confluenceAttachment struct {
	Title       string
	DownloadURL string
	MediaType   string
	FileSize    int64
	Data        []byte
}

type confluenceAPIPage struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Title    string `json:"title"`
	Status   string `json:"status"`
	Body     struct {
		Storage struct {
			Value string `json:"value"`
		} `json:"storage"`
		View struct {
			Value string `json:"value"`
		} `json:"view"`
	} `json:"body"`
	Ancestors []struct {
		ID    string `json:"id"`
		Title string `json:"title"`
	} `json:"ancestors"`
	Children struct {
		Page struct {
			Results []confluenceAPIPage `json:"results"`
			Size    int                 `json:"size"`
		} `json:"page"`
	} `json:"children"`
	Metadata struct {
		Labels struct {
			Results []struct {
				Name string `json:"name"`
			} `json:"results"`
		} `json:"labels"`
	} `json:"metadata"`
	Version struct {
		Number int    `json:"number"`
		When   string `json:"when"`
	} `json:"version"`
}

type confluenceAPIResponse struct {
	Results []confluenceAPIPage `json:"results"`
	Start   int                 `json:"start"`
	Limit   int                 `json:"limit"`
	Size    int                 `json:"size"`
	Links   struct {
		Next string `json:"next"`
	} `json:"_links"`
}

type confluenceAttachmentResponse struct {
	Results []struct {
		ID        string `json:"id"`
		Title     string `json:"title"`
		MediaType string `json:"mediaType"`
		FileSize  int64  `json:"fileSize"`
		Links     struct {
			Download string `json:"download"`
			Self     string `json:"self"`
		} `json:"_links"`
	} `json:"results"`
	Links struct {
		Next string `json:"next"`
	} `json:"_links"`
}

// NewConfluenceAPI creates a live API-based Confluence source.
// It reads credentials from environment if not provided.
func NewConfluenceAPI(baseURL, spaceKey, email, token string) (*ConfluenceAPISource, error) {
	if baseURL == "" {
		baseURL = os.Getenv("CONFLUENCE_BASE_URL")
	}
	if email == "" {
		email = os.Getenv("CONFLUENCE_EMAIL")
	}
	if token == "" {
		token = os.Getenv("CONFLUENCE_API_TOKEN")
	}
	if baseURL == "" {
		return nil, fmt.Errorf("confluence base URL is required (set CONFLUENCE_BASE_URL or pass --url)")
	}
	if email == "" || token == "" {
		return nil, fmt.Errorf("confluence credentials required (set CONFLUENCE_EMAIL and CONFLUENCE_API_TOKEN)")
	}

	baseURL = strings.TrimRight(baseURL, "/")

	s := &ConfluenceAPISource{
		baseURL:     baseURL,
		spaceKey:    spaceKey,
		email:       email,
		token:       token,
		client:      &http.Client{Timeout: 30 * time.Second},
		attachments: make(map[string][]confluenceAttachment),
	}

	if err := s.fetchAll(); err != nil {
		return nil, fmt.Errorf("confluence API: %w", err)
	}
	return s, nil
}

func (s *ConfluenceAPISource) Name() string {
	if s.spaceKey != "" {
		return "confluence-" + strings.ToLower(s.spaceKey)
	}
	return "confluence-api"
}

func (s *ConfluenceAPISource) Close() error { return nil }

func (s *ConfluenceAPISource) doRequest(ctx context.Context, path string) ([]byte, error) {
	reqURL := s.baseURL + path
	req, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(s.email, s.token)
	req.Header.Set("Accept", "application/json")

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request %s: %w", reqURL, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API %s returned %d: %s", path, resp.StatusCode, string(body[:min(len(body), 200)]))
	}
	return body, nil
}

func (s *ConfluenceAPISource) fetchAll() error {
	ctx := context.Background()

	// Fetch all pages in the space with ancestors for hierarchy
	var allPages []confluenceAPIPage
	start := 0
	limit := 25

	for {
		path := fmt.Sprintf("/rest/api/content?spaceKey=%s&type=page&start=%d&limit=%d&expand=body.storage,ancestors,version,metadata.labels,children.page",
			url.QueryEscape(s.spaceKey), start, limit)

		data, err := s.doRequest(ctx, path)
		if err != nil {
			return err
		}

		var resp confluenceAPIResponse
		if err := json.Unmarshal(data, &resp); err != nil {
			return fmt.Errorf("parse response: %w", err)
		}

		allPages = append(allPages, resp.Results...)

		if resp.Links.Next == "" || len(resp.Results) == 0 {
			break
		}
		start += limit
	}

	// Build a page ID -> title map for hierarchy resolution
	pageIDTitle := make(map[string]string)
	for _, p := range allPages {
		pageIDTitle[p.ID] = p.Title
	}

	// Convert API pages to internal representation with hierarchy paths
	for _, apiPage := range allPages {
		hierarchyPath := s.buildHierarchyPath(apiPage)
		storageHTML := apiPage.Body.Storage.Value
		md := convertStorageFormat(storageHTML)

		meta := map[string]any{
			"title":             apiPage.Title,
			"confluence_id":     apiPage.ID,
			"confluence_status": apiPage.Status,
			"version":          apiPage.Version.Number,
		}
		if apiPage.Version.When != "" {
			meta["last_modified"] = apiPage.Version.When
		}
		if labels := extractLabels(apiPage); len(labels) > 0 {
			meta["tags"] = labels
		}

		s.pages = append(s.pages, confluencePage{
			relPath:  hierarchyPath,
			title:    apiPage.Title,
			markdown: md,
			meta:     meta,
		})

		// Fetch attachments for this page
		if err := s.fetchAttachments(ctx, apiPage.ID); err != nil {
			// Non-fatal: log but continue
			fmt.Fprintf(os.Stderr, "warning: failed to fetch attachments for page %q: %v\n", apiPage.Title, err)
		}
	}

	return nil
}

func (s *ConfluenceAPISource) buildHierarchyPath(page confluenceAPIPage) string {
	var parts []string
	for _, ancestor := range page.Ancestors {
		parts = append(parts, slugifyTitle(ancestor.Title))
	}
	parts = append(parts, slugifyTitle(page.Title))
	return strings.Join(parts, "/")
}

func (s *ConfluenceAPISource) fetchAttachments(ctx context.Context, pageID string) error {
	path := fmt.Sprintf("/rest/api/content/%s/child/attachment?expand=version", pageID)
	data, err := s.doRequest(ctx, path)
	if err != nil {
		return err
	}

	var resp confluenceAttachmentResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return err
	}

	for _, att := range resp.Results {
		// Use the proper REST API download endpoint (works with API token auth)
		// Format: /rest/api/content/{pageId}/child/attachment/{attachmentId}/download
		downloadPath := fmt.Sprintf("/rest/api/content/%s/child/attachment/%s/download", pageID, att.ID)
		attData, err := s.downloadAttachment(ctx, s.baseURL+downloadPath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "warning: failed to download attachment %q: %v\n", att.Title, err)
			continue
		}

		s.attachments[pageID] = append(s.attachments[pageID], confluenceAttachment{
			Title:       att.Title,
			DownloadURL: att.Links.Download,
			MediaType:   att.MediaType,
			FileSize:    att.FileSize,
			Data:        attData,
		})
	}
	return nil
}

func (s *ConfluenceAPISource) downloadAttachment(ctx context.Context, downloadURL string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", downloadURL, nil)
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(s.email, s.token)

	// Use a client that follows redirects and re-sends auth
	client := &http.Client{
		Timeout: 60 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			// Preserve auth header across redirects
			if len(via) > 0 {
				req.SetBasicAuth(s.email, s.token)
			}
			return nil
		},
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download returned %d", resp.StatusCode)
	}

	return io.ReadAll(resp.Body)
}

func (s *ConfluenceAPISource) Stream(ctx context.Context) (<-chan Record, <-chan error) {
	records := make(chan Record, 64)
	errs := make(chan error, 1)

	go func() {
		defer close(records)
		defer close(errs)

		name := s.Name()
		for i, p := range s.pages {
			if ctx.Err() != nil {
				return
			}

			fields := make(map[string]any, len(p.meta)+1)
			for k, v := range p.meta {
				fields[k] = v
			}
			fields["_raw_content"] = p.markdown

			// Use hierarchy path as primary key (preserves directory structure)
			pk := p.relPath

			rec := Record{
				SourceID:   fmt.Sprintf("confluence-api:%s:%d", name, i),
				SourceDSN:  s.baseURL,
				Table:      name,
				Fields:     fields,
				PrimaryKey: pk,
			}
			select {
			case records <- rec:
			case <-ctx.Done():
				return
			}
		}

		// Stream attachments as separate records
		for pageID, atts := range s.attachments {
			for _, att := range atts {
				if ctx.Err() != nil {
					return
				}

				pagePath := s.findPagePath(pageID)
				attPath := filepath.Join(filepath.Dir(pagePath), "_assets", att.Title)

				fields := map[string]any{
					"_raw_content":  string(att.Data),
					"_is_binary":    true,
					"_binary_data":  att.Data,
					"media_type":    att.MediaType,
					"title":         att.Title,
					"attachment_of": pagePath,
				}

				rec := Record{
					SourceID:   fmt.Sprintf("confluence-api:%s:att:%s:%s", name, pageID, att.Title),
					SourceDSN:  s.baseURL,
					Table:      name,
					Fields:     fields,
					PrimaryKey: attPath,
				}
				select {
				case records <- rec:
				case <-ctx.Done():
					return
				}
			}
		}
	}()

	return records, errs
}

func (s *ConfluenceAPISource) findPagePath(pageID string) string {
	for _, p := range s.pages {
		if id, ok := p.meta["confluence_id"].(string); ok && id == pageID {
			return p.relPath
		}
	}
	return pageID
}

func extractLabels(page confluenceAPIPage) []string {
	var labels []string
	for _, l := range page.Metadata.Labels.Results {
		if l.Name != "" {
			labels = append(labels, l.Name)
		}
	}
	return labels
}

// slugifyTitle converts a page title to a filesystem-safe slug preserving readability.
func slugifyTitle(title string) string {
	s := strings.ToLower(strings.TrimSpace(title))
	s = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			return r
		}
		if r == ' ' || r == '_' || r == '/' {
			return '-'
		}
		return -1
	}, s)
	for strings.Contains(s, "--") {
		s = strings.ReplaceAll(s, "--", "-")
	}
	return strings.Trim(s, "-")
}

// convertStorageFormat converts Confluence Storage Format (XHTML) to Markdown,
// handling Confluence-specific macros and structured content.
func convertStorageFormat(storageXML string) string {
	if storageXML == "" {
		return ""
	}

	md := storageXML

	// Convert Confluence macros BEFORE HTML conversion
	md = convertConfluenceMacros(md)

	// Parse as HTML and convert to markdown
	doc := parseHTMLString(md)
	if doc == nil {
		return md
	}

	result := htmlToMarkdown(doc)
	return strings.TrimSpace(result)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
