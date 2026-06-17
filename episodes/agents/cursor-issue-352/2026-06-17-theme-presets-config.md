---
memory_kind: episodic
episode_id: cursor-issue-352-2026-06-17
title: "Issue #352 — workspace theme presets config"
tags: [kiwifs, issue-352, theme, presets, customization, bounty]
date: 2026-06-17
---

## Task

Implement kiwifs/kiwifs#352: workspace-defined theme presets via `[ui.theme]`, API discovery, and UI preset selector.

## Approach

- Kiwi MCP search unavailable (gateway auth); no prior fix doc in repo.
- Added `UIThemeConfig` + `internal/themepresets` loader (mirrors keybindings pattern).
- `GET /api/kiwi/theme/presets` serves workspace JSON + builtin slug metadata + validation errors.
- UI merges server presets with bundled builtins; `useTheme` + `KiwiThemeEditor` wired.

## Verification

```bash
go test ./internal/themepresets/ -count=1 -v                    # 7 passed
go test ./internal/config/... -run TestUIConfigThemePresets -count=1 -v
go test ./internal/api/... -run ThemePresets -count=1 -v        # 5 passed
cd ui && npm test -- --run src/themes/index.test.ts               # 4 passed
```

## Outcome

Hands-on takeover: rebuilt branch from current main after git overlay corruption and stale PR base. Surgical integration preserves main branding/theme-lock features. Fix doc: `pages/fixes/kiwifs-kiwifs/issue-352-theme-presets-config.md`.
