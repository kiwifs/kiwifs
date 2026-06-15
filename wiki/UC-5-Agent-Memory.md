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

## Features

| Feature | Status | Location |
|---------|--------|----------|
| `memory_kind` classification (`episodic`, `semantic`, `consolidation`, `working`) | ✅ | `internal/memory/kind.go` |
| `episodes/` path convention (configurable prefix) | ✅ | `internal/memory/scan.go`, `.kiwi/config.toml` `[memory]` |
| `episode_id` identity for episodic files | ✅ | Frontmatter convention, `internal/memory/scan.go` |
| `merged-from` provenance (episodic → semantic lineage) | ✅ | `internal/memory/merge.go`, `docs/MEMORY.md` |
| `InjectMergedFrom()` Go helper for consolidation scripts | ✅ | `internal/memory/merge.go` |
| `memory_status` field indexed, search excludes `superseded` | ✅ | `internal/memory/`, `internal/search/` |
| `expires_at` / `ttl` janitor rule for memory expiration | ✅ | `internal/janitor/` |
| `scope` field with scope-filtered search | ✅ | `internal/search/` |
| `contradicts` frontmatter indexed as backlinks | ✅ | `internal/links/` |
| Recency-weighted search ranking | ✅ | `internal/search/` |
| `kiwi_remember` MCP tool (write to episodes with defaults) | ✅ | `internal/mcpserver/` |
| `kiwi_forget` MCP tool (set superseded + valid_until) | ✅ | `internal/mcpserver/` |
| `kiwifs memory report` CLI + REST + MCP (coverage, freshness, scope) | ✅ | `cmd/memory.go`, `internal/api/handlers_memory.go` |
| `X-Actor` / `X-Provenance` → `derived-from` on writes | ✅ | `internal/pipeline/` |
| Git commit per write (audit trail, blame, restore) | ✅ | `internal/versioning/` |
| Full-text search (FTS5/BM25) | ✅ | `internal/search/` |
| Semantic/vector search (7 embedding backends) | ✅ | `internal/vectorstore/` |
| `DAYS_AGO()` DQL function for temporal memory queries | ✅ | `internal/dataview/` |
| Wiki links + backlinks (graph structure) | ✅ | `internal/links/` |
| DQL queries over frontmatter | ✅ | `internal/dataview/` |
| Content health janitor (stale, orphan, broken links, contradictions) | ✅ | `internal/janitor/` |
| Knowledge workspace template with `episodes/` and `pages/` | ✅ | `internal/workspace/templates/knowledge/` |

## What's Missing

| Gap | What it enables |
|-----|----------------|
| Full temporal DQL | `DATE()`, `NOW()`, `BETWEEN` (partial: `DAYS_AGO` shipped). Shared with UC-3. |
| Retrieval fusion (`kiwi_recall`) | Single call combining FTS5 + vector + backlink-graph with reciprocal rank fusion. Caller controls weights and filters. |
| Pipeline events for memory | SSE event `memory:episodic` on episodic writes, `memory:status_change` on status changes. Operators hook webhooks. |
| `confidence` as search signal | Search uses `confidence` score (0–1) as ranking boost. |

## What KiwiFS Should Explicitly NOT Build

- **No built-in LLM extraction pipeline.** The agent writes markdown. If you want auto-extraction, build it as an external service that calls `kiwi_remember`.
- **No auto-consolidation daemon.** Provide the data (`memory report`), the conventions (`merged-from`), and the Go helper (`InjectMergedFrom`). The operator writes the cron job.
- **No entity linking or knowledge graph construction.** Wiki links `[[page]]` are the knowledge graph. The agent writes them. KiwiFS indexes them.
- **No smart admission gating.** Schema validation is the gate. You define the schema. If it passes, it's stored.
- **No built-in decay algorithm.** Provide `expires_at` and janitor rules. The operator sets the policy. Search has a `recency_weight` knob.

## Proposed Milestones

1. **Temporal DQL** — Remaining: `NOW()`, `DATE()`, `BETWEEN` (`DAYS_AGO` already shipped). Shared with UC-3.
2. **Retrieval fusion** — `/api/kiwi/recall` endpoint combining FTS5 + vector + graph with RRF, scope filtering, and recency weighting. `kiwi_recall` MCP tool.
3. **`confidence` as search signal** — Use `confidence` score (0–1) as ranking boost in search results.

## Good First Issues

See the [Good First Issues](Good-First-Issues) page for issues tagged `uc:agent-memory`.
