---
memory_kind: episodic
episode_id: cursor-issue-354-2026-06-16-takeover
title: "Issue #354 — hands-on takeover verification"
tags: [kiwifs, ui, issue-354, start-page, takeover, peer-review]
date: 2026-06-16
---

## Context

Fleet engineer agent reported completion but delivery check failed (`no_committed_diff`, `peer_review_not_passed`). Hands-on takeover verified commit `774f39f` on `feat/issue-354-start-page` and PR #362.

## Peer review

- Confirmed `firstMarkdown` auto-open removed from root startup; welcome/recent/dashboard/path modes route correctly.
- Deep links (`/page/...`, hash routes) bypass start page via `hasDeepLinkPath()` + `shouldApplyStartPage()`.
- `recentpages.List` falls back to filesystem mtimes when git log unavailable.
- Fixed minor UX: hide empty author label in `KiwiRecentStart` when filesystem fallback has no git actor.

## Tests (all pass)

```
go test ./internal/recentpages/... -count=1                           # PASS
go test ./internal/config/... -run UIConfigStartPage -count=1         # PASS
go test ./internal/api/... -run 'RecentPages|UIConfig' -count=1       # PASS
go test ./internal/api/... -short -count=1                            # PASS
cd ui && npm test -- --run src/lib/startPage.test.ts                  # PASS (6)
```

## Deliverables

- PR: https://github.com/kiwifs/kiwifs/pull/362
- Fix doc: `pages/fixes/kiwifs-kiwifs/issue-354-start-page-config.md` (local, gitignored)
