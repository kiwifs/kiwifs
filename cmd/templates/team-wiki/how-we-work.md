---
title: How We Work
owner: team-lead
status: draft
tags: [team-norms, processes]
last-reviewed: 2026-01-01
---

# How We Work

This page documents our team's operating norms — how we communicate,
make decisions, and coordinate work.

## Communication

| Channel | When to use | Response time |
|---------|------------|---------------|
| Slack `#team-general` | Day-to-day questions, quick updates | Same business day |
| Slack `#team-urgent` | Production issues, blockers | < 1 hour |
| Email | External communication, formal requests | 24 hours |
| Wiki (here) | Durable knowledge, decisions, processes | N/A — async |

### Principles

- **Default to async.** Write it down so people in other time zones can catch up.
- **Link, don't repeat.** Point to the wiki page instead of re-explaining in Slack.
- **Decisions in writing.** If it was decided in a meeting, it gets an [[decisions/index|ADR]].

## Meetings

| Meeting | Cadence | Duration | Purpose |
|---------|---------|----------|---------|
| Standup | Daily | 15 min | Blockers and handoffs |
| Planning | Weekly | 60 min | Prioritize upcoming work |
| Retro | Biweekly | 45 min | What went well, what to improve |
| Demo | Biweekly | 30 min | Show completed work |

### Meeting Norms

- Every meeting has an agenda shared beforehand
- Decisions and action items are recorded in the wiki
- No-agenda, no-meeting — cancel if there's nothing to discuss

## Decision Making

We use [[decisions/index|Architecture Decision Records]] for significant choices.

- **Who decides?** The page owner for that area. Escalate if cross-team.
- **How?** Write an ADR with context, options, and rationale.
- **When to revisit?** When reversal conditions are met (documented in the ADR).

## Work Tracking

- Tasks live in the project tracker (link yours here)
- Specs and designs live in this wiki under `processes/`
- Shipped work gets a demo and a wiki update

## Code Review

- All changes require at least one approval
- Review within 24 hours of request
- Use the wiki for design review; use PRs for implementation review
