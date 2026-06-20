---
title: Content Site
owner: content-lead
status: active
tags: [meta, navigation]
---

# Content Site

A git-based headless CMS powered by KiwiFS. Content is authored as markdown
with structured frontmatter, published via the REST API or public reader,
and syndicated via Atom/JSON feeds.

## Content Types

- [[blog/index|Blog]] — Articles, announcements, and thought leadership
- [[docs/index|Docs]] — Product documentation and guides
- [[pages/index|Pages]] — Static pages (about, contact, landing pages)
- [[authors/index|Authors]] — Content author profiles

## Publishing

Set `published: true` in frontmatter to make content available at `/p/{path}`.
Use the editorial workflow to move content through `draft → review → scheduled → published`.

## Feeds

Published content is available via:
- Atom feed: `/api/kiwi/feed/atom`
- JSON feed: `/api/kiwi/feed/json`
