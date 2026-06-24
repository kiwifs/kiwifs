---
memory_kind: episodic
episode_id: sprout-idle-nudge-2026-06-24-pr437-merge-nurture
title: "PR #437 — kiwi_recall fusion retrieval merge-nurture"
tags: [kiwifs, issue-422, pr-437, recall, mcp, rrf, merge-nurture, sprout-idle-nudge]
date: 2026-06-24
---

# PR #437 — kiwi_recall fusion retrieval merge-nurture

## Context

Merge-first nurture of kiwifs/kiwifs#437 (`feat/kiwi-recall-422`).
Closes #422 — fused memory recall (FTS + vector + graph) via RRF.

## Pre-search

- `kiwi_search` via cluster `http://192.168.167.240:3333` — fix docs not yet indexed; read local copies:
  - `pages/fixes/kiwifs-kiwifs/issue-422-kiwi-recall-fusion.md`
  - `pages/fixes/kiwifs-kiwifs/issue-422-kiwi-recall-go-vet.md`

## CI status

- GitHub Actions run `28071371191`: **SUCCESS** (detect changes, test 6m14s).
- PR merge state: **MERGEABLE**, `mergeStateStatus: CLEAN`, head `eb64a82`.
- No review comments.

## Local verification

Cloned PR ref to `/tmp/kiwifs-pr437` (overlay `.git` symlink broken; workspace had unrelated janitor drift from partial issue-423 external-link code).

```bash
go vet ./internal/search/... ./internal/api/... ./internal/mcpserver/...   # PASS
go test ./internal/search/... -run 'Recall|FuseRRF' -count=1                 # PASS (5 tests)
go test ./internal/api/... -run Recall -count=1                               # PASS (3 tests)
go test ./internal/mcpserver/... -run Recall -count=1                         # PASS (2 tests)
```

## Workspace hygiene

Restored `internal/janitor/janitor.go` and `schedule.go` from PR head — overlay had incomplete issue-423 `ExternalLinkChecker` references without `external_links.go`, breaking local `go test ./internal/api/...`. Not part of PR #437; CI on GitHub unaffected.

## Outcome

PR #437 is merge-ready. No code changes required. Fleet agent may merge when slot available.
