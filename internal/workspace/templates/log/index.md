---
title: Event Log
owner: ops-lead
status: active
tags: [meta, navigation]
append_only: true
---

# Event Log

An append-only event log for audit trails, decision logs, agent actions,
and any append-only record where human readability matters. Every entry
is git-tracked for tamper evidence.

## Sections

- [[events/index|Events]] — Chronological event entries
- [[schemas/README|Schemas]] — Event type taxonomy and field definitions

## Recent Events

```kiwi-query
TABLE title, event_type, actor, occurred_at
FROM "events/"
SORT occurred_at DESC
LIMIT 10
```

## Event Counts

```kiwi-query
TABLE event_type, COUNT(event_type) AS count
FROM "events/"
GROUP BY event_type
SORT count DESC
```
