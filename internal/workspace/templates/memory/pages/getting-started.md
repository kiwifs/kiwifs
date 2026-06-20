---
title: Getting Started
description: How this knowledge base is organized and how to use it
tags: [meta, onboarding]
status: active
context-layer: reference
freshness-days: 180
---

# Getting Started

This knowledge base is maintained using the LLM Wiki pattern.

## Structure

- `pages/` — durable knowledge, one concept per page
- `episodes/` — session notes, consolidated into pages over time
- `index.md` — table of contents
- `log.md` — chronological record of all changes

## Memory Tiers

| Tier | Location | Purpose |
|------|----------|---------|
| Episodic | `episodes/` | Raw observations from sessions |
| Semantic | `pages/` | Distilled, durable facts |
| Procedural | `.kiwi/playbook.md` | Operational policies |

Episodes are consolidated into pages over time. High-importance
episodes are consolidated immediately; low-importance ones are
reviewed on a weekly cadence.

## Memory lifecycle

1. **Write episodes** — during a session, agents append raw observations
   under `episodes/` with `memory_kind: episodic`, a unique `episode_id`,
   and optional `scope`, `confidence`, and `expires_at`.
2. **Consolidate into semantic pages** — a scheduled job or on-demand pass
   merges related episodes into durable `pages/` entries. Set `merged-from`
   on the page to cite the source `episode_id` values.
3. **Mark consolidated episodes** — update source episodes with
   `consolidated: true` and `merged-into` pointing at the new page paths.
4. **Track coverage** — run `kiwifs memory report` to list episodes not yet
   referenced by any `merged-from`. A green report means every episodic file
   has been folded into semantic memory.

Old episodes stay in git for audit; they are not deleted when consolidated.
Use `memory_status: superseded` on replaced pages rather than removing files.

## How It Works

An agent [[SCHEMA|follows the schema]] to ingest new information,
answer questions from existing pages, and periodically lint for
quality. See `.kiwi/playbook.md` for the full operation guide.

## Conventions

- Every page has YAML frontmatter with `title` and `tags`
- Pages link to each other with `[[wikilinks]]`
- One concept per page — split when a page exceeds 300 lines
- Always cite sources via `source-uri` or `derived-from`
- Set `importance` on episodes to guide consolidation priority
- Never overwrite without reading first — resolve contradictions explicitly
