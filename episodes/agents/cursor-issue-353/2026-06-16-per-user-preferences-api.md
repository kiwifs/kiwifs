---
memory_kind: episodic
episode_id: cursor-issue-353-2026-06-16
title: Implement kiwifs#353 per-user preferences API
tags: [kiwifs, issue-353, preferences, fleet]
date: 2026-06-16
---

Implemented per-user preferences API for [kiwifs/kiwifs#353](https://github.com/kiwifs/kiwifs/issues/353).

## Work done

- Added `internal/preferences` package with load/save/merge and filesystem-safe user IDs.
- Added `GET`/`PUT /api/kiwi/preferences` handlers; preferences stored at `.kiwi/users/{user-id}/preferences.json` with git commit.
- Added `usePreferences` React hook; wired theme preset, sidebar collapse, and editor mode to sync with server.
- Regression tests: Go handler round-trip/merge/validation; Vitest for localStorage merge helpers.

## Test results (hands-on verified 2026-06-16)

```bash
go test ./internal/preferences/... -count=1                    # ok (5 tests)
go test ./internal/api/... -run Preferences -count=1           # ok (4 tests)
go test ./internal/api/... ./internal/preferences/... -count=1 # ok (full package)
cd ui && npm test -- --run src/lib/userPreferences.test.ts \
  src/lib/themeEditLock.test.ts src/lib/uiConfigStore.test.ts  # 9 passed
```

## Notes

- Cherry-picked onto `feat/issue-346-theme-locked`; merged with theme-lock (#346) in `useTheme.ts` and `App.tsx`.
- Fix doc: `pages/fixes/kiwifs-kiwifs/issue-353-per-user-preferences-api.md` (Kiwi depot).
- Branch `feat/issue-346-theme-locked` pushed; PR closes #353 (includes #346 dependency).
