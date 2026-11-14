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
- [Trash](#trash)
- [Restructuring](#restructuring)
- [Rendering](#rendering)
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
DELETE /api/kiwi/file?path=                → move to the trash + git commit (?permanent=true deletes outright)
PATCH  /api/kiwi/file/frontmatter?path=    → set/remove frontmatter fields ({"fields":{...}}, null removes; X-Field-Manager + ?force for ownership)
POST   /api/kiwi/bulk                      → multi-file write, one commit (per-file "if_match")
POST   /api/kiwi/rename                    → rename one file, relinking ({"from":"...","to":"..."})
POST   /api/kiwi/rename-dir                → move a folder, relinking ({"from":"...","to":"..."})
POST   /api/kiwi/file/append?path=         → append content to file
GET    /api/kiwi/toc?path=                 → heading outline
GET    /api/kiwi/backlinks?path=           → pages that link to this page
GET    /api/kiwi/context                   → schema + playbook + index in one call
GET    /api/kiwi/changes?since=&limit=     → git-based change feed
```

---

## Trash

```
GET    /api/kiwi/trash                     → trashed files, newest first ({"items":[{id, original_path, deleted_at, actor, size}]})
POST   /api/kiwi/trash/restore             → move one back to its original path ({"restore_id":"..."})
DELETE /api/kiwi/trash/:id                 → delete one from the trash for good
```

`DELETE /api/kiwi/file` moves the file to `.kiwi/trash/<id>/` and answers
`{"deleted":"notes/a.md","trashed":true,"restore_id":"20261113T101530Z_notes-a.md"}`.
The removal is committed as `trash: notes/a.md`, the page leaves the search
and link indexes, and subscribers get the usual `delete` event with
`"extra":{"trashed":true,"restore_id":"..."}`. Pass `?permanent=true` to
delete outright (the pre-trash behaviour, answering `{"deleted":"..."}`).
Directories are always removed outright, since only empty ones can be deleted.

Restoring moves the file back, commits it as `restore: notes/a.md`,
re-indexes it and sends a `write` event with `"extra":{"restored_from":"..."}`.
If a file has taken the original path since, restore answers `409` and
changes nothing; an unknown id answers `404`.

The trash itself is not committed — the file's history stays in git either
way. `kiwifs init` adds `.kiwi/trash/` to `.gitignore`; add that line to
workspaces created before the trash existed. Agents get the same operations through `kiwi_delete` (with
`permanent: true` to skip the trash), `kiwi_trash_list` and
`kiwi_trash_restore`.

```toml
[trash]
enabled        = true   # default; false makes every delete permanent
retention_days = 30     # default; the scheduled janitor purges older items, -1 keeps them
```

With the trash disabled, the `/trash` endpoints answer `404`.

---

## Restructuring

```
POST   /api/kiwi/refactor/plan             → preview a manifest of moves and merges (nothing written)
POST   /api/kiwi/refactor/apply            → apply it as one commit ({"manifest":{...},"digest":"..."})
POST   /api/kiwi/refactor/revert           → undo a commit as a plan ({"commit":"...","dry_run":true} to preview)
POST   /api/kiwi/refactor/approve          → a person approves a plan for an agent ({"manifest":{...},"digest":"..."})
GET    /api/kiwi/refactor/pending          → plans agents are waiting to have approved
GET    /api/kiwi/refactor/raw-moves        → moves made without relinking, and the relinks manifest that repairs them
POST   /api/kiwi/refactor/from-workspace-edit → an editor's LSP WorkspaceEdit renames as a manifest + plan
POST   /api/kiwi/refactor/script           → run a read-only Starlark script that returns a manifest; answers manifest + plan
POST   /api/kiwi/refactor/fix-broken       → repair links that already point nowhere
```

Every reorganization — a single rename, a folder move, a glob move, a merge —
runs through one engine (`internal/refactor`). The plan is computed from disk:
each wiki and markdown link to a moved page is respelled in its original style
and re-resolved to prove it still lands on the same page; comments and personal
state move with the page. Apply re-checks every file's ETag inside the write
lock and lands everything in a single commit, rolling back on failure.

`apply` with a `digest` applies only the plan that was reviewed: if the
workspace changed since, it answers `409` with the fresh plan. A plan with
errors (a taken destination, a link that cannot be kept) answers `422`.
`rename` and `rename-dir` answer `409` for the same reasons and never
overwrite an existing destination (protocol clients that need rename(2)
semantics pass `?overwrite=true`). Agents get the same engine through
`kiwi_refactor_plan` / `kiwi_refactor_apply` / `kiwi_refactor_revert`.

Beyond moves and merges, a manifest can carry `edits` — `select` pages by
`paths`, `glob` and/or a DQL `query` (all criteria narrow; at least one is
required), then `set`/`unset` frontmatter keys, `add_tags`/`remove_tags`, and
`replace` body text outside code — and `rename_tags` (frontmatter lists and
inline `#tags`; renaming into an existing tag is a warning). Selection sees the
workspace before any change. Frontmatter is edited line by line, so comments,
key order and alignment survive and a retag is a one-line diff per page.
`POST /refactor/plan?diffs=true` adds a unified diff per written page.

`[refactor]` in `.kiwi/config.toml` sets standing rules: `protect` (globs no
plan may touch), `scope` (the only folder plans may touch), `folder_map` (a page
listing where pages belong; moving elsewhere warns), and `approval_files` /
`approval_links` (default 50 / 200; `-1` disables). An agent (MCP, or REST with
`X-Kiwi-Client: mcp/…`) applying a bigger plan is asked to confirm through MCP
elicitation when its client supports it; otherwise the request waits in
`/refactor/pending` until a person approves it — in the web UI's **Restructure**
view (sidebar) or with `/refactor/approve`. Plans also report `integrity`: links
that point nowhere in the pages written, and pages a merge leaves unlinked.

`split: [{from: page.md, level: 2, into: folder/, confirm: true}]` breaks a
page into a page per heading: the original becomes an index linking to them,
references to `page#heading` follow their section, and the section's own links
are re-resolved from its new folder. A split is a preview until `confirm: true`.

Editors: `POST /refactor/plan?format=workspace-edit` answers with the plan as an
LSP `WorkspaceEdit` (renames, minimal text edits, a `needsConfirmation`
annotation); `kiwifs lsp` is a language server that answers
`workspace/willRenameFiles`, so renaming a page in VS Code, Zed or Neovim
relinks it through the same planner.

Frontmatter keys have owners, as in Kubernetes server-side apply: a patch sent
as a field manager (`X-Field-Manager`, or the actor of `kiwi_patch_frontmatter`
and of manifest edits) owns the keys it changes, and another manager changing
them gets `409` naming the owner unless it forces (`?force=true`,
`force: true`). A person's edit that changes the value makes the ownership
stale, so people always win. Ownership follows moved pages.

When selection needs real logic, `POST /refactor/script` (MCP
`kiwi_refactor_script`) runs a [Starlark](https://github.com/google/starlark-go)
program in a separate, sandboxed process. It can only read — `query(dql)`,
`files(glob)`, `read(path)`, `frontmatter(path)`, `links(path)`, `slug()`,
`json` — and returns a manifest from `main()`; steps, memory, time and reads
are bounded. Nothing is written: the manifest is planned, and applied like any
other.

Moves that bypass the engine — WebDAV/NFS renames, `update_links=false`, files
moved on disk while the watcher runs — are logged when anything referenced the
old path. `relinks: [{from, to}]` repairs them without moving anything;
`/refactor/raw-moves` builds that manifest for you.

Edits can also compute: `when:` keeps only pages for which an expression is
true, `compute: {key: expr}` sets a value per page, and
`move_to: "archive/{{year}}/{{slug}}.md"` moves each page to a templated path,
with `on_conflict: suffix("-%d")` to number collisions deterministically
(otherwise they are conflicts). Expressions are [expr](https://expr-lang.org)
over the page as it was before the manifest — `path`, `dir`, `name`, `stem`,
`title`, `tags`, `fm`, `links`, `date`, `modified`, `now` — with `slug()`,
`year()`, `month()`, `day()`, `date(t, layout)`. A plan that uses expressions
reports the `now` it used; put it in the manifest (`now:`) when applying so the
digest still matches.

Plans also cover typed-link frontmatter fields (`[links] typed_fields`),
`**` globs, `from_regex` moves with `$1` captures, and task claims: a page
claimed by another actor cannot be moved. Destinations that collide by case or
Unicode normalization, or are not portable names, are reported as
`conflicts` with a code (`exists`, `many_to_one`, `case_or_normalization`, …).

Applying writes a journal of pre-images first (`.kiwi/state/refactor-journal.json`,
rolled back on the next start if the process dies mid-apply), and the commit
carries trailers (`Kiwi-Actor`, `Kiwi-Client`, `Kiwi-Refactor-Digest`,
`Kiwi-Manifest`, `Kiwi-Base`). The apply response names the commit; `revert`
puts every page and comment/state file back byte for byte, and refuses if any
of them changed since.

---

## Rendering

```
GET    /api/kiwi/render/d2?source=&theme=  → D2 diagram as SVG (theme: light | dark)
POST   /api/kiwi/render/d2                 → same, body {"source": "...", "theme": "dark"}
```

A ```` ```d2 ```` fence renders through this endpoint. Rendering is in-process
(D2's layout engines are native Go): no subprocess, no network, `@import`
disabled, `dagre` or `elk` layout, 64 KB source limit, 10 s timeout. Results
are cached under `.kiwi/state/d2/` by content hash and served with an `ETag`.
A diagram error is a `422` carrying D2's message. Binaries built with
`-tags nod2` leave D2 out (about 16 MB) and answer `501`; the UI then shows
the fence as code.

---

## Search

```
GET    /api/kiwi/search?q=                 → full-text search (BM25)
POST   /api/kiwi/search/semantic           → vector search
GET    /api/kiwi/search/verified           → trust-ranked search (verified pages boosted)
POST   /api/kiwi/recall                    → keyword + vector + link-graph retrieval fused into one ranking
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

### Recall (fused retrieval)

`POST /api/kiwi/recall` answers "what do we know about this?" in one call. It runs keyword (BM25) and vector search in parallel, then expands the 10 best hits one hop along the link graph: every page that links to them is ranked, most-connected first. The three rankings are fused with [Reciprocal Rank Fusion](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf), `score = Σ 1/(k + rank)`, so a page that cites several relevant pages surfaces even when it shares no words with the query. The MCP server exposes the same retrieval as `kiwi_recall`.

```json
{
  "query": "how did we handle the auth migration?",
  "limit": 10,
  "sources": ["fts", "vector", "graph"],
  "scope": "user:alice",
  "path_prefix": "episodes/",
  "boost_verified": true,
  "rrf_k": 60
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `query` | required | What to recall |
| `limit` | `10` | Results to return (max 200) |
| `sources` | all | Any of `fts`, `vector`, `graph`. `graph` expands from keyword or vector hits, so it needs at least one of them |
| `scope` | | Only pages whose frontmatter `scope` matches exactly (SQLite search backend) |
| `path_prefix` | | Only pages under this path |
| `boost_verified` | `false` | Multiply each score by `1 + confidence` for pages whose frontmatter `confidence` is a number in (0, 1] (SQLite search backend) |
| `rrf_k` | `60` | RRF rank constant. Smaller values let one signal's top hit dominate |

```json
{
  "query": "how did we handle the auth migration?",
  "limit": 10,
  "rrf_k": 60,
  "engines": ["fts", "graph"],
  "results": [
    {
      "path": "episodes/auth-migration.md",
      "score": 0.0325,
      "sources": ["fts", "graph"],
      "fts_rank": 1,
      "vector_rank": 0,
      "graph_rank": 2,
      "links_to": ["decisions/token-rotation.md"],
      "snippet": "We decided to..."
    }
  ]
}
```

Ranks are 1-based; `0` means that signal did not rank the page. `links_to` lists the top hits a graph-ranked page links to, and `confidence` is included when `boost_verified` applied one. Signals that are not configured are skipped rather than failing the request: without a vector index, recall is keyword plus graph; the grep search backend keeps no link index, so it skips the graph too. `engines` lists only the signals that contributed. Requesting `sources: ["vector"]` with no vector index answers `503`; `scope` on the grep backend answers `501`.

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

**External link rot.** `GET /api/kiwi/janitor` can also report `external-link-rot` warnings
for `http(s)` URLs in page bodies that answer 4xx/5xx or cannot be reached. It is off by
default; enable it in `.kiwi/config.toml`:

```toml
[janitor]
external_link_check         = true
external_link_timeout       = "5s"                          # per request
external_link_ignore        = ["localhost", "example.com"]  # hosts and their subdomains
external_link_cache_ttl     = "24h"
external_link_allow_private = false                         # see below
```

Frontmatter, fenced code blocks and inline code are not scanned. Each URL is probed with
`HEAD` (falling back to a `Range: bytes=0-0` `GET`), redirects are followed up to 3 hops,
at most 10 requests run at once and starts are spaced 100ms apart. Results are cached in
`.kiwi/state/link-check.json`, so only the scheduled scan or a `?fresh=true` request after
the TTL expires touches the network. The same findings appear in `kiwifs janitor` and
`kiwifs check`.

Links that resolve to loopback, private (RFC 1918, `fc00::/7`), link-local (including
`169.254.169.254`) or carrier-grade NAT addresses are skipped, including after a redirect,
because page authors choose the URLs and the results are visible through the API. Set
`external_link_allow_private = true` for an intranet wiki whose links point at internal
hosts. A `429 Too Many Requests` is not reported or cached; the link is re-checked next scan.

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
