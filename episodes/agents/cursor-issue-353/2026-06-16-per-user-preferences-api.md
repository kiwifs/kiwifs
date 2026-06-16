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

## Test results

- `go test ./internal/preferences/...` — PASS (5 tests)
- `go test ./internal/api/... -run Preferences` — PASS (4 tests)
- `npm test -- --run src/lib/userPreferences.test.ts` — PASS (3 tests)

## Notes

- Cherry-picked onto `feat/issue-346-theme-locked`; merged with theme-lock (#346) in `useTheme.ts` and `App.tsx`.
- Kiwi MCP gateway unavailable; fix doc at `pages/fixes/kiwifs-kiwifs/issue-353-per-user-preferences-api.md`.
- Fleet agent to publish branch + open PR closing #353.
