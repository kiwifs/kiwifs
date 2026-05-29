---
type: decision
title: "ADR-001: Example — Use PostgreSQL for Primary Datastore"
status: active
date: 2026-01-01
owner: tech-lead
decision: Use PostgreSQL as the primary relational datastore
alternatives:
  - option: PostgreSQL
    pros: Mature, strong ecosystem, JSONB for semi-structured data
    cons: Requires DBA knowledge for tuning at scale
  - option: MongoDB
    pros: Flexible schema, easy to start
    cons: Weak transactions, harder to enforce data integrity
  - option: SQLite
    pros: Zero-ops, embedded
    cons: Single-writer, no networked access
impact: All services use PostgreSQL; team needs PG expertise
reversal-conditions: If we outgrow single-node PG and need a fundamentally different data model
linked-docs: []
tags: [adr, database, infrastructure]
---

# ADR-001: Use PostgreSQL for Primary Datastore

> **This is an example ADR.** Replace it with your first real decision,
> or delete it once you've created your own.

## Context

We need a primary datastore for the application. The choice affects
every service, developer workflow, and operational procedure.

## Decision

Use PostgreSQL. It handles our relational data model, supports JSONB
for semi-structured fields, and has a mature ecosystem of tools,
hosting options, and community knowledge.

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| PostgreSQL | Mature, strong ecosystem, JSONB | Requires tuning at scale |
| MongoDB | Flexible schema, easy start | Weak transactions |
| SQLite | Zero-ops, embedded | Single-writer only |

## Consequences

- All services connect to a shared PG instance (or cluster)
- Migrations managed via a schema migration tool
- Team should invest in PG operational knowledge

## Reversal Conditions

Revisit this decision if:
- We need a fundamentally different data model (graph, time-series)
- Single-node PG becomes a bottleneck we can't solve with read replicas
