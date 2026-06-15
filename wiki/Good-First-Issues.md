# Good First Issues

Scoped, beginner-friendly tasks for new contributors. Each issue has:
- Clear context and motivation
- Links to relevant code
- Guidance on how to test
- Low architectural risk

**How to claim:** Comment on the issue with a one-line plan. We'll respond within 48 hours. See the [Contributing Guide](Contributing) for full details.

**Browse all on GitHub:** [`good first issue`](https://github.com/kiwifs/kiwifs/labels/good%20first%20issue)

---

## UC-1: Agent Task Orchestration

> Build a workspace where humans and agents collaborate on tasks via markdown. [Read more →](UC-1-Agent-Task-Orchestration)

| # | Issue | Difficulty | Area | Status |
|---|-------|-----------|------|--------|
| [#145](https://github.com/kiwifs/kiwifs/issues/145) | Ship default task workflow template and frontmatter schema | Beginner | JSON/Markdown | ✅ Done |
| [#146](https://github.com/kiwifs/kiwifs/issues/146) | Add TTL (time-to-live) to task claims | Intermediate | Go | Open |
| [#147](https://github.com/kiwifs/kiwifs/issues/147) | Show `blocked_by` dependencies in Kanban board | Beginner | React/TS | ✅ Done |
| [#148](https://github.com/kiwifs/kiwifs/issues/148) | Add `kiwi_task_create` MCP tool | Intermediate | Go | ✅ Done |
| [#149](https://github.com/kiwifs/kiwifs/issues/149) | Add `kiwi_task_progress` MCP tool and document progress convention | Beginner | Go + Docs | ✅ Done |

## UC-2: Team Wiki

> Self-hosted Confluence/Outline replacement, pluggable into Cursor and Codex. [Read more →](UC-2-Team-Wiki)

| # | Issue | Difficulty | Area | Status |
|---|-------|-----------|------|--------|
| [#150](https://github.com/kiwifs/kiwifs/issues/150) | Ship team wiki init template | Beginner | Markdown + Go | ✅ Done |
| [#151](https://github.com/kiwifs/kiwifs/issues/151) | Add page watch + webhook notification on changes | Intermediate | Go + React | ✅ Done |
| [#152](https://github.com/kiwifs/kiwifs/issues/152) | Add page ordering via frontmatter + drag-and-drop in tree | Beginner–Intermediate | Go + React | ✅ Done |
| [#153](https://github.com/kiwifs/kiwifs/issues/153) | Improve Confluence import: preserve page tree and macro mapping | Intermediate | Go | ✅ Done |
| [#154](https://github.com/kiwifs/kiwifs/issues/154) | Add "did you mean" search suggestions using edit distance | Intermediate | Go | ✅ Done |
| [#155](https://github.com/kiwifs/kiwifs/issues/155) | Export Cursor skill for team wiki search | Beginner | Go + Markdown | ✅ Done |

## UC-3: Structured Data Query

> Import databases into markdown and query without RAG. [Read more →](UC-3-Structured-Data-Query)

| # | Issue | Difficulty | Area | Status |
|---|-------|-----------|------|--------|
| [#140](https://github.com/kiwifs/kiwifs/issues/140) | Add `DATE()`, `NOW()`, and `DAYS_AGO()` functions to DQL | Intermediate | Go | Partial (`DAYS_AGO` done) |
| [#141](https://github.com/kiwifs/kiwifs/issues/141) | Auto-detect field types on CSV/JSON import (schema inference) | Beginner | Go | ✅ Done |
| [#142](https://github.com/kiwifs/kiwifs/issues/142) | Add field mapping step to import wizard UI | Intermediate | React/TS | ✅ Done |
| [#143](https://github.com/kiwifs/kiwifs/issues/143) | Add `BETWEEN` operator to DQL WHERE clauses | Beginner | Go | Open |

## UC-4: Headless CMS

> Git-native content API for static sites and apps. [Read more →](UC-4-Headless-CMS)

| # | Issue | Difficulty | Area | Status |
|---|-------|-----------|------|--------|
| [#136](https://github.com/kiwifs/kiwifs/issues/136) | Add `published_at` timestamp to feed entries | Beginner | Go | ✅ Done |
| [#137](https://github.com/kiwifs/kiwifs/issues/137) | Add content negotiation to public reader endpoint | Beginner | Go | ✅ Done |
| [#138](https://github.com/kiwifs/kiwifs/issues/138) | Add publish status badge component to tree view | Beginner | React/TS | ✅ Done |
| [#139](https://github.com/kiwifs/kiwifs/issues/139) | Add webhook notification flag to `kiwifs export` | Intermediate | Go | ✅ Done |

## UC-5: Agent Memory

> Persistent memory library for AI agents — stores, indexes, and versions memories as markdown. [Read more →](UC-5-Agent-Memory)

| # | Issue | Difficulty | Area | Status |
|---|-------|-----------|------|--------|
| — | Add `DATE()` and `NOW()` functions to DQL | Intermediate | Go | Open |
| — | Add `BETWEEN` operator to DQL WHERE clauses | Beginner | Go | Open (shared with UC-3) |
| — | Implement retrieval fusion endpoint (`/api/kiwi/recall`) | Intermediate | Go | Open |
| — | Add `kiwi_recall` MCP tool (fused FTS + vector + graph) | Intermediate | Go | Open |
| — | Add `confidence` as search ranking signal | Beginner | Go | Open |

## Cross-Cutting / Infrastructure

> Improvements that benefit all use cases.

| # | Issue | Difficulty | Area | Status |
|---|-------|-----------|------|--------|
| [#156](https://github.com/kiwifs/kiwifs/issues/156) | Add integration test harness for MCP tools | Intermediate | Go | Open |
| [#157](https://github.com/kiwifs/kiwifs/issues/157) | Generate OpenAPI 3.0 spec from REST API routes | Intermediate | Go | ✅ Done |
| [#158](https://github.com/kiwifs/kiwifs/issues/158) | Add Docker Compose dev setup with hot-reload | Beginner | Docker/Docs | ✅ Done |
| [#159](https://github.com/kiwifs/kiwifs/issues/159) | Add Storybook stories for Kanban, Graph, and Bases views | Beginner | React/TS | ✅ Done |
| [#160](https://github.com/kiwifs/kiwifs/issues/160) | Accessibility audit and fixes for the editor view | Beginner | React/a11y | Open |

---

## Issue Criteria

Following [Kubernetes contributor guidelines](https://www.kubernetes.dev/docs/guide/help-wanted/), all good first issues meet these criteria:

- **No barrier to entry** — understandable without deep project knowledge
- **Provides context** — background and motivation explained in the issue
- **Identifies relevant code** — links to files and functions to modify
- **Ready to test** — existing tests to extend or clear test instructions
- **Scoped** — completable in a single PR, ideally under 200 lines changed
- **Extra help available** — maintainers provide guidance on first PRs
