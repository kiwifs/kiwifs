---
title: Data Workspace
owner: data-lead
status: active
tags: [meta, navigation]
---

# Data Workspace

A structured data workspace for importing, querying, and visualizing data
as markdown. Each record becomes a markdown file with frontmatter — queryable
via DQL, searchable via FTS5 + vector, and visualizable with inline charts.

## Sections

- [[collections/index|Collections]] — Data records organized by type
- [[dashboards/index|Dashboards]] — Live-updating views and charts
- [[imports/README|Imports]] — How to ingest data from external sources

## Quick Stats

```kiwi-query
TABLE COUNT() AS total_records
FROM "collections/"
```
