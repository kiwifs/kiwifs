<p align="center">
  <a href="../README.md">README</a> · <a href="FAQ.md">FAQ</a> · <a href="ARCHITECTURE.md">Architecture</a> · <a href="EXAMPLES.md">Examples</a> · <a href="POSIX.md">POSIX</a>
</p>

# REST API Reference

Base URL: `http://localhost:3333`

For the full interactive API reference, see [docs.kiwifs.com/api-reference](https://docs.kiwifs.com/api-reference).

---

## Table of Contents

- [Health](#health)
- [Files](#files)
- [Search](#search)
- [Versioning](#versioning)
- [Metadata and Queries](#metadata-and-queries)
- [Analytics and Health](#analytics-and-health)
- [Real-time Events](#real-time-events)
- [Sharing](#sharing)
- [Import and Export](#import-and-export)
- [Headers](#headers)

---

## Health

```
GET  /health                               → {"status":"ok"}
```

---

## Files

```
GET    /api/kiwi/tree?path=                → directory tree (JSON)
GET    /api/kiwi/file?path=                → raw markdown + ETag
PUT    /api/kiwi/file?path=                → write + git commit + re-index
DELETE /api/kiwi/file?path=                → delete + git commit
POST   /api/kiwi/bulk                      → multi-file write, one commit
POST   /api/kiwi/rename                    → atomic rename ({"from":"...","to":"..."})
POST   /api/kiwi/file/append?path=         → append content to file
GET    /api/kiwi/toc?path=                 → heading outline
GET    /api/kiwi/backlinks?path=           → pages that link to this page
GET    /api/kiwi/context                   → schema + playbook + index in one call
GET    /api/kiwi/changes?since=&limit=     → git-based change feed
```

---

## Search

```
GET    /api/kiwi/search?q=                 → full-text search (BM25)
POST   /api/kiwi/search/semantic           → vector search
GET    /api/kiwi/search/verified           → trust-ranked search (verified pages boosted)
POST   /api/kiwi/resolve-links             → resolve [[wiki-links]] to permalinks
```

### Search Syntax

| Pattern | What it does |
|---------|-------------|
| `payment timeout` | Match both terms (implicit AND) |
| `"connection reset"` | Exact phrase match |
| `"connection reset" AND ws` | Boolean operators (AND, OR, NOT) |
| `auth*` | Prefix matching |

### Spelling suggestions ("did you mean")

When full-text search returns **no results** and `offset` is `0`, `GET /api/kiwi/search` and `GET /api/kiwi/search/verified` may include a `suggestions` array. Each entry is a page title close to the query (Levenshtein edit distance), taken from indexed titles in the SQLite search backend (`--search sqlite`).

| Query param | Default | Max | Description |
|-------------|---------|-----|-------------|
| `suggest_threshold` | `3` | `10` | Maximum edit distance between query and suggested title |

Suggestions are omitted when FTS finds hits, when `offset > 0`, or when using the `grep` search backend. At most **3** unique titles are returned (deduplicated by title; closest match wins).

**Example** — misspelled query with no FTS hits:

```
GET /api/kiwi/search?q=Authentcation
```

```json
{
  "query": "Authentcation",
  "limit": 50,
  "offset": 0,
  "results": [],
  "suggestions": [
    {
      "query": "Authentication",
      "path": "concepts/authentication.md",
      "title": "Authentication",
      "distance": 1
    }
  ]
}
```

| Field | Description |
|-------|-------------|
| `query` | Suggested search term (the matched page title) |
| `path` | Page path in the knowledge root |
| `title` | Display title |
| `distance` | Edit distance from the original query (1–`suggest_threshold`) |

---

## Versioning

```
GET    /api/kiwi/versions?path=            → git log for file
GET    /api/kiwi/version?path=&version=    → content at commit
GET    /api/kiwi/diff?path=&from=&to=      → unified diff
GET    /api/kiwi/blame?path=               → per-line attribution
```

---

## Metadata and Queries

```
GET    /api/kiwi/meta?where=$.field=val    → structured query over frontmatter
GET    /api/kiwi/query?q=                  → DQL query (TABLE, LIST, COUNT, DISTINCT)
GET    /api/kiwi/query/aggregate           → aggregation (count, avg, sum, min, max)
POST   /api/kiwi/view/refresh              → refresh computed views
```

### Meta Query Syntax

Filters AND together. Each `where` uses a JSON path plus an operator:

```
GET /api/kiwi/meta?where=$.status=published&where=$.priority=high&sort=$.updated&order=desc
```

Supported operators: `=`, `!=`, `<`, `<=`, `>`, `>=`, `LIKE`.

Array membership:

```
GET /api/kiwi/meta?where=$.derived-from[*].id=run-249
```

---

## Analytics and Health

```
GET    /api/kiwi/analytics                 → content health + engagement dashboard
GET    /api/kiwi/analytics/views           → top page views (?path=, ?top=, ?since=)
GET    /api/kiwi/analytics/failed-searches → zero-result queries (?top=, ?since=)
GET    /api/kiwi/health-check?path=        → per-page health metrics
GET    /api/kiwi/stale                     → pages past their review date
GET    /api/kiwi/contradictions            → pages with conflicting claims
GET    /api/kiwi/janitor                   → content health scan
GET    /api/kiwi/memory/report             → episodic vs merged-from coverage (JSON)
```

---

## Real-time Events

```
GET    /api/kiwi/events                    → SSE stream
```

```
event: write
data: {"path":"pages/finding-042.md","actor":"agent:exec_abc"}

event: delete
data: {"path":"pages/temp.md","actor":"agent:exec_abc"}

event: bulk
data: {"files":["pages/a.md","pages/b.md"],"actor":"agent:exec_abc"}
```

---

## Sharing

```
POST   /api/kiwi/share                     → create a share link (password-protected)
GET    /api/kiwi/share                     → list active share links
DELETE /api/kiwi/share/:id                 → revoke a share link
```

---

## Import and Export

```
POST   /api/kiwi/import                    → bulk import from data source
GET    /api/kiwi/export                    → export to JSONL/CSV stream
POST   /api/kiwi/assets                    → upload binary asset (images, PDFs)
```

---

## Headers

### Request Headers

| Header | Purpose |
|--------|---------|
| `X-Actor` | Git attribution (e.g., `agent:my-bot`, `user:jane`) |
| `X-Provenance` | Lineage tracking (e.g., `run:run-249`) |
| `If-Match` | Optimistic locking. Pass the ETag from a previous read. Returns 409 on conflict. |

### Response Headers

| Header | Purpose |
|--------|---------|
| `ETag` | Content hash (git blob hash). Use with `If-Match` for safe updates. |
| `X-Permalink` | Stable, shareable URL for the file (when `public_url` is configured) |

---

## Multi-space

For multi-space deployments, prefix all paths with the space name:

```
GET /api/kiwi/{space}/tree
GET /api/kiwi/{space}/file?path=...
PUT /api/kiwi/{space}/file?path=...
```

Each space has its own root directory, git repo, and search index.
