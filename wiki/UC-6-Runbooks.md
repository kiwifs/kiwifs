# UC-6: Runbooks

**Label:** [`uc:runbooks`](https://github.com/kiwifs/kiwifs/labels/uc%3Arunbooks)

**Live demo:** [demo.kiwifs.com/runbook](https://demo.kiwifs.com/runbook/)

## Thesis

Runbooks rot. They sit in Confluence, drift from reality, and nobody updates them after an incident. The 2026 industry consensus (incident.io, PagerDuty, DevHelm) is "progressive automation": start with documented manual procedures, then make them executable by agents, then close the feedback loop so runbooks evolve from their own execution history. KiwiFS is uniquely positioned because it's already the filesystem where agents read *and* write. A runbook that an agent executes, records outcomes in, and proposes improvements to — all as git-tracked markdown — doesn't exist anywhere else.

## Features

KiwiFS already has strong alignment with structured runbook management:

| Feature | Status | Location |
|---------|--------|----------|
| Markdown files with YAML frontmatter (trigger, severity, owner, services) | ✅ | Every `.md` file |
| Git versioning (every edit tracked, blame, diff, restore) | ✅ | `internal/versioning/` |
| Claims system (agent locks a runbook during execution) | ✅ | `internal/claims/` |
| Append endpoint (`POST /api/kiwi/file/append`) for execution logs | ✅ | `internal/api/handlers_file.go` |
| `X-Actor` / `X-Provenance` headers track who wrote what | ✅ | `internal/pipeline/` |
| Wiki links to services, dashboards, other runbooks | ✅ | `internal/links/` |
| Backlinks ("what runbooks reference auth-service?") | ✅ | `internal/links/` |
| Content health janitor (stale detection, broken links) | ✅ | `internal/janitor/` |
| Execution staleness janitor (`last_executed`, `last_outcome`) | ✅ | `[janitor.execution_staleness]` in `.kiwi/config.toml` |
| Webhooks with HMAC signing for Slack/PagerDuty notifications | ✅ | `internal/webhooks/` |
| MCP tools for agent read/write/search during incidents | ✅ | `internal/mcpserver/` (68+ tools) |
| DQL queries over frontmatter | ✅ | `internal/dataview/` |
| SSE live updates during incident execution | ✅ | `internal/api/handlers_events.go` |
| `kiwifs check` for CI-friendly hygiene scans | ✅ | `cmd/check.go` |

## Industry Comparison

| Feature | Confluence Runbooks | PagerDuty Runbook Automation | Rundeck | incident.io | KiwiFS |
|---------|--------------------|-----------------------------|---------|-------------|--------|
| Structured sections (trigger/steps/rollback/escalation) | Manual | Template-driven | YAML jobs | Workflow builder | Markdown + JSON Schema |
| Version history | Page history | None | SCM optional | Audit log | Git (every write, blame, diff) |
| Agent-executable | ❌ | API-triggered | ✅ (jobs) | ✅ (workflows) | ✅ (MCP + fenced code blocks) |
| Execution feedback loop | ❌ | Metrics | Job logs | Incident timeline | Agent appends outcomes to the file |
| Self-hosted | ✅ (paid) | ❌ (SaaS) | ✅ | ❌ (SaaS) | ✅ (single binary) |
| Search/query across runbooks | Basic | ❌ | Tags | ❌ | FTS5 + vector + DQL |
| Service dependency graph | ❌ | Service catalog | ❌ | Service catalog | Wiki-link graph |

**KiwiFS's unique positioning:** The only system where the runbook, the execution log, and the improvement history are the same git-tracked markdown file. An agent reads the runbook, executes it, records what happened, and proposes edits — all through the same filesystem.

## Execution staleness configuration

Flag runbooks that have not been exercised recently or whose last run failed:

```toml
[janitor.execution_staleness]
directory = "runbooks/"
date_field = "last_executed"
max_age_days = 90

[janitor.execution_staleness.flag_values]
last_outcome = "failure"
```

- **Age check:** files under `directory` where `date_field` is older than `max_age_days` emit `execution-stale` (warning).
- **Flag check:** any frontmatter key in `flag_values` that equals the configured value is flagged regardless of age.
- **Defaults:** `date_field` → `last_executed`; `max_age_days` → `[janitor].stale_days` (90).
- **Surfaces in:** `kiwifs check`, `kiwifs janitor`, scheduled background janitor, `GET /api/kiwi/janitor`.
- **Interaction:** complements generic review staleness (`reviewed`, `next-review`); both can flag the same file.

## What's Missing

| Gap | Why it matters | Industry reference |
|-----|---------------|-------------------|
| Execution outcome schema | Convention exists for `last_executed` / `last_outcome`; missing `execution_count`, `avg_resolution_time` | PagerDuty metrics |
| Structured append metadata | Appends lack structured per-entry metadata (timestamp, actor, outcome per step) | incident.io timeline |
| Claim escalation metadata | Claims don't carry severity or SLA-based escalation timing | PagerDuty escalation policies |
| ~~Frontmatter-only merge~~ | ✅ Shipped: `PATCH /api/kiwi/file/frontmatter` | Concurrent read/write during incidents |
| Service-link frontmatter array | `services` field as indexed wiki-link array for "runbooks for this service" queries | Backstage service catalog |

## Proposed Milestones

1. ~~**Runbook init template**~~ ✅ — Shipped via `kiwifs init --template runbook`: DevHelm 7-section format, `.kiwi/schemas/runbook.json`, example runbook, blank template, and `kiwifs check` regression tests (issue #325, PR #418).
2. **Execution outcome schema** — Standardize frontmatter fields: `last_executed`, `last_outcome`, `execution_count`, `avg_resolution_time`, `services`. Index for DQL.
3. **Structured append metadata** — Extend `POST /api/kiwi/file/append` to accept per-entry metadata (actor, outcome, step_id). Each append creates a structured section with timestamp heading.
4. **Claim escalation** — Extend claims to carry `severity` and `claimed_at`. Janitor flags claims exceeding configurable SLA thresholds.
5. ~~**Frontmatter-only update mode**~~ ✅ — Shipped: `PATCH /api/kiwi/file/frontmatter` updates only frontmatter fields without touching the body.
6. **Service-link indexing** — `services` frontmatter array indexed as wiki-links. DQL: `TABLE title, last_outcome FROM "runbooks/" WHERE services CONTAINS "[[auth-service]]"`.

## Good First Issues

See the [Good First Issues](Good-First-Issues) page for issues tagged `uc:runbook`.
