---
memory_kind: episodic
episode_id: cursor-issue-353-peer-review-2026-06-16
title: "PR #366 peer review — fix UserID path traversal in preferences API"
tags: [kiwifs, issue-353, pr-366, preferences, peer-review, security]
date: 2026-06-16
---

## Context

Hands-on takeover for [PR #366](https://github.com/kiwifs/kiwifs/pull/366) (closes #353). Prior fleet agent left code implemented but delivery check failed (`no_committed_diff`, `peer_review_not_passed`).

## Peer review finding

`preferences.UserID("..")` returned `".."`, and `RelPath("..")` cleaned to `.kiwi/preferences.json` — outside `.kiwi/users/`. An actor header of `..` could write preferences outside the per-user directory.

## Fix

- Added `safeUserID()` to reject `.`, `..`, and any ID whose cleaned rel path escapes `.kiwi/users/`.
- `UserID()` returns `""` for unsafe IDs; handlers already return 401.
- Added `TestUserID_RejectsPathTraversal`, extended `TestUserID`, and `TestPutPreferences_PathTraversalActor`.

## Test results

```bash
go test ./internal/preferences/... -count=1                           # ok (6 tests)
go test ./internal/api/... -run Preferences -count=1                  # ok (5 tests)
cd ui && npm test -- --run src/lib/userPreferences.test.ts \
  src/lib/themeEditLock.test.ts src/lib/uiConfigStore.test.ts         # 9 passed
```

## Commit

`fdb2b9c` — fix(preferences): reject path traversal in UserID sanitization

Fix doc: `pages/fixes/kiwifs-kiwifs/issue-353-per-user-preferences-api.md` (Kiwi depot — peer review section updated)
