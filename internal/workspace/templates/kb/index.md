---
title: Knowledge Base
owner: team-lead
status: active
tags: [meta, navigation]
verified_at: 2026-01-01
review_interval: 90
---

# Knowledge Base

Welcome to the knowledge base. Find answers by category below, or use search.

## Categories

- [[getting-started/index|Getting Started]] — Setup, first steps, quickstart guides
- [[guides/index|Guides]] — How-to articles for common tasks
- [[troubleshooting/index|Troubleshooting]] — Symptom-based problem resolution
- [[reference/index|Reference]] — Technical details, settings, glossary
- [[faq/index|FAQ]] — Quick answers to common questions

## Recently Verified

_Use `kiwi_query` to generate:_

```kiwi-query
TABLE title, verified_at, owner
FROM ""
WHERE verified_at != null
SORT verified_at DESC
LIMIT 5
```
