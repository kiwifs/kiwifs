import * as blk from "../blocks";
import { demoBacklinks, demoComments, demoSearch } from "./mockExtras";

export const logPages: Record<string, string> = {
  "index.md": `---
title: Audit trail index
type: index
---

Append-only daily event logs under \`events/\`. Each file is git-versioned; entries use structured H2 sections per the event schema.

${blk.queryTable('TABLE date, entry_count FROM "events/" WHERE type = "daily-log" SORT date DESC')}

${blk.queryTable('TABLE time, actor, action, outcome FROM "events/" WHERE action CONTAINS "deploy" SORT time DESC LIMIT 10')}

Browse by day in calendar view or open the timeline for cross-day activity.

> [!NOTE]
> Files with \`append_only: true\` reject overwrites — use append API only.
`,

  "events/2026-06-20.md": `---
title: "Events — 2026-06-20"
type: daily-log
date: 2026-06-20
append_only: true
entry_count: 7
tags: [production, audit]
---

## 2026-06-20T09:14:22Z | system.api.deploy.v1

- **Actor:** service:ci-bot
- **Target:** deployment:payments-api
- **Correlation:** pipeline:run-88421
- **Details:** Deployed \`v2.14.0\` to production-us-east-1. Rolling update 3/3 pods healthy. Smoke tests passed in 42s.

${blk.progress({
  type: "gauge",
  title: "SLA dashboard (today)",
  showPercent: true,
  items: [
    { label: "Uptime", value: 99.97 },
    { label: "Error budget left", value: 88 },
    { label: "P99 latency", value: 92 },
    { label: "Test coverage gate", value: 100 },
    { label: "Open incidents", value: 95 },
  ],
})}

## 2026-06-20T09:31:05Z | webhook.integration.delivered.v1

- **Actor:** service:nats-consumer
- **Target:** webhook:customer-acme
- **Correlation:** event:workspace.page.updated/9f3a
- **Details:** POST \`https://hooks.acme.example/kiwi\` returned 200 in 118ms. Retry count 0.

## 2026-06-20T11:02:18Z | admin.access.grant.v1

- **Actor:** user:admin@corp.example
- **Target:** role:deploy
- **Correlation:** ticket:IT-4421
- **Details:** Granted \`deploy\` role to subject \`svc-payments\` for 24h break-glass window. Approved by manager on-call.

## 2026-06-20T12:47:33Z | content.page.publish.v1

- **Actor:** user:elena@corp.example
- **Target:** page:docs/runbooks/failover.md
- **Correlation:** workspace:prod-docs
- **Details:** Set \`published: true\`; public URL generated. Atom feed updated.

## 2026-06-20T14:45:09Z | admin.config.change.v1

- **Actor:** user:lena@corp.example
- **Target:** config:nginx.conf
- **Correlation:** change:CHG-2026-0612
- **Details:** Increased \`proxy_read_timeout\` 60s → 120s for long-lived SSE connections. Peer review approved by sam@corp.example.

${blk.eventCounterApp}

## 2026-06-20T15:22:41Z | agent.search.query.v1

- **Actor:** agent:kiwi-mcp
- **Target:** index:sqlite-fts
- **Correlation:** session:cursor-8c2f
- **Details:** Semantic + FTS query \`"NATS JetStream outbox"\` returned 4 hits in 38ms. Logged for compliance retention.

## 2026-06-20T17:58:12Z | system.alert.resolve.v1

- **Actor:** user:sre-oncall@corp.example
- **Target:** alert:payments-p99-latency
- **Correlation:** incident:INC-884
- **Details:** Sev2 cleared. Root cause: cold cache after deploy — mitigated by warming job added to pipeline.

${blk.queryTable('TABLE time, actor, action, outcome FROM "events/" WHERE date = "2026-06-20" SORT time ASC')}

${blk.chart({
  type: "line",
  title: "Events per hour — 2026-06-20",
  xKey: "hour",
  grid: true,
  legend: true,
  series: [
    { key: "events", name: "Events", color: "#64748b" },
    { key: "deploys", name: "Deploys", color: "#22c55e" },
  ],
  data: [
    { hour: "06:00", events: 2, deploys: 0 },
    { hour: "09:00", events: 8, deploys: 2 },
    { hour: "12:00", events: 5, deploys: 0 },
    { hour: "15:00", events: 11, deploys: 1 },
    { hour: "18:00", events: 4, deploys: 0 },
    { hour: "21:00", events: 1, deploys: 0 },
  ],
})}

${blk.mermaid(`timeline
  title 2026-06-20 audit highlights
  section Morning
    deploy.api v2.14.0 : 09:14
    webhook delivered : 09:31
  section Midday
    access grant : 11:02
    page published : 12:47
  section Afternoon
    config change : 14:45
    agent search : 15:22
    alert resolved : 17:58`)}
`,

  "events/2026-06-19.md": `---
title: "Events — 2026-06-19"
type: daily-log
date: 2026-06-19
append_only: true
entry_count: 5
tags: [production, alerts]
---

## 2026-06-19T08:05:00Z | system.api.deploy.v1

- **Actor:** service:ci-bot
- **Target:** deployment:search-indexer
- **Correlation:** pipeline:run-88398
- **Details:** Deployed \`v1.8.2\` — SQLite FTS rebuild job optimization. Canary 10% → 100% over 45 min.

## 2026-06-19T10:18:44Z | system.alert.trigger.v1

- **Actor:** service:datadog
- **Target:** alert:payments-p99-latency
- **Correlation:** monitor:payments-api-p99
- **Details:** Sev2 — p99 latency 840ms > 500ms threshold for 5 min. Escalated to sre-oncall.

## 2026-06-19T10:22:11Z | user.session.login.v1

- **Actor:** user:admin@corp.example
- **Target:** session:web-auth
- **Correlation:** ip:203.0.113.42
- **Details:** SSO login via WorkOS AuthKit. MFA satisfied (WebAuthn).

## 2026-06-19T14:03:55Z | admin.access.revoke.v1

- **Actor:** user:admin@corp.example
- **Target:** role:deploy
- **Correlation:** ticket:IT-4418
- **Details:** Revoked stale \`deploy\` grant for \`svc-legacy-etl\` — unused 90 days.

## 2026-06-19T16:30:27Z | webhook.integration.failed.v1

- **Actor:** service:nats-consumer
- **Target:** webhook:customer-beta
- **Correlation:** event:billing.invoice.paid/771c
- **Details:** POST failed 503 after 3 retries. Dead-letter queue \`webhook.dlq\` — manual replay scheduled.

${blk.chart({
  type: "bar",
  title: "Events by domain — 2026-06-19",
  xKey: "domain",
  grid: true,
  series: [{ key: "count", name: "Count", color: "#f97316" }],
  data: [
    { domain: "system", count: 2 },
    { domain: "admin", count: 1 },
    { domain: "user", count: 1 },
    { domain: "webhook", count: 1 },
  ],
})}
`,

  "events/2026-06-18.md": `---
title: "Events — 2026-06-18"
type: daily-log
date: 2026-06-18
append_only: true
entry_count: 4
tags: [compliance, backup]
---

## 2026-06-18T02:00:00Z | system.backup.complete.v1

- **Actor:** service:backup-agent
- **Target:** database:postgres-primary
- **Correlation:** job: nightly-backup-20260618
- **Details:** Full snapshot to S3 \`s3://backups/pg/2026-06-18/\`. Size 842 GB. Restore test skipped (weekly schedule).

## 2026-06-18T09:45:12Z | agent.workflow.advance.v1

- **Actor:** agent:kiwi-mcp
- **Target:** page:decisions/ADR-003-nats-streaming.md
- **Correlation:** workflow:adr
- **Details:** Advanced ADR state \`proposed → accepted\` via MCP tool. Git commit \`a4f91c2\`.

## 2026-06-18T13:20:33Z | content.page.create.v1

- **Actor:** user:maya@corp.example
- **Target:** page:system/code-review-v3.md
- **Correlation:** workspace:prompt-registry
- **Details:** Created prompt v3 from template. Label \`staging\` pending eval run.

## 2026-06-18T18:55:00Z | admin.policy.update.v1

- **Actor:** user:compliance@corp.example
- **Target:** policy:retention-90d
- **Correlation:** audit:Q2-2026
- **Details:** Event logs retention extended 60d → 90d for SOC2 evidence. Applies to \`events/**\` namespace.

${blk.progress({
  type: "bar",
  title: "Weekly compliance checks",
  items: [
    { label: "Backup verified", value: 100, color: "#22c55e" },
    { label: "Access reviews", value: 85, color: "#3b82f6" },
    { label: "DLQ drained", value: 70, color: "#eab308" },
    { label: "Chain integrity", value: 100, color: "#22c55e" },
  ],
})}
`,
};

export const logMock = {
  timelineEvents: [
    { type: "append", path: "events/2026-06-20.md", title: "Events — 2026-06-20", actor: "ci-bot", timestamp: new Date("2026-06-20T09:14:22Z").toISOString(), message: "system.api.deploy.v1 success v2.14.0" },
    { type: "append", path: "events/2026-06-20.md", title: "Events — 2026-06-20", actor: "admin@corp.example", timestamp: new Date("2026-06-20T11:02:18Z").toISOString(), message: "admin.access.grant.v1 deploy role" },
    { type: "append", path: "events/2026-06-20.md", title: "Events — 2026-06-20", actor: "elena@corp.example", timestamp: new Date("2026-06-20T12:47:33Z").toISOString(), message: "content.page.publish.v1 failover runbook" },
    { type: "append", path: "events/2026-06-20.md", title: "Events — 2026-06-20", actor: "lena@corp.example", timestamp: new Date("2026-06-20T14:45:09Z").toISOString(), message: "admin.config.change.v1 nginx timeout" },
    { type: "append", path: "events/2026-06-20.md", title: "Events — 2026-06-20", actor: "sre-oncall@corp.example", timestamp: new Date("2026-06-20T17:58:12Z").toISOString(), message: "system.alert.resolve.v1 INC-884 cleared" },
    { type: "append", path: "events/2026-06-19.md", title: "Events — 2026-06-19", actor: "datadog", timestamp: new Date("2026-06-19T10:18:44Z").toISOString(), message: "system.alert.trigger.v1 sev2 payments p99" },
    { type: "append", path: "events/2026-06-19.md", title: "Events — 2026-06-19", actor: "nats-consumer", timestamp: new Date("2026-06-19T16:30:27Z").toISOString(), message: "webhook.integration.failed.v1 customer-beta" },
    { type: "append", path: "events/2026-06-18.md", title: "Events — 2026-06-18", actor: "backup-agent", timestamp: new Date("2026-06-18T02:00:00Z").toISOString(), message: "system.backup.complete.v1 postgres 842GB" },
    { type: "append", path: "events/2026-06-18.md", title: "Events — 2026-06-18", actor: "kiwi-mcp", timestamp: new Date("2026-06-18T09:45:12Z").toISOString(), message: "agent.workflow.advance.v1 ADR-003 accepted" },
  ],
  queryRows: [
    { _path: "events/2026-06-20.md", time: "09:14", actor: "ci-bot", action: "system.api.deploy", outcome: "success" },
    { _path: "events/2026-06-20.md", time: "11:02", actor: "admin@corp.example", action: "admin.access.grant", outcome: "success" },
    { _path: "events/2026-06-20.md", time: "12:47", actor: "elena@corp.example", action: "content.page.publish", outcome: "success" },
    { _path: "events/2026-06-20.md", time: "14:45", actor: "lena@corp.example", action: "admin.config.change", outcome: "success" },
    { _path: "events/2026-06-20.md", time: "15:22", actor: "kiwi-mcp", action: "agent.search.query", outcome: "success" },
    { _path: "events/2026-06-20.md", time: "17:58", actor: "sre-oncall@corp.example", action: "system.alert.resolve", outcome: "success" },
    { _path: "events/2026-06-19.md", time: "10:18", actor: "datadog", action: "system.alert.trigger", outcome: "warning" },
    { _path: "events/2026-06-19.md", time: "16:30", actor: "nats-consumer", action: "webhook.integration.failed", outcome: "failure" },
    { _path: "events/2026-06-18.md", time: "02:00", actor: "backup-agent", action: "system.backup.complete", outcome: "success" },
  ],
  calendarRows: [
    { _path: "events/2026-06-20.md", date: "2026-06-20", entry_count: 7 },
    { _path: "events/2026-06-19.md", date: "2026-06-19", entry_count: 5 },
    { _path: "events/2026-06-18.md", date: "2026-06-18", entry_count: 4 },
  ],
  searchResults: demoSearch([
    { path: "events/2026-06-20.md", score: 0.94, snippet: "...<mark>deploy</mark> v2.14.0 to production-us-east-1..." },
    { path: "events/2026-06-19.md", score: 0.87, snippet: "...<mark>alert</mark> payments-p99-latency Sev2..." },
    { path: "events/2026-06-18.md", score: 0.79, snippet: "...<mark>backup</mark> postgres-primary 842 GB..." },
  ]),
  backlinks: demoBacklinks([
    { path: "events/2026-06-19.md", count: 1 },
    { path: "events/2026-06-18.md", count: 1 },
  ]),
  comments: demoComments("events/2026-06-20.md", [
    {
      id: "log-c1",
      anchor: { quote: "break-glass", prefix: "24h ", suffix: " window" },
      body: "Confirm break-glass grant auto-expired — add to tomorrow's audit query.",
      author: "compliance",
      createdAt: new Date(Date.now() - 3600000 * 6).toISOString(),
      resolved: false,
    },
  ]),
  metaResults: [
    { path: "events/2026-06-20.md", frontmatter: { title: "Events — 2026-06-20", date: "2026-06-20", entry_count: 7, append_only: true } },
    { path: "events/2026-06-19.md", frontmatter: { title: "Events — 2026-06-19", date: "2026-06-19", entry_count: 5, append_only: true } },
  ],
};
