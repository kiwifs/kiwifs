---
memory_kind: semantic
doc_id: kiwifs-kiwifs-issue-352-theme-presets-config
title: "Issue #352 — workspace theme presets config"
tags: [kiwifs, issue-352, theme, presets, ui, config]
repo: kiwifs/kiwifs
issue_number: 352
languages: [go, typescript]
status: verified
date: 2026-06-17
---

## Problem

PR #379 (`feat/issue-352-theme-presets-config`) was blocked for peer review because:
1. The fleet agent committed `.git-writable/objects/` blobs (`feat: mkdocs export`) instead of source files.
2. The PR branch was based on stale history (`b2064df`) with no merge base against current `main` (`02d767f`), so GitHub reported `mergeable: false` / `dirty`.
3. Blindly checking out the PR's `config.go` regressed current main (removed `BrandingConfig`, `ValidateWrite`, etc.).

## Root cause

Overlay git metadata corruption after a segfault; prior agent committed git object store paths. The PR commit was created from an outdated fork tip, not current `main`.

## Solution

Rebuilt the branch from current `main` and applied theme-preset changes surgically:
- Add `[ui.theme]` with `presets_dir` and `allowed_presets` to `UIConfig` without removing other main config.
- New package `internal/themepresets` loads workspace JSON presets.
- `GET /api/kiwi/theme/presets` exposes presets, builtin slugs, allowlist metadata, and per-file validation errors.
- UI merges workspace + builtin presets in `useTheme` and `KiwiThemeEditor` while preserving `themeLocked`, custom CSS, and user-preference integration on main.

## Files changed

- `internal/config/config.go`, `internal/config/config_test.go`
- `internal/themepresets/presets.go`, `internal/themepresets/presets_test.go`
- `internal/api/handlers_theme_presets.go`, `internal/api/handlers_theme_presets_test.go`, `internal/api/server.go`
- `ui/src/themes/index.ts`, `ui/src/themes/index.test.ts`
- `ui/src/hooks/useTheme.ts`, `ui/src/lib/api.ts`
- `ui/src/components/KiwiThemeEditor.tsx`, `ui/src/components/__mocks__/apiMock.ts`
- `episodes/agents/cursor-issue-352/2026-06-17-theme-presets-config.md`

## Tests

```bash
go test ./internal/themepresets/... -count=1 -v          # 7 passed
go test ./internal/config/... -run TestUIConfigThemePresets -count=1 -v
go test ./internal/api/... -run ThemePresets -count=1 -v  # 5 passed
cd ui && npm test -- --run src/themes/index.test.ts       # 4 passed
```

## Peer review notes

- Do **not** replace whole `config.go` from old PR commits; patch `UIConfig` only.
- Force-push rebased branch onto `feat/issue-352-theme-presets-config` to fix unmergeable PR.
- Remove Cursor attribution from PR body/commits per project policy.

## Reuse guide

For workspace-defined UI presets, mirror the keybindings pattern:
1. TOML config section under `[ui.theme]`.
2. Server-side loader package with path traversal guards.
3. Discovery API endpoint returning data + non-fatal load errors.
4. UI hook fetches on mount and space change, merges with builtins.
