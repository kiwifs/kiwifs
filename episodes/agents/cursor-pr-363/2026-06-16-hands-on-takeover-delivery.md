---
memory_kind: episodic
episode_id: cursor-pr-363-2026-06-16-hands-on-takeover
title: "PR #363 hands-on takeover — sidebar filter structured-mode fix"
tags: [kiwifs, pr-363, issue-350, sidebar, delivery]
date: 2026-06-16
---

## Task

Hands-on takeover for kiwifs/kiwifs#363 after fleet engineer delivery check failed (code_not_delivered).

## Actions

1. Reset local branch to `fork/feat/issue-350-sidebar-structure` (removed unrelated ClawWork docs commit).
2. Fixed `usesStructuredSidebar` in `AppSidebar.tsx` — use unfiltered `sidebarConfig.pinned` so tree exclusions stay active when the sidebar filter hides all workspace pins.
3. Updated `ui/LAYOUT.md` with workspace vs user-local pin section order and `[ui.sidebar]` config note.
4. Ran tests, committed `17edfac`, pushed to fork.

## Test results

```
go test ./internal/config/... ./internal/api/... -run 'UIConfig|Sidebar' — PASS
npm test -- --run src/lib/sidebarStructure.test.ts — 6/6 PASS
npm test — 120/120 PASS
```

## Outcome

- PR: https://github.com/kiwifs/kiwifs/pull/363
- Closes #350
