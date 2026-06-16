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
- Gated `useTheme` toggle/preset; hid header toggle in `App.tsx`.

## Verification

```bash
cd ui && npm test -- --run src/lib/uiConfigStore.test.ts
# 4 passed
```

## Outcome

Ready for fleet publish (local commit only; no push/PR per fleet policy).
