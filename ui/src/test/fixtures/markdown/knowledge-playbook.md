# Agent Playbook — Knowledge Base

This knowledge base follows the LLM Wiki pattern. When connected
via MCP, use these operations to maintain it.

## Quick Start

1. Call `kiwi_context` to get this playbook + schema + index in one call
2. Call `kiwi_tree` to see the current file structure
3. Use the operations below to ingest, query, and maintain

## Ingest (new source → wiki pages)

When given new information to add:

1. **Deduplicate first.** `kiwi_search` for key terms from the source.
   If a page already covers this topic, update it instead of creating
   a duplicate.
2. **Create or update page.**
   `kiwi_write` to `pages/<slug>.md` with frontmatter:
   ```yaml
   ---
   title: "Human-readable title"
   description: "One-line summary"
   tags: [topic-1, topic-2]
   status: active
   ---
   ```
   Set provenance via the `provenance` parameter:
   `ingest:<source-slug>`.
3. **Cross-link.** Use `[[wikilinks]]` in the body to connect to
   related pages. Use `kiwi_search` to discover what exists.
4. **Update the log.** `kiwi_append` to `log.md`:
   `- YYYY-MM-DD: Ingested <title> → [[pages/<slug>]]`
5. **Update the index.** `kiwi_read` `index.md`, add the new
   `[[pages/<slug>]]` link, `kiwi_write` it back.

## Query (answer a question from the wiki)

1. `kiwi_search` for relevant terms (try 2-3 queries).
2. `kiwi_read` top results. Use `if_not_etag` if you've read them
   before to save tokens.
3. `kiwi_backlinks` on key pages to find related context.
4. Synthesize an answer citing `[[page]]` links.
5. If the answer reveals a gap, run Ingest to fill it.

## Deep Retrieval (Graph Navigation)

When answering complex questions that span multiple topics:

1. **Find entry points** — `kiwi_search` with keywords from the question (fast, lexical)
2. **Peek at candidates** — `kiwi_peek` on top 2-3 results. Read title + snippet + headings.
   Decide which page is most relevant.
3. **Walk the graph** — `kiwi_graph_walk` on the best candidate. See what it links to.
   If a link's name matches your query, peek at it.
4. **Read targeted sections** — `kiwi_section` to read only the relevant heading.
   Never read entire files unless they're short (< 500 words per kiwi_peek word_count).
5. **Check the map** — if stuck or need overview, `kiwi_graph_analytics` shows hub pages,
   topic clusters, and bridge pages. Hub pages are good starting points.

### Cost efficiency

| Tool | Typical tokens | When to use |
|------|---------------|-------------|
| `kiwi_search` | ~50 per result | Always first — find entry points |
| `kiwi_peek` | ~200 | Before reading — check if page is relevant |
| `kiwi_section` | ~500 | After peek confirms the right heading |
| `kiwi_read` | ~2000+ | Only when you need the complete file |
| `kiwi_graph_walk` | ~300 | When exploring connections |
| `kiwi_graph_analytics` | ~500 | When lost or need the big picture |

### Example: Multi-hop retrieval

Question: "How does payment retry interact with the circuit breaker?"

```
kiwi_search("payment retry")        → pages/payments.md (rank 1)
kiwi_search("circuit breaker")      → pages/resilience.md (rank 1)
kiwi_graph_walk("pages/payments.md")
  → links_out: ["resilience", "billing", "error-handling"]
  → AHA: payments links to resilience directly!
kiwi_section("pages/payments.md", "Retry Logic")    → 400 tokens
kiwi_section("pages/resilience.md", "Circuit Breaker") → 350 tokens

Total: ~1500 tokens. Full reads would have cost ~8000 tokens.
```

## Remember (save observations during a session)

1. `kiwi_write` to `episodes/<session-id>-<slug>.md` with:
   ```yaml
   ---
   memory_kind: episodic
   episode_id: unique-id
   session_id: current-session
   confidence: 0.8
   importance: 3
   tags: [topic]
   related-pages: [pages/relevant-page.md]
   ---
   ```
2. Structure the episode body with sections:
   - **Observation** — what was learned
   - **Context** — why it matters
   - **Decision Trace** — reasoning behind any choices
   - **Outcome** — what resulted
3. `kiwi_append` to `log.md`:
   `- YYYY-MM-DD: Remembered <summary> → [[episodes/<file>]]`

### Importance Scale

| Level | Meaning | Consolidation |
|-------|---------|---------------|
| 5 | Critical insight, must persist | Consolidate immediately |
| 4 | High value, consolidate soon | Next consolidation pass |
| 3 | Normal observation | Standard weekly consolidation |
| 2 | Low value, context-dependent | Consolidate only if pattern emerges |
| 1 | Ephemeral, unlikely to matter | Archive after 90 days if unused |

## Consolidate (episodes → durable pages)

### When to Run

Consolidation should trigger when:
- `kiwi_memory_report` shows ≥ 5 unconsolidated episodes on the same topic
- Any episode has `importance: 5`
- A weekly maintenance pass runs
- Explicitly requested by a human or orchestrator

### Procedure

1. `kiwi_memory_report` — list unconsolidated episodes.
2. Group episodes by topic (use `tags` and `related-pages`).
3. `kiwi_read` each unconsolidated episode in a topic group.
4. **Check for contradictions.** If episodes disagree with existing pages:
   - Higher confidence wins
   - More recent wins when confidence is equal
   - If ambiguous, flag for human review (do not silently overwrite)
5. Extract durable facts. `kiwi_search` for existing pages on
   those topics.
6. Merge into existing `pages/` entries or create new ones.
   Set `merged-from` in the page frontmatter:
   ```yaml
   merged-from:
     - path: episodes/session-001-finding.md
       episode_id: session-001
       date: 2026-05-30
   ```
7. Set `derived-from` with `type: consolidation` on the page.
8. Mark episodes: `kiwi_write` each with `consolidated: true` and
   `merged-into: [pages/<slug>.md]` added to frontmatter.
9. Update `log.md` and `index.md`.

### Pruning and Archival

After consolidation:
- Episodes with `consolidated: true` older than 90 days: move to
  `episodes/archive/` to reduce retrieval noise.
- Never delete episodes — archive preserves the audit trail.
- Low-importance episodes (≤ 2) older than 90 days without
  consolidation: review and archive or consolidate.

## Lint (maintenance pass)

Run periodically or when asked to clean up:

1. `kiwi_lint` with `path` — check a specific file for structural issues
   (tables, fences, frontmatter, headings, mermaid diagrams).
2. Review the issues list — fix any errors before considering the write complete.
3. `kiwi_analytics` — broader workspace health (orphans, broken links,
   stale content, missing frontmatter).
4. `kiwi_changes` with `since=<last_checkpoint>` — review recent
   edits for quality.
5. For each issue:
   - Orphan page → add `[[wikilinks]]` from related pages or index
   - Broken link → `kiwi_search` for intended target, fix the link
   - Stale page → update content, bump `last-reviewed`
   - Duplicate → merge into one, `kiwi_rename` + `kiwi_delete`
6. `kiwi_append` to `log.md` with what was fixed.

**Best practice:** After every `kiwi_write`, call `kiwi_lint` on the same path.
If issues are returned, fix and `kiwi_write` again. This loop rarely needs
more than one retry — the server auto-formats cosmetic issues on write, so
`kiwi_lint` only reports things that need semantic fixes.

## Page Format

```markdown
---
title: "Page Title"
description: "Brief one-line summary"
tags: [tag1, tag2]
status: active
last-reviewed: YYYY-MM-DD
---

# Page Title

Introduction paragraph.

## Section

Content with [[wikilinks]] to related pages.

## Related
- [[related-page]] — why it's related
```

## Quality Rules

- **One concept per page.** Split pages over 300 lines.
- **Every page needs frontmatter** with at least `title` and `tags`.
- **No orphans.** Every page reachable from `index.md` within 2 hops.
- **No broken links.** Every `[[wikilink]]` should resolve.
- **Provenance.** Agent-created pages must set provenance on write.
- **Prefer pages over episodes.** When querying, use consolidated
  pages as primary source. Fall back to episodes only if no page exists.

## Canvas (visual knowledge maps)

Generate spatial visualizations of the knowledge graph that humans can
review, rearrange, and annotate.

### Auto-generate a canvas from the link graph

```
kiwi_canvas_generate(
  path: "maps/architecture.canvas.json",
  layout: "dot",       // or "neato", "fdp", "circo"
  folder: "pages/",    // scope to a subtree
  colorize: true       // color nodes by topic cluster
)
```

The agent picks the layout algorithm based on the graph shape:
- `dot` (hierarchical) — best for dependency trees, taxonomies
- `neato` (spring model) — best for peer-to-peer relationship graphs
- `fdp` (force-directed) — best for large, loosely connected graphs
- `circo` (circular) — best for cyclic processes, pipelines

### Manually build a canvas

For curated maps (e.g. onboarding, architecture overviews):

1. `kiwi_canvas_list` — see existing canvases.
2. `kiwi_canvas_read(path)` — read an existing canvas.
3. Build or modify the nodes/edges JSON.
4. `kiwi_canvas_write(path, content)` — save it.

### Example: Map a topic cluster

```
kiwi_graph_analytics()
  → cluster "payments" has 12 pages
kiwi_canvas_generate(
  path: "maps/payments.canvas.json",
  folder: "pages/payments/",
  layout: "dot",
  colorize: true
)
  → saved with 12 nodes, 18 edges
```

Human opens the canvas in the UI, drags nodes into a cleaner layout,
adds text annotations. Agent work + human polish.

## Workflows & Kanban (state machines for pages)

Manage page lifecycles with defined states and transitions.
The Kanban board groups pages by their current workflow state.

### Set up a workflow

Workflows live in `.kiwi/workflows/` as YAML files. The agent creates
and manages them:

1. `kiwi_workflow_list` — see existing workflows.
2. `kiwi_workflow_save` — create or update a workflow definition:
   ```json
   {
     "name": "content-pipeline",
     "states": [
       {"name": "draft", "color": "#9B59B6"},
       {"name": "review", "color": "#F39C12"},
       {"name": "published", "color": "#2ECC71", "terminal": true},
       {"name": "archived", "color": "#95A5A6", "terminal": true}
     ],
     "transitions": [
       {"from": "draft", "to": "review"},
       {"from": "review", "to": "draft"},
       {"from": "review", "to": "published"},
       {"from": "published", "to": "archived"}
     ]
   }
   ```
3. `kiwi_workflow_get(name)` — read a workflow definition.

### Advance pages through the workflow

Pages participate in workflows via the `status` frontmatter field:

```
kiwi_write("pages/new-feature.md", content_with_frontmatter, actor: "agent")
  # frontmatter includes: status: draft

kiwi_workflow_advance(
  path: "pages/new-feature.md",
  target_state: "review",
  actor: "agent"
)
  → moved from "draft" to "review"
```

The agent can only advance along defined transitions. Invalid moves
are rejected — this enforces process discipline.

### View the Kanban board

```
kiwi_workflow_board(workflow: "content-pipeline")
  → { "draft": [page1, page2], "review": [page3], "published": [page4, ...] }
```

### Example: Content pipeline agent

```
# 1. Find pages that need review
kiwi_workflow_board("content-pipeline")
  → draft: ["pages/api-guide.md", "pages/deploy-notes.md"]

# 2. Review each draft
kiwi_read("pages/api-guide.md")
kiwi_lint("pages/api-guide.md")
  → no issues
kiwi_workflow_advance("pages/api-guide.md", "review", actor: "reviewer-agent")

# 3. After human approval, publish
kiwi_workflow_advance("pages/api-guide.md", "published", actor: "publisher-agent")
```

### Example: Automated triage

```
# Find all uncategorized pages (no status field)
kiwi_query("SELECT path FROM pages WHERE status IS NULL")
  → 5 pages without workflow state

# Assign them to the pipeline as drafts
for each page:
  kiwi_workflow_advance(page, "draft", actor: "triage-agent")
```
