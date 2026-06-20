---
memory_kind: episodic
episode_id: example-001
session_id: example
scope: user:demo
confidence: 0.9
expires_at: 2026-12-31T00:00:00Z
importance: 3
tags: [onboarding]
related-pages: [pages/getting-started.md]
---
# Example Episode

This is a sample episodic note. Replace or delete this file.

## Observation

What was observed or learned during this session.

## Context

Why this observation matters — what task or question prompted it.

## Decision Trace

Any decisions made and the reasoning behind them.

## Outcome

What resulted from the observation or decision.

---

Each agent session can create files here with `memory_kind: episodic`
and a unique `episode_id`. Set `importance` (1–5) to signal how critical
this observation is for consolidation.

A consolidation step later merges related episodes into durable pages
under `pages/` and records the link via `merged-from` in frontmatter.

Run `kiwifs memory report` to see which episodes haven't been
consolidated yet.
