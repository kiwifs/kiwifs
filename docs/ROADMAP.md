<p align="center">
  <a href="../README.md">README</a> · <a href="FAQ.md">FAQ</a> · <a href="ARCHITECTURE.md">Architecture</a> · <a href="API.md">API</a> · <a href="EXAMPLES.md">Examples</a>
</p>

# Roadmap

Where KiwiFS is headed. Updated as priorities shift.

This is a living document — not a promise. If you want to work on something here, open an issue first so we can coordinate.

---

## v0.1 — "It works"

The foundation. A markdown filesystem for agents and teams — single Go binary with web UI, git versioning, full-text + vector search, and multi-protocol access.

- [x] REST API (file CRUD, tree, search, versions, diff, blame, SSE)
- [x] Web UI (Markdown editor, wiki links, backlinks, graph view, Cmd+K search, ToC, comments)
- [x] Git versioning (atomic commits, audit trail, conflict detection via ETags)
- [x] SQLite FTS5 search (BM25 ranked) + pluggable vector search
- [x] NFS, S3, WebDAV, FUSE access protocols
- [x] Structured metadata index (`file_meta` JSON column, queryable frontmatter)
- [x] Provenance tracking (`X-Provenance` header → frontmatter injection)
- [x] Binary asset uploads (images, PDFs alongside markdown)
- [x] Multi-space support (one server, multiple knowledge bases)
- [x] Go library (`pkg/kiwi`) — embed KiwiFS in any Go app

---

## v0.2 — Embeddable

Make KiwiFS easy to plug into other apps. This is what turns it from a tool into a platform.

- [x] **Permalinks** — `public_url` config, HTML5 history routing (`/page/{path}`), permalink field in API responses, wiki link → real URL resolution for external contexts (PR comments, Slack, exports)
- [ ] **React component library** (`kiwifs-ui` on npm) — `<KiwiProvider>`, `<KiwiTree>`, `<KiwiPage>`, `<KiwiEditor>`, `<KiwiSearch>`, `<KiwiGraph>` as standalone components
- [x] **MCP server** (`kiwifs mcp`) — Model Context Protocol for AI agents (Claude, Cursor, etc.)
- [x] **Dataview** — computed views over frontmatter (Obsidian Dataview as a server). Hand-written Pratt parser for DQL, `json_extract`-based SQLite queries, TABLE/LIST/COUNT output, aggregation, GROUP BY. REST `GET /api/kiwi/query`, MCP `kiwi_query`, CLI `kiwifs query`. Computed view files with `kiwi-view: true` frontmatter.
- [x] **Episodic vs semantic memory** — `merged-from` frontmatter, `memory_kind`, `[memory]` config, `kiwifs memory report`, REST `GET /api/kiwi/memory/report`, MCP `kiwi_memory_report`, `internal/memory` helpers (`docs/MEMORY.md`), default `knowledge` init template includes `episodes/`
- [ ] **Pipeline hooks** (Go) — `OnBeforeWrite`, `OnAfterWrite` callbacks for custom validation/notifications
- [ ] **JS hooks** — `.kiwi/hooks/*.js` scripts via embedded runtime, no recompile needed

## v0.2.1 — Data durability & backup

Your data must survive anything — process crash, container kill, host failure. KiwiFS is Obsidian-model (files are the truth, everything else rebuilds), and now ships with built-in backup.

- [x] **Atomic file writes** — temp-file-then-rename in storage layer, eliminates torn writes on crash
- [ ] **Track `.kiwi/` user data in git** — comments, config, templates are user-created data that must not be silently lost
- [x] **`[backup]` config** — `remote = "git@github.com:user/kb.git"`, `interval = "5m"`, background goroutine pushes to any git remote
- [x] **`kiwifs backup`** — one-shot CLI command for manual push, cron jobs, pre-maintenance scripts
- [x] **`kiwifs restore`** — `git clone` + auto-reindex, one command to recover from any git remote
- [ ] **Uncommitted path tracking** — if git commit fails after file write, track and retry so history is never silently lost

---

## v0.3 — Import & export

You can't replace Confluence if you can't migrate from it.

- [x] `kiwifs import --from obsidian` — copy vault, rewrite `![[image]]` paths
- [x] `kiwifs import --from notion` — parse exported markdown + CSV, fix internal links
- [x] `kiwifs import --from confluence` — convert XHTML storage format to markdown
- [x] `kiwifs import` — 18 total sources (PostgreSQL, MySQL, SQLite, MongoDB, DynamoDB, Redis, Elasticsearch, CSV, JSON, JSONL, YAML, Excel, Notion, Airtable, Google Sheets, Confluence, Obsidian, Firestore)
- [x] `kiwifs export --format jsonl` / `--format csv` — export with optional embeddings, content, and link graph
- [x] `kiwifs export --format mkdocs` — generate MkDocs static doc site projects
- [ ] `kiwifs export --format docusaurus` — generate Docusaurus static doc sites

## v0.4 — Webhooks & analytics

Outbound integration and content health signals.

- [x] **Webhooks** — POST to Slack/CI/custom URLs on write/delete events, HMAC signing, retry with backoff
- [x] **Content analytics** — stale page detection, orphan pages, broken links, empty pages, link coverage, health checks (`kiwifs analytics`, `kiwifs janitor`, `GET /api/kiwi/analytics`)
- [x] **Page view tracking** — SQLite `page_views` + `failed_searches` tables, REST `/analytics/views` and `/analytics/failed-searches`, engagement section in `/analytics` + `kiwifs analytics`, web UI engagement panel + per-page view counts
- [x] **Analytics v2** — overview, trends, content gaps, search analytics, sources, failed search dismissal

## v0.5 — Workflows, schemas & templates (current)

Structured knowledge management across diverse use cases.

- [x] **Workflows** — state machines in `.kiwi/workflows/*.json`, frontmatter-driven transitions, Kanban board view, assign/advance/reorder API
- [x] **JSON Schema validation** — `.kiwi/schemas/*.json`, enforcement toggle, per-template schemas
- [x] **Init templates** — 12 templates: `kb`, `wiki`, `memory`, `tasks`, `data`, `cms`, `runbook`, `adr`, `prompt`, `research`, `log`, `blank`
- [x] **Widget system** — `kiwi-chart`, `kiwi-query`, `kiwi-kanban`, `kiwi-playground`, `kiwi-app`, `kiwi-diff`, `kiwi-progress`, `kiwi-color`, `kiwi-steps`, `kiwi-calc`, `widget:live`, `widget:code`, container directives (tabs, columns), callouts
- [x] **kiwi-app kit** — sandboxed apps share a theme-aware `k-` stylesheet and a `kiwi` runtime that hands their stepping to the page's playback engine (keys, scrubber, shared clocks, deep links); `src=` loads the HTML from its own file. Reference: [APPS.md](APPS.md)
- [x] **Widget fences** — pictures as data: `array`, `matrix`, `table`, `tree`, `graph`, `plot`, `bars`, `numberline`, `plane`, `map`, `timeline`, `list`, `stack`, `bits`, `sequence`. Schema-validated by `kiwi_lint`, documented by `kiwi_widget_reference`, shared playback clocks with linkable steps (`#?step.<id>=N`), click-a-cell explanations, accessible names, and prose fallbacks in PDF and search. Reference: [WIDGETS.md](WIDGETS.md)
- [x] **Task orchestration** — `kiwi_task_create`, `kiwi_task_progress`, claims, Kanban, task template
- [x] **Agent memory tools** — `kiwi_remember`, `kiwi_forget`, memory report, contradiction detection
- [x] **Publishing** — per-page publish, share links, space visibility, themed reader at `/p/*`
- [x] **Document export** — PDF (Typst/XeLaTeX), HTML, slides (Marp), MkDocs project, static site
- [x] **Draft spaces** — git-backed staging branches, merge/discard, file ops inside drafts
- [x] **Canvas** — `.canvas.json` (Obsidian-compatible), Flow UI, auto-layout, patch, query, generate
- [x] **Whiteboard** — `.excalidraw.md` files, Excalidraw editor
- [x] **ONNX embedder** — fully offline vector search, multilingual support
- [x] **MCP Streamable HTTP** — `/mcp` on main server port via `--mcp` flag
- [x] **OpenAPI** — `GET /api/openapi.json`, Swagger UI at `/api/docs`
- [x] **Graph analytics** — PageRank, betweenness centrality, Louvain communities, shortest path, link-type filtering
- [x] **Bases** — saved DQL views with table, cards, list, map layouts
- [x] **Audit log** — `[audit] enabled`, query API, actor/action/path entries
- [x] **Connect CLI** — `kiwifs connect` auto-configures MCP for Cursor, Claude Desktop, VS Code, Windsurf, Claude Code
- [x] **Rules export** — `kiwifs rules export` for Cursor, Claude, AGENTS.md formats
- [x] **Feeds** — Atom and JSON Feed for CMS template
- [x] **Parquet export** — columnar export for data warehouses
- [x] **In-browser PDF** — Typst WASM compiler for client-side PDF generation
- [x] **Shiki syntax highlighting** — with line highlights and titles

## v0.6 — Access control & governance

Enterprise features for teams that need enforced boundaries.

- [ ] **RBAC permissions** (Casbin) — per-space role-based access, JWT/API key/OIDC identity
- [ ] **Content lifecycle** — retention policies, legal holds, auto-archival
- [ ] **React component library** (`kiwifs-ui` on npm) — `<KiwiProvider>`, `<KiwiTree>`, `<KiwiPage>`, `<KiwiEditor>`, `<KiwiSearch>`, `<KiwiGraph>` as standalone components
- [ ] **Pipeline hooks** (Go) — `OnBeforeWrite`, `OnAfterWrite` callbacks for custom validation/notifications
- [ ] **JS hooks** — `.kiwi/hooks/*.js` scripts via embedded runtime, no recompile needed

---

## How to contribute to the roadmap

1. **Pick something** — find an item above that interests you
2. **Open an issue** — describe your approach, we'll discuss before you code
3. **Start small** — even one bullet point from a section is a meaningful PR
4. **Suggest new items** — open a [Discussion](https://github.com/kiwifs/kiwifs/discussions) if you think something is missing

Items labeled [`good first issue`](https://github.com/kiwifs/kiwifs/labels/good%20first%20issue) are specifically scoped for new contributors.

---

*Last updated: June 2026*
