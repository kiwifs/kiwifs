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

| # | Issue | Difficulty | Area |
|---|-------|-----------|------|
| [#145](https://github.com/kiwifs/kiwifs/issues/145) | Ship default task workflow template and frontmatter schema | Beginner | JSON/Markdown |
| [#146](https://github.com/kiwifs/kiwifs/issues/146) | Add TTL (time-to-live) to task claims | Intermediate | Go |
| [#147](https://github.com/kiwifs/kiwifs/issues/147) | Show `blocked_by` dependencies in Kanban board | Beginner | React/TS |
| [#148](https://github.com/kiwifs/kiwifs/issues/148) | Add `kiwi_task_create` MCP tool | Intermediate | Go |
| [#149](https://github.com/kiwifs/kiwifs/issues/149) | Add `kiwi_task_progress` MCP tool and document progress convention | Beginner | Go + Docs |

## UC-2: Team Wiki

> Self-hosted Confluence/Outline replacement, pluggable into Cursor and Codex. [Read more →](UC-2-Team-Wiki)

| # | Issue | Difficulty | Area |
|---|-------|-----------|------|
| [#150](https://github.com/kiwifs/kiwifs/issues/150) | Ship team wiki init template | Beginner | Markdown + Go |
| [#151](https://github.com/kiwifs/kiwifs/issues/151) | Add page watch + webhook notification on changes | Intermediate | Go + React |
| [#152](https://github.com/kiwifs/kiwifs/issues/152) | Add page ordering via frontmatter + drag-and-drop in tree | Beginner–Intermediate | Go + React |
| [#153](https://github.com/kiwifs/kiwifs/issues/153) | Improve Confluence import: preserve page tree and macro mapping | Intermediate | Go |
| [#154](https://github.com/kiwifs/kiwifs/issues/154) | Add "did you mean" search suggestions using edit distance | Intermediate | Go |
| [#155](https://github.com/kiwifs/kiwifs/issues/155) | Export Cursor skill for team wiki search | Beginner | Go + Markdown |

## UC-3: Structured Data Query

> Import databases into markdown and query without RAG. [Read more →](UC-3-Structured-Data-Query)

| # | Issue | Difficulty | Area |
|---|-------|-----------|------|
| [#140](https://github.com/kiwifs/kiwifs/issues/140) | Add `DATE()`, `NOW()`, and `DAYS_AGO()` functions to DQL | Intermediate | Go |
| [#141](https://github.com/kiwifs/kiwifs/issues/141) | Auto-detect field types on CSV/JSON import (schema inference) | Beginner | Go |
| [#142](https://github.com/kiwifs/kiwifs/issues/142) | Add field mapping step to import wizard UI | Intermediate | React/TS |
| [#143](https://github.com/kiwifs/kiwifs/issues/143) | Add `BETWEEN` operator to DQL WHERE clauses | Beginner | Go |

## UC-4: Headless CMS

> Git-native content API for static sites and apps. [Read more →](UC-4-Headless-CMS)

| # | Issue | Difficulty | Area |
|---|-------|-----------|------|
| [#136](https://github.com/kiwifs/kiwifs/issues/136) | Add `published_at` timestamp to feed entries | Beginner | Go |
| [#137](https://github.com/kiwifs/kiwifs/issues/137) | Add content negotiation to public reader endpoint | Beginner | Go |
| [#138](https://github.com/kiwifs/kiwifs/issues/138) | Add publish status badge component to tree view | Beginner | React/TS |
| [#139](https://github.com/kiwifs/kiwifs/issues/139) | Add webhook notification flag to `kiwifs export` | Intermediate | Go |

## Cross-Cutting / Infrastructure

> Improvements that benefit all use cases.

| # | Issue | Difficulty | Area |
|---|-------|-----------|------|
| [#156](https://github.com/kiwifs/kiwifs/issues/156) | Add integration test harness for MCP tools | Intermediate | Go |
| [#157](https://github.com/kiwifs/kiwifs/issues/157) | Generate OpenAPI 3.0 spec from REST API routes | Intermediate | Go |
| [#158](https://github.com/kiwifs/kiwifs/issues/158) | Add Docker Compose dev setup with hot-reload | Beginner | Docker/Docs |
| [#159](https://github.com/kiwifs/kiwifs/issues/159) | Add Storybook stories for Kanban, Graph, and Bases views | Beginner | React/TS |
| [#160](https://github.com/kiwifs/kiwifs/issues/160) | Accessibility audit and fixes for the editor view | Beginner | React/a11y |

---

## Issue Criteria

Following [Kubernetes contributor guidelines](https://www.kubernetes.dev/docs/guide/help-wanted/), all good first issues meet these criteria:

- **No barrier to entry** — understandable without deep project knowledge
- **Provides context** — background and motivation explained in the issue
- **Identifies relevant code** — links to files and functions to modify
- **Ready to test** — existing tests to extend or clear test instructions
- **Scoped** — completable in a single PR, ideally under 200 lines changed
- **Extra help available** — maintainers provide guidance on first PRs
