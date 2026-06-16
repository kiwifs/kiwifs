---
memory_kind: episodic
episode_id: cursor-issue-346-2026-06-16
title: "Issue #346 — wire themeLocked from ui-config"
tags: [kiwifs, issue-346, theme, ui-config, bounty]
date: 2026-06-16
---

## Task

Fix kiwifs/kiwifs#346: call `getUIConfig()` on boot and disable theme editing when `themeLocked` is true.

## Approach

- Searched Kiwi (`themeLocked ui-config 346`) — no prior fix doc.
- Branch: `feat/issue-346-theme-locked` from `origin/main`.
- Added `uiConfigStore` (Zustand) loaded in `main.tsx` before render.
- Gated `useTheme` toggle/preset via `guardedThemeAction`; hid header toggle in `App.tsx`.
- Durable fix doc: `pages/fixes/kiwifs-kiwifs/issue-346-theme-locked-ui-config.md`.

## Verification

```bash
cd ui && npm test -- --run src/lib/uiConfigStore.test.ts src/lib/themeEditLock.test.ts
# 6 passed
cd ui && npm test -- --run
# 114 passed (full suite)
```

## Outcome

Ready for fleet publish (local commit only; no push/PR per fleet policy).
