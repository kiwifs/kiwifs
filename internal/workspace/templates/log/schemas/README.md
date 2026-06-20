---
title: Event Type Taxonomy
owner: ops-lead
status: active
tags: [schemas, events]
---

# Event Type Taxonomy

Event types follow a namespaced, versioned convention:
`<domain>.<resource>.<action>.v<version>`

## Domains

| Domain | Description | Examples |
|--------|-------------|----------|
| `system` | Infrastructure events | `system.startup.v1`, `system.shutdown.v1` |
| `user` | Authentication and identity | `user.login.success.v1`, `user.login.failed.v1` |
| `content` | Content operations | `content.page.created.v1`, `content.page.published.v1` |
| `admin` | Administrative actions | `admin.user.created.v1`, `admin.config.updated.v1` |
| `agent` | AI agent operations | `agent.task.started.v1`, `agent.task.completed.v1` |
| `webhook` | External integrations | `webhook.received.v1`, `webhook.dispatched.v1` |

## Event Entry Structure

Every event entry must include:

| Field | Required | Description |
|-------|----------|-------------|
| **Timestamp** | ✅ | ISO 8601 with timezone (heading) |
| **Event type** | ✅ | Namespaced, versioned type (heading) |
| **Actor** | ✅ | Who/what initiated the event (`type:identifier`) |
| **Target** | ✅ | What was acted upon (`type:identifier`) |
| **Correlation** | ✅ | Request/trace ID for linking related events |
| **Details** | ❌ | Human-readable description |

## Versioning

When an event schema changes:
1. Increment the version: `user.login.success.v1` → `user.login.success.v2`
2. Document the change in this file
3. Old versions remain valid — never remove a version
4. Consumers handle all active versions

## Actor Types

| Prefix | Meaning | Example |
|--------|---------|---------|
| `user:` | Human user | `user:alice@example.com` |
| `agent:` | AI agent | `agent:reviewer-bot` |
| `system:` | System process | `system:kiwifs` |
| `webhook:` | External system | `webhook:github` |
| `cron:` | Scheduled job | `cron:janitor` |
