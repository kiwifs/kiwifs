# Roadmap

KiwiFS is a markdown filesystem for agents and teams. This roadmap tracks the use cases we're actively building toward.

Each use case has its own wiki page with: features, industry comparison, gaps, and proposed milestones. Numbers are for reference — they don't imply priority. All use cases are accepting PRs.

---

## Use Cases

| UC | Name | Tracking |
|----|------|----------|
| UC-1 | [Agent Task Orchestration](UC-1-Agent-Task-Orchestration) | [`uc:task-orchestration`](https://github.com/kiwifs/kiwifs/labels/uc%3Atask-orchestration) |
| UC-2 | [Team Wiki](UC-2-Team-Wiki) | [`uc:team-wiki`](https://github.com/kiwifs/kiwifs/labels/uc%3Ateam-wiki) |
| UC-3 | [Structured Data Query](UC-3-Structured-Data-Query) | [`uc:data-query`](https://github.com/kiwifs/kiwifs/labels/uc%3Adata-query) |
| UC-4 | [Headless CMS](UC-4-Headless-CMS) | [`uc:headless-cms`](https://github.com/kiwifs/kiwifs/labels/uc%3Aheadless-cms) |
| UC-5 | [Agent Memory](UC-5-Agent-Memory) | [`uc:agent-memory`](https://github.com/kiwifs/kiwifs/labels/uc%3Aagent-memory) |
| UC-6 | [Runbooks](UC-6-Runbooks) | [`uc:runbooks`](https://github.com/kiwifs/kiwifs/labels/uc%3Arunbooks) |
| UC-7 | [Architecture Decision Records](UC-7-Architecture-Decision-Records) | [`uc:adr`](https://github.com/kiwifs/kiwifs/labels/uc%3Aadr) |
| UC-8 | [Prompt Library](UC-8-Prompt-Library) | [`uc:prompt-library`](https://github.com/kiwifs/kiwifs/labels/uc%3Aprompt-library) |
| UC-9 | [Research Library](UC-9-Research-Library) | [`uc:research`](https://github.com/kiwifs/kiwifs/labels/uc%3Aresearch) |
| UC-10 | [Event Log](UC-10-Event-Log) | [`uc:event-log`](https://github.com/kiwifs/kiwifs/labels/uc%3Aevent-log) |
| — | _Your idea here_ | [Open a Discussion](https://github.com/kiwifs/kiwifs/discussions) |

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
| v0.2 Embeddable | MCP server, DQL, memory model, widget system | ✅ Done |
| v0.2 Embeddable | React npm package, pipeline/JS hooks | 🔲 Planned |
| v0.3 Import/Export | 18 import sources, JSONL/CSV export, MkDocs export | ✅ Done |
| v0.4 Webhooks/Analytics | Content analytics, page views, OpenAPI spec, KiwiDocs, PDF export | ✅ Done |
| v0.5 Access Control | RBAC, editorial states, retention | 🔲 Planned |

---

*Last updated: June 2026*
