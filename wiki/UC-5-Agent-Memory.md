# UC-5: Agent Memory

**Label:** [`uc:agent-memory`](https://github.com/kiwifs/kiwifs/labels/uc%3Aagent-memory)

## Thesis

AI agents need persistent memory across sessions. Every existing solution runs LLMs inside the storage layer to extract facts, resolve contradictions, and build entity graphs. KiwiFS takes a different approach: be the **library**, not the engine. Provide the data model, the query primitives, and the lifecycle infrastructure — then let the agent write markdown and the operator run consolidation. The agent is the pen. The LLM is the brain. KiwiFS is the paper.

## Design Philosophy

KiwiFS is a **memory library**, not a memory engine. The distinction matters:

| Layer | Memory engines | KiwiFS approach |
|-------|---------------|-----------------|
| Fact extraction | Built-in LLM pipeline | Agent writes markdown. That's the interface. |
| Contradiction handling | Auto-resolves on write | Surfaces contradictions via frontmatter + janitor. Agent or human resolves. |
| Consolidation | Automatic background process | Provides conventions (`merged-from`), helpers (`InjectMergedFrom`), and reports. You bring the scheduler. |
| Admission gating | Built-in rules engine | Schema validation (already exists). You define the schema. |
| Retrieval | Opinionated fusion pipeline | Exposes the primitives (FTS5, vector, graph, DQL). You compose them. |
| Decay / forgetting | Built-in decay algorithm | Frontmatter convention (`expires_at`) + janitor rule. You set the policy. |

**One-sentence positioning:** KiwiFS is the filesystem for agent memory — it stores, indexes, and versions your memories as markdown. It doesn't decide what to remember. Your agent does.

## What Already Exists

KiwiFS already has the data-model primitives for agent memory. What's missing is the query, lifecycle, and convenience layers on top.

| Primitive | Status | Location |
|-----------|--------|----------|
| `memory_kind` classification (`episodic`, `semantic`, `consolidation`, `working`) | ✅ | `internal/memory/kind.go` |
| `episodes/` path convention (configurable prefix) | ✅ | `internal/memory/scan.go`, `.kiwi/config.toml` `[memory]` |
| `episode_id` identity for episodic files | ✅ | Frontmatter convention, `internal/memory/scan.go` |
| `merged-from` provenance (episodic → semantic lineage) | ✅ | `internal/memory/merge.go`, `docs/MEMORY.md` |
| `InjectMergedFrom()` Go helper for consolidation scripts | ✅ | `internal/memory/merge.go` |
| `kiwifs memory report` CLI (coverage, unmerged episodes) | ✅ | `cmd/memory.go` |
| `GET /api/kiwi/memory/report` REST endpoint | ✅ | `internal/api/handlers_memory.go` |
| `kiwi_memory_report` MCP tool | ✅ | `internal/mcpserver/mcpserver.go` |
| `X-Actor` / `X-Provenance` → `derived-from` on writes | ✅ | `internal/pipeline/` |
| Git commit per write (audit trail, blame, restore) | ✅ | `internal/versioning/` |
| Full-text search (FTS5/BM25) | ✅ | `internal/search/` |
| Semantic/vector search (7 embedding backends) | ✅ | `internal/vectorstore/` |
| Wiki links + backlinks (graph structure) | ✅ | `internal/links/` |
| DQL queries over frontmatter | ✅ | `internal/dataview/` |
| Content health janitor (stale, orphan, broken links, contradictions) | ✅ | `internal/janitor/` |
| Knowledge workspace template with `episodes/` and `pages/` | ✅ | `internal/workspace/templates/knowledge/` |

## What's Missing

### Data model conventions

These are **indexed frontmatter fields** the agent writes and KiwiFS queries. No LLM, no decisions — just schema.

| Gap | What it enables |
|-----|----------------|
| `memory_status` field (`active` / `contested` / `superseded` / `stale`) | Search excludes `superseded` by default. Janitor reports `contested` pages. Agent sets it, KiwiFS respects it. |
| `valid_from` / `valid_until` temporal window | DQL can filter "what was true on date X?" Agent writes these; KiwiFS indexes them. |
| `confidence` score (0–1) | Search uses as ranking signal. Agent writes it based on its own judgment. |
| `expires_at` / `ttl` expiration | Janitor flags expired pages. Search deprioritizes them. |
| `scope` field (`user:alice`, `agent:cursor`, `project:kiwifs`) | Scoped retrieval prevents cross-user memory leakage. |
| `contradicts` field (path to conflicting page) | Indexed like backlinks. Memory report surfaces contradictions. |

### Query primitives

The index, not the engine. KiwiFS already has all the signals — they just need to be composable.

| Gap | What it enables |
|-----|----------------|
| Temporal DQL functions (`NOW()`, `DAYS_AGO(n)`, `DATE()`, `BETWEEN`) | Queries like `WHERE valid_until > NOW()` and `WHERE created > DAYS_AGO(7)`. Shared with UC-3. |
| Retrieval fusion endpoint (`/api/kiwi/recall`, `kiwi_recall` MCP tool) | Single call combining FTS5 + vector + backlink-graph with reciprocal rank fusion. Caller controls weights and filters. |
| Scope-filtered search | Filter search results by `scope` frontmatter field. |
| Recency-weighted ranking | Search parameter (`recency_weight`) that boosts recent documents. A knob, not an algorithm. |

### Lifecycle infrastructure

Hooks, not engines. KiwiFS is the event bus, not the processor.

| Gap | What it enables |
|-----|----------------|
| Janitor rules for memory | Flag pages past `expires_at`, episodes unmerged for N days, `memory_status: stale` pages. Reports, not deletes. |
| Pipeline events for memory writes | SSE event `memory:episodic` on episodic writes, `memory:status_change` on status changes. Operators hook webhooks. |
| Contradiction surface in memory report | Memory report shows pages with `contradicts` links or `memory_status: contested`. |

### MCP convenience tools

Ergonomic wrappers that enforce conventions. The agent still decides what to remember and when to forget.

| Gap | What it does |
|-----|-------------|
| `kiwi_remember` | Write to `episodes/{date}/{id}.md` with correct frontmatter defaults (`memory_kind`, `episode_id`, `scope`, `derived-from`). |
| `kiwi_recall` | Fused retrieval with scope filter and recency weight. |
| `kiwi_forget` | Set `memory_status: superseded` and `valid_until: now` on a page. |

### Reporting

Observability, not automation. The dashboard an operator looks at to decide "should I run my consolidation script?"

| Gap | What it adds to `memory report` |
|-----|-------------------------------|
| Coverage metric | % of episodes with a `merged-from` reference |
| Freshness metric | Average age of `memory_status: active` pages |
| Contradiction count | Pages with `contradicts` links or `memory_status: contested` |
| Scope breakdown | Memory count per `scope` value |
| Expiration count | Pages past `expires_at` |

## What KiwiFS Should Explicitly NOT Build

- **No built-in LLM extraction pipeline.** The agent writes markdown. If you want auto-extraction, build it as an external service that calls `kiwi_remember`.
- **No auto-consolidation daemon.** Provide the data (`memory report`), the conventions (`merged-from`), and the Go helper (`InjectMergedFrom`). The operator writes the cron job.
- **No entity linking or knowledge graph construction.** Wiki links `[[page]]` are the knowledge graph. The agent writes them. KiwiFS indexes them.
- **No smart admission gating.** Schema validation is the gate. You define the schema. If it passes, it's stored.
- **No built-in decay algorithm.** Provide `expires_at` and janitor rules. The operator sets the policy. Search has a `recency_weight` knob.

## Proposed Milestones

1. **Memory frontmatter schema** — Document and index `memory_status`, `valid_from`/`valid_until`, `confidence`, `expires_at`, `scope`, and `contradicts` as recognized frontmatter fields. Update the `knowledge` template and `SCHEMA.md`. Ship a `.kiwi/schemas/memory.json` for validation.
2. **Temporal DQL** — Add `NOW()`, `DAYS_AGO(n)`, `DATE()`, `BETWEEN` to the DQL parser. (Shared with UC-3.)
3. **Memory janitor rules** — Extend the janitor to flag expired pages, long-unmerged episodes, and contested pages.
4. **`kiwi_remember` / `kiwi_forget` MCP tools** — Convenience wrappers that enforce the memory schema conventions.
5. **Retrieval fusion** — `/api/kiwi/recall` endpoint combining FTS5 + vector + graph with RRF, scope filtering, and recency weighting. `kiwi_recall` MCP tool.
6. **Extended memory report** — Coverage, freshness, contradictions, scope breakdown, expiration counts.

## Good First Issues

See the [Good First Issues](Good-First-Issues) page for issues tagged `uc:agent-memory`.
