# Schema — Knowledge Base

_Template version: 2.0_

Agent-maintained knowledge base following the LLM Wiki pattern:
raw sources in, compiled wiki out, agent maintains it over time.
Includes episodic memory with consolidation into durable pages.

## Directory Structure

    pages/           Durable knowledge — one page per concept, entity, or topic
    episodes/        Per-session episodic notes (transient, consolidate later)
    index.md         Auto-maintained table of contents
    log.md           Append-only chronological record of all operations
    SCHEMA.md        This file — structure and conventions

## Memory Architecture

This knowledge base implements a tiered memory system:

| Tier | Storage | Purpose | Retrieval |
|------|---------|---------|-----------|
| **Episodic** | `episodes/` | Raw session observations, decisions, interactions | Temporal + similarity |
| **Semantic** | `pages/` | Distilled durable facts, one concept per page | Keyword + graph + semantic |
| **Procedural** | `.kiwi/playbook.md` | Learned routines and operational policies | By intent |

Consolidation moves high-value episodic traces into semantic pages.
Raw episodes are preserved alongside distilled facts for audit and rollback.

## Episodes

Use `episodes/` for per-run or per-session raw notes that should be
consolidated into durable `pages/` later. Files under this directory are
classified as episodic automatically, and agents should still set
`memory_kind: episodic` plus a unique `episode_id` in frontmatter.
Run `kiwifs memory report` to see which episodes have not been
consolidated. Full reference: [docs/MEMORY.md](https://github.com/kiwifs/kiwifs/blob/main/docs/MEMORY.md).

## Frontmatter Fields

Every `.md` file should have YAML frontmatter. Required fields marked *.

### Pages (`pages/*.md`)

| Field           | Type       | Required | Values / Notes                              |
|-----------------|------------|----------|---------------------------------------------|
| title           | string     | *        | Human-readable page title                   |
| description     | string     |          | One-line summary for search results         |
| tags            | string[]   | *        | Topic tags, lowercase, hyphenated           |
| status          | string     |          | `active` · `draft` · `review` · `deprecated` |
| context-layer   | string     |          | `operational` · `reference` · `archival` — retrieval priority hint |
| last-reviewed   | date       |          | ISO 8601 date of last quality review        |
| freshness-days  | integer    |          | How many days before this page is considered stale (default: 90) |
| source-uri      | string     |          | Deep link to the original source material   |
| derived-from    | object[]   |          | Provenance chain. Each entry: `source` (URI or path), `type` (`ingest` · `consolidation` · `synthesis`), `date` (ISO 8601), `actor` (who/what produced it) |
| merged-from     | object[]   |          | Episode paths this page was consolidated from. Each entry: `path`, `episode_id`, `date` |
| confidence      | float      |          | 0.0–1.0, certainty level of this knowledge  |
| memory_status   | string     |          | `active` · `contested` · `superseded` · `stale` (default: `active`) |
| expires_at      | datetime   |          | RFC3339 expiration timestamp for temporary memories |
| ttl             | string     |          | Relative lifetime from `created` (e.g. `7d`, `24h`) |

### Episodes (`episodes/*.md`)

| Field           | Type       | Required | Values / Notes                              |
|-----------------|------------|----------|---------------------------------------------|
| memory_kind     | string     | *        | Always `episodic`                           |
| memory_status   | string     |          | `active` · `contested` · `superseded` · `stale` (default: `active`) |
| episode_id      | string     | *        | Unique session/episode identifier           |
| session_id      | string     |          | Groups episodes from the same session       |
| confidence      | float      |          | 0.0–1.0, how certain is this observation    |
| importance      | integer    |          | 1–5, how critical this observation is (5 = must consolidate) |
| tags            | string[]   |          | Topic tags                                  |
| related-pages   | string[]   |          | Paths to existing pages this episode relates to |
| consolidated    | boolean    |          | `true` when merged into a page              |
| merged-into     | string[]   |          | Paths of pages this was merged into         |
| expires_at      | datetime   |          | RFC3339 expiration timestamp for temporary memories |
| ttl             | string     |          | Relative lifetime from `created` (e.g. `7d`, `24h`) |

## Memory Governance

### Freshness and Decay

- Pages have a `freshness-days` field (default 90). After this period without
  a `last-reviewed` update, the page is flagged as stale by `kiwi_analytics`.
- Episodes older than 30 days that are not consolidated should be reviewed.
  Episodes older than 90 days with `importance` ≤ 2 are candidates for archival.
- Retrieval should weight recency: `score = similarity × exp(-age_days / freshness_days)`.

### Contradiction Resolution

When new information contradicts an existing page:

1. **Check confidence.** If new source has higher confidence, update the page.
2. **Check recency.** More recent information wins when confidence is equal.
3. **If ambiguous:** Create the new page/episode with a `contradicts: [[page]]`
   note and flag for human review. Do not silently overwrite.
4. **Record the resolution** in `log.md` with rationale.

### Consolidation Triggers

Consolidation should run when any of these conditions are met:

- `kiwi_memory_report` shows ≥ 5 unconsolidated episodes on the same topic
- An episode has `importance: 5` (consolidate immediately)
- A scheduled maintenance pass runs (recommended: weekly)
- A human or orchestrator explicitly requests it

### Eviction and Archival

- Episodes with `consolidated: true` and age > 90 days may be moved to
  `episodes/archive/` to reduce retrieval noise.
- Never delete raw episodes — move to archive for audit trail.
- Pages with `status: deprecated` and no inbound links for 180+ days
  may be archived with a note in `log.md`.

## Operations

See `.kiwi/playbook.md` for step-by-step MCP tool sequences.

### Ingest
Read a raw source → create/update pages in `pages/` →
update `index.md` and `log.md`. Always deduplicate first.
Record provenance via `derived-from` with `type: ingest`.

### Query
Search the wiki to answer questions. Use `kiwi_search` +
`kiwi_read` + `kiwi_backlinks`. Prefer pages with
`context-layer: operational` for current-state questions.

### Lint
Audit for orphans, broken links, stale content, missing
frontmatter, and coverage gaps. Use `kiwi_analytics`.
Flag pages past their `freshness-days` threshold.

### Remember
Write a new episodic note under `episodes/` during a session.
Include `memory_kind: episodic` and a unique `episode_id`.
Set `importance` (1–5) and link to `related-pages` if known.
Append a summary to `log.md`.

### Consolidate
Merge related `episodes/` notes into durable `pages/` entries.
Set `merged-from` on the page, `consolidated: true` on the episode.
Run `kiwi_memory_report` to find unconsolidated episodes.
Resolve contradictions before merging (see Memory Governance).

### Recall
Search memory for past observations. Use `kiwi_search` for keyword
recall or `kiwi_search_semantic` for conceptual recall. Prefer
durable pages over raw episodes when both exist. Use `context-layer`
to prioritize results based on current task type.

## Conventions

- Link between pages with `[[wiki links]]`
- Keep pages focused — one concept per page
- Split pages over 300 lines
- Use YAML frontmatter for all structured metadata
- Append to `log.md` after every write operation
- Every page reachable from `index.md` within 2 hops
- Always record provenance — cite sources with URIs or `[[wikilinks]]`
- Set `importance` on episodes so consolidation can prioritize
- Never silently overwrite — read before write, resolve contradictions explicitly
