---
title: Decisions
owner: tech-lead
status: active
tags: [decisions, adr]
last-reviewed: 2026-01-01
---

# Decisions

We record significant technical and process decisions as Architecture
Decision Records (ADRs). This prevents re-debating settled questions
and gives future team members the *why* behind our choices.

## When to Write an ADR

Write one when a decision:
- Affects multiple people or teams
- Is hard or expensive to reverse
- Was debated — the alternatives matter
- Changes architecture, tooling, or team process

## ADR Format

Use the ADR template (`.kiwi/templates/decision.md`) or create a page
with this structure:

```yaml
---
type: decision
status: active          # proposed → active → deprecated → superseded
date: YYYY-MM-DD
owner: person-or-team
decision: one-line summary
tags: [adr, topic]
---
```

Each ADR should have: **Context** (why now?), **Options** (what we
considered), **Decision** (what we chose), **Consequences** (what
follows), and **Reversal Conditions** (when to revisit).

## Decision Log

| ID | Date | Decision | Status |
|----|------|----------|--------|
| _ADR-001_ | _2026-01-01_ | _Example: Use PostgreSQL for primary datastore_ | _active_ |

_Add new decisions above this line. Use `[[decisions/adr-NNN]]` links._
