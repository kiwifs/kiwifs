---
memory_kind: episodic
episode_id: cursor-pr-363-2026-06-16-hands-on-delivery
title: "PR #363 hands-on delivery — isStructuredSidebar regression"
tags: [kiwifs, pr-363, issue-350, sidebar, delivery]
date: 2026-06-16
---

## Task

Hands-on takeover for kiwifs/kiwifs#363 after fleet engineer delivery check failed (`no_committed_diff`).

## Actions

1. Extracted `isStructuredSidebar()` into `sidebarStructure.ts` from inline `AppSidebar` logic.
2. Added regression test: structured mode stays on when sidebar filter hides workspace pins.
3. Updated fix doc with new test coverage note.
4. Ran Go + Vitest suites — all pass.
5. Committed and pushed to `fork/feat/issue-350-sidebar-structure`.

## Test results

```
go test ./internal/config/... ./internal/api/... -run 'UIConfig|Sidebar' — PASS
npm test -- --run src/lib/sidebarStructure.test.ts — 7/7 PASS
npm test — 121/121 PASS
```

## Outcome

- PR: https://github.com/kiwifs/kiwifs/pull/363
- Closes #350
