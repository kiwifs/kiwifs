package api

import (
	"context"
	"net/http"
	"strings"

	"github.com/kiwifs/kiwifs/internal/janitor"
	"github.com/kiwifs/kiwifs/internal/links"
	"github.com/kiwifs/kiwifs/internal/storage"
	"github.com/labstack/echo/v4"
)

type brokenLinkEntry struct {
	Source  string `json:"source"`
	Target string `json:"target"`
	Match  string `json:"match,omitempty"`
}

// BrokenLinks godoc
//
//	@Summary		List broken wiki links
//	@Description	Scans all pages and returns wiki links that do not resolve to any existing file.
//	@Tags			refactor
//	@Security		BearerAuth
//	@Success		200		{object}	map[string]any
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/links/broken [get]
func (h *Handlers) BrokenLinks(c echo.Context) error {
	scanner := janitor.New(h.root, h.store, h.searcher, 90)
	result, err := scanner.Scan(c.Request().Context())
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	var broken []brokenLinkEntry
	for _, issue := range result.Issues {
		if issue.Kind != janitor.IssueBrokenLink {
			continue
		}
		target := ""
		if len(issue.Related) > 0 {
			target = issue.Related[0]
		}
		if strings.HasSuffix(target, "\\") {
			continue
		}
		match := fuzzyMatch(c.Request().Context(), h.store, target)
		broken = append(broken, brokenLinkEntry{
			Source: issue.Path,
			Target: target,
			Match:  match,
		})
	}
	if broken == nil {
		broken = []brokenLinkEntry{}
	}

	return c.JSON(http.StatusOK, map[string]any{
		"broken": broken,
		"count":  len(broken),
	})
}

type orphanEntry struct {
	Path string `json:"path"`
}

// Orphans godoc
//
//	@Summary		List orphan pages
//	@Description	Returns pages with no inbound wiki links.
//	@Tags			refactor
//	@Security		BearerAuth
//	@Success		200		{object}	map[string]any
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/links/orphans [get]
func (h *Handlers) Orphans(c echo.Context) error {
	scanner := janitor.New(h.root, h.store, h.searcher, 90)
	result, err := scanner.Scan(c.Request().Context())
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	var orphans []orphanEntry
	for _, issue := range result.Issues {
		if issue.Kind != janitor.IssueOrphan {
			continue
		}
		orphans = append(orphans, orphanEntry{Path: issue.Path})
	}
	if orphans == nil {
		orphans = []orphanEntry{}
	}

	return c.JSON(http.StatusOK, map[string]any{
		"orphans": orphans,
		"count":   len(orphans),
	})
}

type fixResult struct {
	Source    string `json:"source"`
	OldTarget string `json:"old_target"`
	NewTarget string `json:"new_target"`
}

type fixBrokenRequest struct {
	DryRun bool `json:"dry_run"`
}

// FixBrokenLinks godoc
//
//	@Summary		Auto-fix broken wiki links
//	@Description	Scans for broken wiki links and attempts to fix them by fuzzy-matching targets against existing files. Pass dry_run=true to preview without writing.
//	@Tags			refactor
//	@Security		BearerAuth
//	@Param			body	body		fixBrokenRequest	true	"Options"
//	@Success		200		{object}	map[string]any
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/refactor/fix-broken [post]
func (h *Handlers) FixBrokenLinks(c echo.Context) error {
	var req fixBrokenRequest
	if err := bindJSON(c, &req); err != nil {
		req.DryRun = c.QueryParam("dry_run") == "true"
	}

	ctx := c.Request().Context()
	scanner := janitor.New(h.root, h.store, h.searcher, 90)
	result, err := scanner.Scan(ctx)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	// Group broken links by source file.
	type pendingFix struct {
		OldTarget string
		NewTarget string
	}
	bySource := make(map[string][]pendingFix)
	var fixes []fixResult

	for _, issue := range result.Issues {
		if issue.Kind != janitor.IssueBrokenLink {
			continue
		}
		if len(issue.Related) == 0 {
			continue
		}
		target := issue.Related[0]
		if strings.HasSuffix(target, "\\") {
			continue
		}
		match := fuzzyMatch(ctx, h.store, target)
		if match == "" {
			continue
		}
		newTarget := strings.TrimSuffix(match, ".md")
		bySource[issue.Path] = append(bySource[issue.Path], pendingFix{
			OldTarget: target,
			NewTarget: newTarget,
		})
		fixes = append(fixes, fixResult{
			Source:    issue.Path,
			OldTarget: target,
			NewTarget: match,
		})
	}

	if fixes == nil {
		fixes = []fixResult{}
	}

	if !req.DryRun {
		actor := sanitizeActor(c.Request().Header.Get("X-Actor"))
		for sourcePath, pending := range bySource {
			content, rerr := h.store.Read(ctx, sourcePath)
			if rerr != nil {
				continue
			}
			text := string(content)
			changed := false
			for _, fix := range pending {
				rewritten, ok := links.RewriteLinks(text, fix.OldTarget, fix.NewTarget)
				if ok {
					text = rewritten
					changed = true
				}
			}
			if changed {
				if _, werr := h.pipe.Write(ctx, sourcePath, []byte(text), actor); werr != nil {
					continue
				}
			}
		}
	}

	return c.JSON(http.StatusOK, map[string]any{
		"fixes":   fixes,
		"count":   len(fixes),
		"dry_run": req.DryRun,
	})
}

// fuzzyMatch tries to find an existing file matching a broken wiki-link target.
// It prefers exact path matches, then path-suffix matches (matching directory
// components from right to left), then bare basename matches.
func fuzzyMatch(ctx context.Context, store storage.Storage, target string) string {
	if target == "" {
		return ""
	}

	targetClean := strings.TrimSuffix(target, ".md")
	targetClean = strings.TrimSuffix(targetClean, "\\")
	targetLower := strings.ToLower(targetClean)

	if targetLower == "" {
		return ""
	}

	base := targetClean
	if i := strings.LastIndex(base, "/"); i >= 0 {
		base = base[i+1:]
	}
	baseLower := strings.ToLower(base)

	// Bare "_index" with no directory component is ambiguous (every dir has one).
	if baseLower == "_index" && !strings.Contains(targetClean, "/") {
		return ""
	}
	if baseLower == "" {
		return ""
	}

	// Strip numeric prefix for fuzzy directory matching (e.g. "06-prefix-sum" → "prefix-sum").
	stripNumPrefix := func(s string) string {
		parts := strings.SplitN(s, "-", 2)
		if len(parts) == 2 && len(parts[0]) > 0 {
			allDigit := true
			for _, c := range parts[0] {
				if c < '0' || c > '9' {
					allDigit = false
					break
				}
			}
			if allDigit {
				return parts[1]
			}
		}
		return s
	}

	// Build a "stripped" version of the target for fuzzy dir matching.
	// e.g. "06-prefix-sum/_index" → "prefix-sum/_index"
	targetParts := strings.Split(targetLower, "/")
	var strippedTarget []string
	for _, p := range targetParts {
		strippedTarget = append(strippedTarget, stripNumPrefix(p))
	}
	strippedTargetLower := strings.Join(strippedTarget, "/")

	type candidate struct {
		path  string
		score int // higher is better: 4=exact, 3=suffix, 2=stripped-suffix, 1=basename
	}
	var best candidate

	_ = storage.Walk(ctx, store, "/", func(entry storage.Entry) error {
		if entry.IsDir || !strings.HasSuffix(entry.Path, ".md") {
			return nil
		}
		entryStem := strings.TrimSuffix(entry.Path, ".md")
		entryStemLower := strings.ToLower(entryStem)

		score := 0
		if entryStemLower == targetLower {
			score = 4
		} else if strings.HasSuffix(entryStemLower, "/"+targetLower) {
			score = 3
		} else {
			// Try stripped (numberless) suffix match.
			entryParts := strings.Split(entryStemLower, "/")
			var strippedEntry []string
			for _, p := range entryParts {
				strippedEntry = append(strippedEntry, stripNumPrefix(p))
			}
			strippedEntryLower := strings.Join(strippedEntry, "/")
			if strings.HasSuffix(strippedEntryLower, "/"+strippedTargetLower) || strippedEntryLower == strippedTargetLower {
				score = 2
			} else {
				entryBase := entryStem
				if i := strings.LastIndex(entryBase, "/"); i >= 0 {
					entryBase = entryBase[i+1:]
				}
				if strings.ToLower(entryBase) == baseLower && baseLower != "_index" {
					score = 1
				}
			}
		}

		if score > best.score {
			best = candidate{path: entry.Path, score: score}
		}
		return nil
	})

	return best.path
}
