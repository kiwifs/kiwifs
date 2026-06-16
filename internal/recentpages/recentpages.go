package recentpages

import (
	"context"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/kiwifs/kiwifs/internal/markdown"
	"github.com/kiwifs/kiwifs/internal/storage"
)

// Page is one recently edited markdown file for the startup recent view.
type Page struct {
	Path      string `json:"path"`
	Title     string `json:"title"`
	Actor     string `json:"actor"`
	Timestamp string `json:"timestamp"`
}

// List returns up to limit recently edited markdown pages. Git timeline is
// preferred; when unavailable or empty, filesystem mtimes are used.
func List(ctx context.Context, root string, store storage.Storage, limit int) ([]Page, error) {
	if limit <= 0 {
		limit = 10
	}
	pages, err := listFromGit(ctx, root, limit)
	if err == nil && len(pages) > 0 {
		return enrichTitles(ctx, store, pages), nil
	}
	fallback, ferr := listFromStore(ctx, store, limit)
	if ferr != nil {
		if err != nil {
			return nil, err
		}
		return nil, ferr
	}
	return enrichTitles(ctx, store, fallback), nil
}

func listFromGit(ctx context.Context, root string, limit int) ([]Page, error) {
	fetchLimit := limit * 10
	if fetchLimit > 500 {
		fetchLimit = 500
	}
	args := []string{
		"log",
		"--pretty=format:COMMIT:%H|%aI|%an|%s",
		"--name-status",
		"-n", strconv.Itoa(fetchLimit),
		"--",
	}
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = root
	out, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			stderr := string(exitErr.Stderr)
			if strings.Contains(stderr, "does not have any commits") ||
				strings.Contains(stderr, "bad default revision") ||
				strings.Contains(stderr, "unknown revision") {
				return nil, nil
			}
		}
		return nil, err
	}
	return parseGitRecent(string(out), limit), nil
}

func parseGitRecent(output string, limit int) []Page {
	lines := strings.Split(strings.TrimSpace(output), "\n")
	seen := make(map[string]bool)
	var pages []Page
	var author, timestamp string

	for _, line := range lines {
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "COMMIT:") {
			parts := strings.SplitN(line[7:], "|", 4)
			if len(parts) < 4 {
				continue
			}
			timestamp = parts[1]
			author = parts[2]
			if t, err := time.Parse(time.RFC3339, timestamp); err == nil {
				timestamp = t.Format(time.RFC3339)
			}
			continue
		}
		fields := strings.Split(line, "\t")
		if len(fields) < 2 {
			continue
		}
		status := fields[0]
		if status == "" {
			continue
		}
		path := fields[1]
		switch status[0] {
		case 'R', 'C':
			if len(fields) > 2 {
				path = fields[2]
			}
			fallthrough
		case 'A', 'M':
			// keep path
		default:
			continue
		}
		if strings.HasPrefix(path, ".kiwi/") || !strings.HasSuffix(strings.ToLower(path), ".md") {
			continue
		}
		if seen[path] {
			continue
		}
		seen[path] = true
		pages = append(pages, Page{
			Path:      path,
			Title:     titleize(path),
			Actor:     author,
			Timestamp: timestamp,
		})
		if len(pages) >= limit {
			break
		}
	}
	return pages
}

func listFromStore(ctx context.Context, store storage.Storage, limit int) ([]Page, error) {
	var all []Page
	err := storage.WalkFilter(ctx, store, "", func(e storage.Entry) bool {
		return !e.IsDir && strings.HasSuffix(strings.ToLower(e.Path), ".md")
	}, func(e storage.Entry) error {
		all = append(all, Page{
			Path:      e.Path,
			Title:     titleize(e.Path),
			Actor:     "",
			Timestamp: e.ModTime.UTC().Format(time.RFC3339),
		})
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(all, func(i, j int) bool {
		return all[i].Timestamp > all[j].Timestamp
	})
	if len(all) > limit {
		all = all[:limit]
	}
	return all, nil
}

func enrichTitles(ctx context.Context, store storage.Storage, pages []Page) []Page {
	for i, p := range pages {
		content, err := store.Read(ctx, p.Path)
		if err != nil {
			continue
		}
		fm, err := markdown.Frontmatter(content)
		if err != nil {
			continue
		}
		if title, ok := fm["title"].(string); ok && strings.TrimSpace(title) != "" {
			pages[i].Title = title
		}
	}
	return pages
}

func titleize(path string) string {
	base := filepath.Base(path)
	base = strings.TrimSuffix(base, filepath.Ext(base))
	base = strings.ReplaceAll(base, "-", " ")
	base = strings.ReplaceAll(base, "_", " ")
	words := strings.Fields(base)
	for i, w := range words {
		if w == "" {
			continue
		}
		words[i] = strings.ToUpper(w[:1]) + w[1:]
	}
	return strings.Join(words, " ")
}
