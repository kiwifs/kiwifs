package api

import (
	"net/http"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/kiwifs/kiwifs/internal/storage"
	"github.com/labstack/echo/v4"
)

type velocityHotSpot struct {
	Path         string `json:"path" example:"/docs/getting-started.md"`
	Changes      int    `json:"changes" example:"15"`
	Authors      int    `json:"authors" example:"3"`
	LinesChanged int    `json:"lines_changed" example:"240"`
}

type velocityColdSpot struct {
	Path            string `json:"path" example:"/docs/archived.md"`
	DaysSinceChange int    `json:"days_since_change" example:"120"`
}

type velocityBurst struct {
	Path       string  `json:"path" example:"/docs/active.md"`
	RecentRate float64 `json:"recent_rate" example:"2.5"`
	AvgRate    float64 `json:"avg_rate" example:"0.5"`
}

type velocityResponse struct {
	Period            string             `json:"period" example:"30d"`
	TotalChanges      int                `json:"total_changes" example:"142"`
	HotSpots          []velocityHotSpot  `json:"hot_spots"`
	ColdSpots         []velocityColdSpot `json:"cold_spots"`
	Bursts            []velocityBurst    `json:"bursts"`
	SingleAuthorPages []string           `json:"single_author_pages" example:"/docs/internal.md"`
}

// Velocity godoc
//
//	@Summary		Get repository editing velocity metrics
//	@Description	Analyzes git log and repository changes to calculate page activity metrics including hot spots (frequently edited pages), cold spots (inactive pages), bursts (sudden spikes in activity), and single-author pages.
//	@Tags			analytics
//	@Security		BearerAuth
//	@Produce		json
//	@Param			period		query		string	false	"Time period to analyze (e.g. 30d, 2w, 3m). Default '30d'."
//	@Param			limit		query		int		false	"Maximum number of hot spots to return. Default 20."
//	@Param			path_prefix	query		string	false	"Optional directory path prefix to filter pages."
//	@Success		200			{object}	velocityResponse
//	@Failure		500			{object}	map[string]string
//	@Router			/api/kiwi/velocity [get]
func (h *Handlers) Velocity(c echo.Context) error {
	ctx := c.Request().Context()

	period := c.QueryParam("period")
	if period == "" {
		period = "30d"
	}
	limit := 20
	if l := c.QueryParam("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 {
			limit = v
		}
	}
	pathPrefix := c.QueryParam("path_prefix")

	sinceArg := "--since=" + velocityParsePeriod(period)
	cmd := exec.CommandContext(ctx, "git", "log", "--numstat", "--format=%H|%an|%at", sinceArg)
	cmd.Dir = h.root
	out, err := cmd.Output()
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "git log failed")
	}

	type fileChange struct {
		adds, dels int
		authors    map[string]bool
		timestamps []time.Time
	}
	files := make(map[string]*fileChange)
	var currentAuthor string
	var currentTime time.Time

	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if strings.Contains(line, "|") && !strings.Contains(line, "\t") {
			parts := strings.SplitN(line, "|", 3)
			if len(parts) >= 3 {
				currentAuthor = parts[1]
				ts, _ := strconv.ParseInt(parts[2], 10, 64)
				currentTime = time.Unix(ts, 0)
			}
			continue
		}
		parts := strings.Split(line, "\t")
		if len(parts) != 3 {
			continue
		}
		adds, _ := strconv.Atoi(parts[0])
		dels, _ := strconv.Atoi(parts[1])
		path := parts[2]
		if !strings.HasSuffix(path, ".md") {
			continue
		}
		if pathPrefix != "" && !strings.HasPrefix(path, pathPrefix) {
			continue
		}
		fc, ok := files[path]
		if !ok {
			fc = &fileChange{authors: make(map[string]bool)}
			files[path] = fc
		}
		fc.adds += adds
		fc.dels += dels
		fc.authors[currentAuthor] = true
		fc.timestamps = append(fc.timestamps, currentTime)
	}

	type scored struct {
		path    string
		changes int
		authors int
		lines   int
	}
	var items []scored
	totalChanges := 0
	for path, fc := range files {
		changes := len(fc.timestamps)
		totalChanges += changes
		items = append(items, scored{path: path, changes: changes, authors: len(fc.authors), lines: fc.adds + fc.dels})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].changes > items[j].changes })

	topN := limit
	if topN > len(items) {
		topN = len(items)
	}
	hotSpots := make([]velocityHotSpot, topN)
	for i := 0; i < topN; i++ {
		hotSpots[i] = velocityHotSpot{Path: items[i].path, Changes: items[i].changes, Authors: items[i].authors, LinesChanged: items[i].lines}
	}

	var coldSpots []velocityColdSpot
	periodDaysVal := velocityParsePeriodDays(period)
	_ = storage.Walk(ctx, h.store, "/", func(e storage.Entry) error {
		if !strings.HasSuffix(e.Path, ".md") {
			return nil
		}
		if pathPrefix != "" && !strings.HasPrefix(e.Path, pathPrefix) {
			return nil
		}
		if _, ok := files[e.Path]; !ok {
			days := periodDaysVal
			gitCmd := exec.CommandContext(ctx, "git", "log", "-1", "--format=%at", "--", e.Path)
			gitCmd.Dir = h.root
			if gitOut, gerr := gitCmd.Output(); gerr == nil {
				if ts, perr := strconv.ParseInt(strings.TrimSpace(string(gitOut)), 10, 64); perr == nil && ts > 0 {
					days = int(time.Since(time.Unix(ts, 0)).Hours() / 24)
				}
			}
			coldSpots = append(coldSpots, velocityColdSpot{Path: e.Path, DaysSinceChange: days})
		}
		return nil
	})

	var bursts []velocityBurst
	sevenDaysAgo := time.Now().AddDate(0, 0, -7)
	periodDays := velocityParsePeriodDays(period)
	for _, item := range items {
		fc := files[item.path]
		recentCount := 0
		for _, ts := range fc.timestamps {
			if ts.After(sevenDaysAgo) {
				recentCount++
			}
		}
		recentRate := float64(recentCount) / 7.0
		avgRate := float64(item.changes) / float64(periodDays)
		if avgRate > 0 && recentRate > 3*avgRate {
			bursts = append(bursts, velocityBurst{Path: item.path, RecentRate: recentRate, AvgRate: avgRate})
		}
	}

	var singleAuthor []string
	for path, fc := range files {
		if len(fc.authors) == 1 {
			singleAuthor = append(singleAuthor, path)
		}
	}

	if hotSpots == nil {
		hotSpots = []velocityHotSpot{}
	}
	if coldSpots == nil {
		coldSpots = []velocityColdSpot{}
	}
	if bursts == nil {
		bursts = []velocityBurst{}
	}
	if singleAuthor == nil {
		singleAuthor = []string{}
	}

	return c.JSON(http.StatusOK, velocityResponse{
		Period:            period,
		TotalChanges:      totalChanges,
		HotSpots:          hotSpots,
		ColdSpots:         coldSpots,
		Bursts:            bursts,
		SingleAuthorPages: singleAuthor,
	})
}

func velocityParsePeriod(period string) string {
	period = strings.TrimSpace(period)
	if strings.HasSuffix(period, "d") {
		return period[:len(period)-1] + " days ago"
	}
	if strings.HasSuffix(period, "w") {
		return period[:len(period)-1] + " weeks ago"
	}
	if strings.HasSuffix(period, "m") {
		return period[:len(period)-1] + " months ago"
	}
	return "30 days ago"
}

func velocityParsePeriodDays(period string) int {
	period = strings.TrimSpace(period)
	if strings.HasSuffix(period, "d") {
		n, _ := strconv.Atoi(period[:len(period)-1])
		if n > 0 {
			return n
		}
	}
	if strings.HasSuffix(period, "w") {
		n, _ := strconv.Atoi(period[:len(period)-1])
		if n > 0 {
			return n * 7
		}
	}
	if strings.HasSuffix(period, "m") {
		n, _ := strconv.Atoi(period[:len(period)-1])
		if n > 0 {
			return n * 30
		}
	}
	return 30
}
