# Roadmap

KiwiFS is a markdown filesystem for agents and teams. This roadmap tracks the use cases we're actively building toward.

Each use case has its own page with: what exists today, what's missing vs. industry, and proposed milestones. Use cases are numbered for reference (UC-1, UC-2, …) but the numbers don't imply priority — see the **Current Focus** table for what's active.

---

## Current Focus

| UC | Name | Status | Tracking |
|----|------|--------|----------|
| UC-1 | [Agent Task Orchestration](UC-1-Agent-Task-Orchestration) | Active | [`uc:task-orchestration`](https://github.com/kiwifs/kiwifs/labels/uc%3Atask-orchestration) |
| UC-2 | [Team Wiki](UC-2-Team-Wiki) | Active | [`uc:team-wiki`](https://github.com/kiwifs/kiwifs/labels/uc%3Ateam-wiki) |
| UC-3 | [Structured Data Query](UC-3-Structured-Data-Query) | Exploring | [`uc:data-query`](https://github.com/kiwifs/kiwifs/labels/uc%3Adata-query) |
| UC-4 | [Headless CMS](UC-4-Headless-CMS) | Exploring | [`uc:headless-cms`](https://github.com/kiwifs/kiwifs/labels/uc%3Aheadless-cms) |

**Status legend:** Active = scoped and accepting PRs · Exploring = researching, feedback welcome · Backlog = interesting but not yet scoped

## Backlog

Use cases we find interesting but haven't scoped yet. [Open a Discussion](https://github.com/kiwifs/kiwifs/discussions) to propose a new one.

| UC | Name | Notes |
|----|------|-------|
| — | _Your idea here_ | — |

---

## Adding a New Use Case

1. **Open a GitHub Discussion** describing the use case and who it serves.
2. Once there's interest, create a wiki page following this template:
   - **Thesis** — one paragraph on why this matters for KiwiFS
   - **What exists** — KiwiFS features that already support this use case
   - **Industry comparison** — how other tools solve this problem
   - **What's missing** — gaps to close
   - **Proposed milestones** — ordered steps to an MVP
3. Add a row to the table above.
4. Create a `uc:<name>` label on GitHub.
5. Suggest good first issues on the [Good First Issues](Good-First-Issues) page.

---

## Foundation Roadmap

These are core platform milestones that benefit all use cases. See [`docs/ROADMAP.md`](https://github.com/kiwifs/kiwifs/blob/main/docs/ROADMAP.md) for details.

| Milestone | Key items | Status |
|-----------|-----------|--------|
| v0.1 Foundation | REST, UI, git, FTS, protocols, multi-space | ✅ Done |
| v0.2 Embeddable | MCP server, DQL, memory model | ✅ Done |
| v0.2 Embeddable | React npm package, pipeline/JS hooks | 🔲 Planned |
| v0.3 Import/Export | 18 import sources, JSONL/CSV export | ✅ Done |
| v0.4 Webhooks/Analytics | Content analytics, page views, webhooks | ✅ Done |
| v0.5 Access Control | RBAC, editorial states, retention | 🔲 Planned |

---

*Last updated: May 2026*
