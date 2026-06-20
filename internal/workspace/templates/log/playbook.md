# Agent Playbook — Event Log

This workspace is an append-only event log. Events are immutable once
written — never modify existing entries. Git provides the tamper-evident
hash chain.

## Quick Start

1. Call `kiwi_context` to get this playbook + schema + index in one call
2. Call `kiwi_tree` to see log files
3. Use `kiwi_append` to add new events

## Log Event

When recording an event:

1. **Determine the event type** using the taxonomy in `schemas/README.md`.
   Format: `<domain>.<resource>.<action>.v<version>`

2. **Find today's log file** at `events/YYYY-MM-DD.md`.
   If it doesn't exist, create it with:
   ```yaml
   ---
   title: "Events — YYYY-MM-DD"
   type: daily-log
   date: YYYY-MM-DD
   append_only: true
   entry_count: 0
   tags: [events, daily]
   ---
   ```

3. **Append the entry** using `kiwi_append`:
   ```markdown

   ## YYYY-MM-DDTHH:MM:SSZ | event.type.v1

   - **Actor:** type:identifier
   - **Target:** type:identifier
   - **Correlation:** req:uuid
   - **Details:** What happened in plain language
   ```

4. **Increment `entry_count`** in the daily log frontmatter.

## Rules

- **NEVER modify existing entries.** Only append new ones.
- **NEVER delete log files.** Archive old files if needed.
- **Always include all required fields** (timestamp, event type, actor, target, correlation).
- **Use versioned event types.** Increment version when schema changes.
- **Use stable actor identifiers.** Not session IDs — use user IDs, service names.

## Query Events

Use DQL to query across log files:

```
kiwi_query("TABLE title, event_type, actor FROM \"events/\" WHERE event_type CONTAINS \"user.login\" SORT occurred_at DESC LIMIT 20")
```

### Common Queries

| Purpose | Query |
|---------|-------|
| All events today | `TABLE ... FROM "events/" WHERE date = "2026-06-20"` |
| Events by actor | `TABLE ... FROM "events/" WHERE actor CONTAINS "alice"` |
| Event type counts | `TABLE event_type, COUNT(event_type) FROM "events/" GROUP BY event_type` |
| Failed events | `TABLE ... FROM "events/" WHERE event_type CONTAINS "failed"` |

## Maintain

1. **Verify integrity** — `kiwifs check` validates git hash chain.
2. **Check continuity** — ensure no gaps in daily log files.
3. **Monitor growth** — archive old files when they exceed rotation threshold.
4. **Validate entries** — ensure all entries match the taxonomy schema.

## Quality Rules

- **Append-only.** Never edit or delete existing events.
- **Complete entries.** Every event has timestamp, type, actor, target, correlation.
- **Versioned types.** All event types include version suffix.
- **Daily partitioning.** One file per day in `events/YYYY-MM-DD.md`.
- **Tamper evident.** Git commit per append provides hash chain.
