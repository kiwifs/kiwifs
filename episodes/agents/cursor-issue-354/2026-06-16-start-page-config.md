---
memory_kind: episodic
episode_id: cursor-issue-354-2026-06-16
title: "Issue #354 — startup splash / dashboard page config"
tags: [kiwifs, ui, issue-354, start-page, customization]
date: 2026-06-16
---

## Goal

Implement `[ui] start_page` config for welcome, recent, dashboard, and custom path landing modes (kiwifs#354).

## Work done

- Added `UIConfig.StartPage` + `ResolvedStartPage()` and exposed `startPage` on `GET /api/kiwi/ui-config`.
- Added `internal/recentpages` with git-timeline primary listing and filesystem mtime fallback; wired `GET /api/kiwi/recent-pages`.
- Replaced unconditional `firstMarkdown` auto-open in `App.tsx` with `resolveStartPage()` root-only routing.
- Added `KiwiRecentStart` component and `useUIConfig` hook.
- Dashboard mode resolves `dashboard.md` → `pages/dashboard.md` → `index.md`.

## Tests

```
go test ./internal/recentpages/... -count=1                           # PASS
go test ./internal/config/... -run UIConfigStartPage -count=1           # PASS
go test ./internal/api/... -run 'RecentPages|UIConfig' -count=1       # PASS
cd ui && npm test -- --run src/lib/startPage.test.ts                    # PASS (6)
```

## Branch

`feat/issue-354-start-page` (local commit only; fleet publishes PR).
