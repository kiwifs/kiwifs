# Episodic and central memory

KiwiFS is file-first: agents write plain markdown, git versions everything, and optional headers record **lineage** (`derived-from` from `X-Actor` / `X-Provenance`). For agent *memory systems*, you usually want two layers on top of that:

1. **Episodic memory** — per-run, per-session, or time-bounded raw notes (high volume, append-friendly).
2. **Central (semantic) memory** — “what the product should believe” on entity and concept pages, possibly after human or LLM **consolidation** from episodes.

This document describes the conventions, configuration, and tooling KiwiFS provides for that split. It does **not** run an LLM for you: consolidation is your job (or your scheduler); KiwiFS gives you a **data model** and a **report** to see which episodes are not yet linked from consolidated pages.

---

## Two different provenance lists

| Frontmatter | Meaning |
|-------------|---------|
| `derived-from` | Injected on **write** from HTTP headers. Records which run / job **produced** this file. Same structure as before: `type` + `id` (+ `date`, `actor`, …). |
| `merged-from` | You (or a consolidation job) set this on a **downstream** page. It says: “this semantic or summary page was built **from** these episodes (or other units).” |

You can have both: an episode has `derived-from: run:…` from the API, and a `pages/foo.md` page has `merged-from` listing the episode ids that were folded into the page.

---

## `memory_kind` in frontmatter

Use `memory_kind` to classify a page. Recognised values include:

- `episodic` — raw run/session log material.
- `semantic` — durable, curated knowledge.
- `consolidation` — optional staging area (pending merge to semantic).
- `working` — optional scratch, high churn.

`memory_kind: semantic` or `memory_kind: consolidation` prevents a file from being classified as episodic even if it lives under the episodes path prefix (see below).

---

## `memory_status` in frontmatter

Use `memory_status` to track the lifecycle of a memory page:

| Value | Meaning |
|-------|---------|
| `active` | Current memory, retrieved normally (**default** when absent) |
| `contested` | A contradiction was flagged; still retrievable, surfaced in memory reports |
| `superseded` | Replaced by a newer memory; **excluded from default search** |
| `stale` | Aged out or expired; deprioritized in ranking (future) |

Pages with `memory_status: superseded` are indexed but omitted from default FTS search results. Pass `include_superseded=true` on `GET /api/kiwi/search` to include them.

---

## Memory expiration: `expires_at` and `ttl`

Agents can mark memories as temporary without deleting them:

- **`expires_at`** — RFC3339 timestamp. When in the past, `kiwifs janitor` reports an `expired-memory` issue (info severity).
- **`ttl`** — Relative lifetime from the page `created` date (or file mtime when `created` is absent). Supported formats: `7d`, `24h`.

Expired pages are flagged for review, not auto-deleted.

---

## Temporal validity: `valid_from` and `valid_until`

Use RFC3339 timestamps to bound when a memory should be considered true:

- **`valid_from`** — memory is not valid before this instant.
- **`valid_until`** — memory is not valid after this instant.

These fields complement `expires_at` / `ttl`: expiration marks content for review, while validity windows express *when a fact was true* (e.g. a policy that only applied during a date range). The `kiwi_forget` MCP tool sets `valid_until` when superseding a page.

---

## Memory isolation: `scope`

Use **`scope`** to partition memories by user, project, or tenant (e.g. `user:alice`, `project:kiwifs`). Agents writing episodic notes should set `scope` when the observation applies to a single isolation boundary. Pass `scope` to `kiwi_search` / `kiwi_search_semantic` / `kiwi_recall` to filter results to that boundary.

---

## Contradictions: `contradicts`

When new information conflicts with an existing page, set **`contradicts`** in frontmatter to the path of the conflicting page (string or YAML list) and prefer `memory_status: contested` over silently overwriting. KiwiFS does **not** auto-detect contradictions — it indexes the relationship and surfaces it in backlinks and memory reports.

```yaml
---
memory_kind: semantic
contradicts: pages/auth-policy.md
---
```

You may also use a YAML array or wiki-link syntax:

```yaml
contradicts:
  - pages/auth-policy.md
  - [[pages/legacy-auth.md]]
```

Each value is indexed like a backlink with relation type `contradicts`. The target page's backlinks API response includes the source with `"relation": "contradicts"`. Pages with `contradicts` entries or `memory_status: contested` increment the `contradictions` count in `kiwifs memory report` and `GET /api/kiwi/memory/report`.

Resolve contradictions by updating confidence, recency, or merging into a superseding page — then record the outcome in `log.md`.

---

## Path convention: `episodes/`

By default, any markdown under the prefix **`episodes/`** (configurable) is treated as **episodic** when `memory_kind` is not set to `semantic` or `consolidation`. That lets you drop files into a folder without always setting `memory_kind`.

To change the prefix, set in `.kiwi/config.toml`:

```toml
[memory]
# Relative to the knowledge root. Default when unset: episodes/
episodes_path_prefix = "episodes/"
```

---

## Episodic identity: `episode_id` and `merged-from`

- Prefer **`episode_id`** in the frontmatter of episodic files. It is the primary key the tooling uses to see if a consolidated page cites that episode.
- If `episode_id` is missing, **`id`** is used as a fallback when the file is still classified as episodic.
- A **`merged-from`** entry can reference an episode by:
  - `type: episode` together with `id` set to the episodic file’s `episode_id`, or
  - `type: episode` together with `path` set to the episode’s path (e.g. `episodes/2026/run.md` relative to the knowledge root) when you have not yet assigned ids.

`merged-from` is a **sequence** in YAML, each item shaped like:

```yaml
merged-from:
  - type: episode
    id: run-7f3a
    date: "2026-04-27T12:00:00Z"
    note: "merged into concept auth from nightly job"
  - type: run
    id: run-249
```

**Compatibility:** an episodic file is considered “covered” by a `merged-from` on any other page if that page cites `type: episode` with a matching `id`, **or** cites `type: run`, `session`, `trace`, `event`, or `ingest` with the **same** id (so consolidators that key off run ids still match). Path-only `merged-from` items match `episode:path:` plus the normalised file path.

---

## `kiwifs memory report`

List episodic files and which ones are **not** referenced by any `merged-from` anywhere in the tree:

```bash
kiwifs memory report --root /path/to/knowledge
```

Options:

- `--json` / `-j` — machine-readable output (useful for CI and dashboards).
- `--episodes-prefix` — override `[memory] episodes_path_prefix` for a single run.

**Health metrics** (JSON fields and CLI/MCP text lines):

| Field | Meaning |
|-------|---------|
| `coverage_pct` | Percent of episodic files referenced by at least one `merged-from` entry |
| `avg_age_days` | Mean age in days of pages with `memory_status: active` or unset status (uses file mod time) |
| `expired_count` | Pages whose `expires_at` is in the past |
| `contested_count` | Pages with `memory_status: contested` |
| `scope_counts` | Map of `scope` frontmatter value → page count (only pages with an explicit `scope` key) |

**What the report does *not* do:** it does not read `derived-from` to decide “merged”. Only **`merged-from`** (and the path / id rules above) counts toward coverage. The intent is to answer: “What episodic content still needs to be pulled into a central or semantic page?”

---

## REST API (`GET /api/kiwi/memory/report`)

When KiwiFS is running (`kiwifs serve`), remote clients and consolidation workers can fetch the same JSON as `kiwifs memory report --json`:

```bash
curl -s "http://localhost:3333/api/kiwi/memory/report"
curl -s "http://localhost:3333/api/kiwi/memory/report?episodes_prefix=raw/"
curl -s "http://localhost:3333/api/kiwi/memory/report?limit=10&offset=0"
```

Optional query parameter **`episodes_prefix`** overrides `[memory] episodes_path_prefix` from `.kiwi/config.toml`. Optional **`limit`** and **`offset`** paginate both `episodic_files` and `unmerged`; the response still includes unpaginated totals in `total_episodic` and `total_unmerged`. Response shape matches **`memory.Report`** (counts, health metrics, `episodic_files`, `unmerged`, `warnings`).

---

## MCP (`kiwi_memory_report`)

The MCP server exposes **`kiwi_memory_report`** with optional **`episodes_prefix`**, **`limit`**, and **`offset`**, returning a short human-readable summary (same inputs as the REST endpoint).

---

## Programmatic: `internal/memory` (Go)

- **`memory.InjectMergedFrom([]byte, []memory.MergedFromEntry)`** — idempotently appends to `merged-from` while preserving the markdown body, similar to how provenance injects `derived-from`.
- **`memory.Scan` / `memory.Options{ EpisodesPathPrefix: ... }`** — the same walk used by the CLI; embed custom consolidation workers that read/write the store and then call the report for metrics.

```go
out, err := memory.InjectMergedFrom(inputBytes, []memory.MergedFromEntry{
	{Type: "episode", ID: "ep-1", Note: "nightly merge"},
})
```

---

## Suggested operator workflow

1. Agents (or the API) write under `episodes/` with `X-Provenance` and optional `episode_id` in frontmatter.
2. A scheduled job or on-demand script reads unmerged episodes (`kiwifs memory report` or `memory.Scan` + JSON), calls your LLM or rules engine, and writes/updates `pages/` with **`merged-from`** set via the API, MCP, or `InjectMergedFrom`.
3. `kiwifs memory report` goes green (no unmerged rows) for your id strategy, or you use the unmerged list as a queue.

That keeps **git** as the audit trail, **files** as the source of truth, and **merged-from** as the explicit “this central page subsumes these episodes” edge from episodic to semantic memory.
