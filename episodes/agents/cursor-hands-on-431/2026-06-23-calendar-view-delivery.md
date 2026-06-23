---
memory_kind: episodic
episode_id: cursor-hands-on-431-2026-06-23
title: "Hands-on takeover: calendar view PR #431 / issue #427"
tags: [kiwifs, issue-427, pr-431, calendar, ui, hands-on-takeover, peer-review]
date: 2026-06-23
---

# Episode: calendar view #427 hands-on delivery

## Context

Fleet engineer `peer_review_blocked` on kiwifs/kiwifs#431. Overlay workspace at `/tmp/kiwifs-overlay/mnt` has read-only `.git/FETCH_HEAD`; prior agent ran unrelated MkDocs tests. Writable clone at `/tmp/kiwifs-work` on branch `feat/calendar-view-frontmatter-dates-427` had 2 commits already pushed.

## Actions

1. Searched Kiwi memory — no prior fix doc for #427.
2. Verified PR branch: 200 UI tests pass, `go test ./internal/config/...` pass, CI `test` job green.
3. Peer review fix: mobile week view used month-only DQL while displaying days that can span two months — added `weekRange`, `buildDateRangeQuery`, `addDaysToDateKey`; mobile loads week-bounded query.
4. Added 2 unit tests (date-range DQL, cross-month week range). 30/30 calendar-related tests pass.
5. Committed, pushed to fork, wrote fix doc + episodic log.

## Outcome

- PR: https://github.com/kiwifs/kiwifs/pull/431
- Closes #427
- Commits: `bc02692` feat, `c1b512c` DATE() DQL fix, + mobile week-range fix (this session)
