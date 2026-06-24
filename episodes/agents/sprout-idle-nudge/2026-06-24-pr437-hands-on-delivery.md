---
memory_kind: episodic
episode_id: sprout-idle-nudge-2026-06-24-pr437-hands-on-delivery
title: "PR #437 hands-on delivery — kiwi_recall fusion retrieval"
tags: [kiwifs, issue-422, pr-437, recall, mcp, rrf, hands-on-delivery, sprout-idle-nudge]
date: 2026-06-24
---

# PR #437 hands-on delivery — kiwi_recall fusion retrieval

## Context

Fleet takeover after prior agent reported merge-ready status but failed delivery checks (`no_committed_diff`, `peer_review_not_passed`). Overlay workspace `.git` symlink stale; cloned `advancedresearcharray/kiwifs` branch `feat/kiwi-recall-422` to `/tmp/kiwifs-pr437`.

## Pre-search

- Read local fix docs: `pages/fixes/kiwifs-kiwifs/issue-422-kiwi-recall-fusion.md`, `issue-422-kiwi-recall-go-vet.md`

## Code changes

1. **`internal/search/recall.go`** — remove redundant `searchOpts.Scope` check (duplicate of `opts.Scope`).
2. **`internal/search/recall_test.go`** — add `TestRecallerEmptyQueryReturnsNil` for whitespace-only query guard.

## Verification

```bash
go vet ./internal/search/... ./internal/api/... ./internal/mcpserver/...
go test ./internal/search/... -run 'Recall|FuseRRF' -count=1   # 6 tests PASS
go test ./internal/api/... -run Recall -count=1                 # 3 tests PASS
go test ./internal/mcpserver/... -run Recall -count=1           # 2 tests PASS
```

## Peer review

- RRF fusion, REST `/api/kiwi/recall`, MCP `kiwi_recall` verified end-to-end.
- Vector source skipped when disabled; graph expands 1-hop backlinks from FTS/vector seeds.
- Empty/whitespace query returns nil without error (explicit test added).

## Outcome

Committed and pushed to `feat/kiwi-recall-422`; PR #437 updated for merge.
