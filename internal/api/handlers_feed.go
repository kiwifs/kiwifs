package api

import (
	"context"
	"net/http"
	"time"

	"github.com/gorilla/feeds"
	"github.com/kiwifs/kiwifs/internal/rbac"
	"github.com/labstack/echo/v4"
)

// FeedAtom godoc
//
//	@Summary		Get Atom activity feed
//	@Description	Generates an Atom XML activity feed of recent changes in the knowledge base.
//	@Tags			feed
//	@Security		BearerAuth
//	@Produce		xml
//	@Param			filter	query		string	false	"Filter events (e.g. 'published' to only show events for published pages)"
//	@Success		200		{string}	string	"Atom XML feed content"
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/feed.xml [get]
func (h *Handlers) FeedAtom(c echo.Context) error {
	filter := c.QueryParam("filter")
	feed, err := h.buildFeed(c.Request().Context(), filter)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	atom, err := feed.ToAtom()
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	return c.Blob(http.StatusOK, "application/atom+xml; charset=UTF-8", []byte(atom))
}

// FeedJSON godoc
//
//	@Summary		Get JSON activity feed
//	@Description	Generates a JSON activity feed of recent changes in the knowledge base.
//	@Tags			feed
//	@Security		BearerAuth
//	@Produce		json
//	@Param			filter	query		string	false	"Filter events (e.g. 'published' to only show events for published pages)"
//	@Success		200		{string}	string	"JSON feed content"
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/feed.json [get]
func (h *Handlers) FeedJSON(c echo.Context) error {
	filter := c.QueryParam("filter")
	feed, err := h.buildFeed(c.Request().Context(), filter)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	jsonFeed, err := feed.ToJSON()
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	c.Response().Header().Set("Content-Type", "application/feed+json; charset=utf-8")
	return c.String(http.StatusOK, jsonFeed)
}

// buildFeed creates a feeds.Feed from recent timeline events.
// When filter is "published", only events for files with published: true are included.
func (h *Handlers) buildFeed(ctx context.Context, filter string) (*feeds.Feed, error) {
	// Fetch recent timeline events (last 50)
	events, err := h.fetchTimelineEvents(ctx, 50, "", "", "")
	if err != nil {
		return nil, err
	}

	now := time.Now()
	feed := &feeds.Feed{
		Title:       "KiwiFS Activity Feed",
		Link:        &feeds.Link{Href: h.publicURL},
		Description: "Recent changes to the knowledge base",
		Created:     now,
	}

	// Convert timeline events to feed items
	for _, event := range events {
		// When filter=published, skip events for non-published files.
		if filter == "published" && event.Type != "delete" {
			content, err := h.store.Read(ctx, event.Path)
			if err != nil {
				continue
			}
			if !rbac.PagePublished(content) {
				continue
			}
		}

		timestamp, err := time.Parse(time.RFC3339, event.Timestamp)
		if err != nil {
			timestamp = now
		}

		// Build item title
		title := event.Path
		if event.Type == "delete" {
			title = "Deleted: " + event.Path
		} else {
			title = "Updated: " + event.Path
		}

		// Build permalink for the file
		link := h.publicURL
		if link != "" && event.Type != "delete" {
			if link[len(link)-1] != '/' {
				link += "/"
			}
			link += event.Path
		}

		item := &feeds.Item{
			Title:       title,
			Link:        &feeds.Link{Href: link},
			Description: event.Message,
			Author:      &feeds.Author{Name: event.Actor},
			Created:     timestamp,
			Id:          event.Path + "@" + event.Timestamp,
		}

		feed.Items = append(feed.Items, item)
	}

	return feed, nil
}
