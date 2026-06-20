import * as blk from "../blocks";
import { demoBacklinks, demoComments, demoSearch } from "./mockExtras";

export const adrPages: Record<string, string> = {
  "index.md": `---
title: Platform decision log
type: index
---

Numbered architecture decision records for the platform team. ADRs follow [MADR](https://adr.github.io/madr/) — accepted decisions are immutable; supersede with a new file and link via \`supersedes\` / \`superseded_by\`.

${blk.progress({
  type: "bar",
  title: "Decision portfolio",
  items: [
    { label: "Accepted", value: 5, color: "#22c55e" },
    { label: "Superseded", value: 1, color: "#64748b" },
    { label: "Proposed", value: 0, color: "#eab308" },
  ],
})}

${blk.queryTable('TABLE adr_number, title, status, domain, date FROM "decisions/" WHERE type = "adr" SORT adr_number ASC')}

${blk.queryTable('TABLE adr_number, title, status FROM "decisions/" WHERE status = "accepted" AND domain = "messaging"')}

${blk.mermaid(`graph TD
  ADR001[ADR-001 Monolith] --> ADR003[ADR-003 NATS]
  ADR002[ADR-002 Kafka] -->|superseded| ADR005[ADR-005 Retire Kafka]
  ADR003 --> ADR002
  ADR005 --> ADR002
  ADR004[ADR-004 PostgreSQL]
  ADR006[ADR-006 SQLite search]`)}

> [!NOTE]
> Open the graph view to explore supersession chains. Agents should query accepted ADRs before proposing infra changes.
`,

  "decisions/ADR-001-monolith.md": `---
title: "ADR-001: Start as modular monolith"
type: adr
adr_number: 1
status: accepted
state: accepted
workflow: adr
date: 2024-03-12
deciders: [platform, eng-leads]
domain: architecture
decision: Deploy one deployable with clear module boundaries before splitting services
decision-drivers: [team-size, time-to-market, operational-simplicity]
tags: [architecture, monolith, startup]
review-by: 2026-03-12
---

## Context and Problem Statement

We are a team of twelve engineers shipping a B2B workflow product. Microservices would multiply deployment surfaces, observability cost, and on-call load before we have product–market fit. We still need **clear boundaries** so we can extract services later without a rewrite.

## Decision Drivers

- Small team — no dedicated platform SRE yet
- Need weekly releases with one CI pipeline
- Domain modules (auth, billing, workspace) should not share database tables casually
- Future option to split hot paths (events, search) without changing contracts

## Considered Options

1. **Classic monolith** — single package, shared models everywhere
2. **Modular monolith** — one binary, internal packages + module APIs
3. **Microservices from day one** — separate repos per domain

## Decision Outcome

Chosen option: **modular monolith**, because it preserves velocity while enforcing boundaries via package structure and internal RPC-style interfaces.

${blk.tabs([
  {
    label: "Modular monolith",
    body: `**Pros:** One deploy, shared auth/session, easy local dev, module seams for later extraction.

**Cons:** Requires discipline — reviewers must block cross-module DB joins.

**Implementation:** \`cmd/server\`, \`internal/auth\`, \`internal/billing\`, \`internal/workspace\` — no imports from sibling \`internal/*\` except through interfaces in \`internal/contracts\`.`,
  },
  {
    label: "Microservices",
    body: `Rejected for now — network partitions, distributed tracing, and contract versioning would consume >30% of eng capacity.`,
  },
  {
    label: "Classic monolith",
    body: `Rejected — past experience showed uncontrolled coupling within 6 months.`,
  },
])}

## Consequences

**Positive:** Fast iteration; single artifact in staging/prod; onboarding is clone-and-run.

**Negative:** Hot modules (event fan-out) may contend for CPU — revisit when p99 latency exceeds SLO for two consecutive sprints.

**Neutral:** Eventing decisions deferred to [[decisions/ADR-003-nats-streaming|ADR-003]]; persistence to [[decisions/ADR-004-postgres-primary|ADR-004]].

Related: [[decisions/ADR-003-nats-streaming]], [[decisions/ADR-004-postgres-primary]].
`,

  "decisions/ADR-002-kafka-events.md": `---
title: "ADR-002: Kafka for domain events"
type: adr
adr_number: 2
status: superseded
state: superseded
workflow: adr
date: 2024-06-18
deciders: [platform]
domain: messaging
decision: Use Apache Kafka as the primary domain event bus
decision-drivers: [ecosystem, replay, ordering]
tags: [kafka, events, deprecated]
superseded_by: decisions/ADR-005-retire-kafka.md
---

## Context and Problem Statement

Cross-module notifications outgrew in-process pub/sub. We needed durable, ordered streams with replay for billing reconciliation and audit projections.

## Decision Drivers

- At-least-once delivery with consumer groups
- Long retention for finance backfills
- Mature client libraries in Go

## Considered Options

1. **Kafka** (Confluent Cloud)
2. **RabbitMQ** with quorum queues
3. **PostgreSQL NOTIFY** + outbox table

## Decision Outcome

We adopted **Kafka** with topic-per-domain naming (\`workspace.events\`, \`billing.events\`).

## Consequences

**Positive:** Replay worked well for month-end billing jobs.

**Negative:** Three-person on-call rotation spent ~40% of infra tickets on broker tuning, ACLs, and consumer lag alerts. Cost ~$2.8k/mo at our volume.

**Supersession:** Formal retirement in [[decisions/ADR-005-retire-kafka|ADR-005]]. Streaming path migrated per [[decisions/ADR-003-nats-streaming|ADR-003]].

${blk.queryTable('TABLE adr_number, title, status FROM "decisions/" WHERE domain = "messaging" SORT adr_number ASC')}
`,

  "decisions/ADR-003-nats-streaming.md": `---
title: "ADR-003: Use NATS JetStream for event streaming"
type: adr
adr_number: 3
status: accepted
state: accepted
workflow: adr
date: 2025-09-04
deciders: [platform, backend, sre]
domain: messaging
decision: Replace synchronous REST fan-out with NATS JetStream subjects and pull consumers
decision-drivers: [latency, ops-burden, cost, cloud-native]
tags: [nats, jetstream, events, accepted]
supersedes: decisions/ADR-002-kafka-events.md
review-by: 2026-09-04
---

## Context and Problem Statement

After [[decisions/ADR-001-monolith|ADR-001]], modules communicated via direct HTTP callbacks. Under load, webhook retries caused thundering herds and duplicated side effects. [[decisions/ADR-002-kafka-events|ADR-002]] solved durability but operational cost exceeded value at our ~12k msgs/min peak.

We need **durable streaming** with lower ops surface than a Kafka cluster.

## Decision Drivers

- Sub-50 ms p99 publish latency inside VPC
- Single-node dev parity (embedded NATS in docker-compose)
- Consumer horizontal scale without partition math
- Total cost of ownership < $800/mo at current volume
- Go-first SDK and observability hooks

## Considered Options

| Option | Summary |
|--------|---------|
| **Keep Kafka** | Proven; heavy ops |
| **NATS JetStream** | Lightweight broker, KV + streams |
| **Redis Streams** | Already in cache layer; persistence concerns |
| **Postgres outbox only** | Simple; polling latency |

${blk.chart({
  type: "radar",
  title: "Messaging option comparison (ADR-003)",
  xKey: "dimension",
  legend: true,
  series: [
    { key: "kafka", name: "Kafka", color: "#ef4444" },
    { key: "nats", name: "NATS JetStream", color: "#22c55e" },
    { key: "redis", name: "Redis Streams", color: "#eab308" },
  ],
  data: [
    { dimension: "Latency", kafka: 72, nats: 92, redis: 88 },
    { dimension: "Reliability", kafka: 95, nats: 88, redis: 70 },
    { dimension: "Cost", kafka: 45, nats: 85, redis: 90 },
    { dimension: "Ops burden", kafka: 40, nats: 82, redis: 75 },
    { dimension: "Developer UX", kafka: 65, nats: 90, redis: 78 },
    { dimension: "Replay", kafka: 98, nats: 85, redis: 60 },
  ],
})}

${blk.tabs([
  {
    label: "Option A — Kafka",
    body: `**Pros:** Best-in-class replay, huge ecosystem, exactly-once semantics with transactions.

**Cons:** $2.8k/mo Confluent bill; 3 dedicated runbooks; overkill for our throughput.

**Verdict:** Keep for legacy consumers until [[decisions/ADR-005-retire-kafka|ADR-005]] completes.`,
  },
  {
    label: "Option B — NATS JetStream",
    body: `**Pros:** Single binary, clustering optional, subject wildcards (\`workspace.>\`), pull consumers with ack wait, ~$420/mo managed.

**Cons:** Smaller hiring pool than Kafka; fewer third-party connectors.

**Verdict:** **Selected** — matches team size and SLOs.`,
  },
  {
    label: "Option C — Redis Streams",
    body: `**Pros:** Reuse existing Redis; very fast.

**Cons:** Memory-bound retention; AOF fsync tradeoffs worried SRE for audit events.

**Verdict:** Rejected for domain events; OK for ephemeral cache invalidation.`,
  },
])}

${blk.columns("2:1", [
  `### Decision Outcome

We standardize on **NATS JetStream** with:

- Subject taxonomy: \`<domain>.<entity>.<verb>\` (e.g. \`workspace.page.updated\`)
- Stream per domain, 7-day retention (30-day for \`billing.*\`)
- Idempotent consumers keyed by \`event_id\` UUID
- Outbox table in [[decisions/ADR-004-postgres-primary|PostgreSQL]] for transactional publish

Migration: dual-write from Kafka for 6 weeks; cutover tracked in [[decisions/ADR-005-retire-kafka|ADR-005]].`,
  `### Metrics at decision time

| Metric | Kafka | NATS (pilot) |
|--------|-------|--------------|
| p99 publish | 84 ms | 31 ms |
| Monthly cost | $2,840 | $418 |
| On-call pages/qtr | 11 | 2 |

**Deciders:** platform, backend, sre`,
])}

## Consequences

**Positive:** 63% infra cost reduction; local dev uses \`nats-server -js\`; consumers scale with K8s HPA on lag.

**Negative:** Team training sprint required; some Kafka Connect jobs rewritten as NATS consumers.

**Neutral:** Search indexing still uses [[decisions/ADR-006-sqlite-search|SQLite FTS]] — not event-driven full-text.

Supersedes aspects of [[decisions/ADR-002-kafka-events|ADR-002]].

${blk.mermaid(`sequenceDiagram
  participant API as API module
  participant PG as PostgreSQL
  participant NATS as JetStream
  participant IDX as Indexer
  API->>PG: COMMIT + outbox row
  API->>NATS: Publish workspace.page.updated
  NATS-->>IDX: Pull consumer
  IDX->>PG: Mark outbox sent`)}

${blk.queryTable('TABLE adr_number, title, status, deciders FROM "decisions/" WHERE type = "adr" SORT adr_number ASC')}

> [!TIP] Agent query
> Before adding a new topic, run \`TABLE title, supersedes FROM "decisions/" WHERE domain = "messaging"\`.
`,

  "decisions/ADR-004-postgres-primary.md": `---
title: "ADR-004: PostgreSQL as system of record"
type: adr
adr_number: 4
status: accepted
state: accepted
workflow: adr
date: 2024-08-22
deciders: [platform, data]
domain: storage
decision: Single PostgreSQL 16 cluster (RDS) for transactional state; no polyglot OLTP in year one
decision-drivers: [acid, tooling, hiring]
tags: [postgres, database, storage]
review-by: 2025-08-22
---

## Context and Problem Statement

The modular monolith ([[decisions/ADR-001-monolith|ADR-001]]) needs one authoritative store for users, workspaces, billing, and permissions. Document blobs live in object storage; metadata and ACLs stay relational.

## Decision Drivers

- ACID transactions across modules via schema namespaces
- Mature migration tooling (golang-migrate)
- JSONB for semi-structured event outbox rows
- Read replicas for analytics without touching OLTP

## Considered Options

1. **PostgreSQL** on RDS
2. **CockroachDB** for global distribution (premature)
3. **MongoDB** for flexible documents (weak cross-module joins)

## Decision Outcome

**PostgreSQL 16** with schemas: \`auth\`, \`workspace\`, \`billing\`. Connection pooling via PgBouncer. Outbox pattern feeds [[decisions/ADR-003-nats-streaming|NATS]].

${blk.chart({
  type: "bar",
  title: "Storage workload split",
  xKey: "store",
  grid: true,
  series: [{ key: "percent", name: "% of rows", color: "#3b82f6" }],
  data: [
    { store: "PostgreSQL OLTP", percent: 78 },
    { store: "S3 objects", percent: 18 },
    { store: "SQLite FTS", percent: 4 },
  ],
})}

## Consequences

**Positive:** One backup strategy; EXPLAIN-friendly; foreign keys enforce invariants.

**Negative:** Vertical scaling ceiling ~32 vCPU before sharding discussion — acceptable for 18-month roadmap.

**Neutral:** Full-text search delegated to [[decisions/ADR-006-sqlite-search|ADR-006]], not \`tsvector\` in primary DB.
`,

  "decisions/ADR-005-retire-kafka.md": `---
title: "ADR-005: Retire Kafka cluster after NATS migration"
type: adr
adr_number: 5
status: accepted
state: accepted
workflow: adr
date: 2025-11-15
deciders: [platform, finance]
domain: messaging
decision: Decommission Confluent Cloud cluster once all consumers migrate to NATS
decision-drivers: [cost, simplification]
tags: [kafka, nats, migration]
supersedes: decisions/ADR-002-kafka-events.md
---

## Context and Problem Statement

[[decisions/ADR-003-nats-streaming|ADR-003]] pilot succeeded. Dual-write ended 2025-11-01. Two legacy consumers (finance export, SIEM tap) remain on Kafka.

## Decision Drivers

- Eliminate $2,840/mo line item
- Reduce CVE surface and credential rotation
- Single streaming runbook for on-call

## Decision Outcome

**Retire Kafka** by 2025-12-31:

1. Migrate finance export to NATS consumer with S3 sink
2. Replace SIEM tap with log shipper from NATS
3. Archive topics to S3 Glacier for 7-year retention
4. Update [[decisions/ADR-002-kafka-events|ADR-002]] status to \`superseded\`

${blk.progress({
  type: "gauge",
  title: "Migration checklist",
  items: [
    { label: "Consumers moved", value: 92 },
    { label: "Topics archived", value: 100 },
    { label: "Runbooks updated", value: 85 },
    { label: "Cost savings realized", value: 78 },
  ],
})}

## Consequences

**Positive:** ~$34k/year savings; one messaging system in diagrams.

**Negative:** Historical replay from Glacier requires restore job (documented).

Formal supersession of [[decisions/ADR-002-kafka-events|ADR-002]].
`,

  "decisions/ADR-006-sqlite-search.md": `---
title: "ADR-006: SQLite FTS for workspace search index"
type: adr
adr_number: 6
status: accepted
state: accepted
workflow: adr
date: 2026-01-09
deciders: [platform, search]
domain: search
decision: Per-workspace SQLite FTS5 sidecar indexes instead of Elasticsearch cluster
decision-drivers: [simplicity, isolation, cost]
tags: [sqlite, search, fts]
review-by: 2027-01-09
---

## Context and Problem Statement

Users expect sub-200 ms full-text search across markdown pages. Indexing ~500 pages/workspace does not justify a shared Elasticsearch cluster ($1.2k/mo) or loading [[decisions/ADR-004-postgres-primary|PostgreSQL]] with \`tsvector\` maintenance.

## Decision Drivers

- Index travels with workspace export (git + sqlite file)
- Zero network hop on read path when co-located with KiwiFS
- BM25 ranking via FTS5; semantic layer optional later
- Rebuild index from git history in < 60 s for median workspace

## Considered Options

${blk.tabs([
  {
    label: "SQLite FTS5",
    body: `**Pros:** Embedded, portable, WAL mode, triggers from indexer on [[decisions/ADR-003-nats-streaming|NATS]] events.

**Cons:** Not distributed — one file per workspace; large workspaces (>50k pages) need sharding review.`,
  },
  {
    label: "Elasticsearch",
    body: `Rejected — ops cost, noisy neighbors, overkill for median 400-page workspace.`,
  },
  {
    label: "Postgres tsvector",
    body: `Rejected — bloat on shared OLTP; vacuum pressure during bulk imports.`,
  },
])}

## Decision Outcome

**SQLite FTS5** sidecar at \`.kiwi/search/index.db\` per workspace. Indexer consumes \`workspace.page.*\` from NATS.

${blk.colorPalette({
  name: "Search UI accents",
  showContrast: true,
  colors: [
    { hex: "#84cc16", label: "Match highlight" },
    { hex: "#1e293b", label: "Snippet bg" },
    { hex: "#64748b", label: "Score muted" },
    { hex: "#22c55e", label: "Verified hit" },
  ],
})}

## Consequences

**Positive:** Search works offline in local KiwiFS; no shared cluster blast radius.

**Negative:** Cross-workspace search requires federated query in cloud layer — acceptable product split.

Related stack: [[decisions/ADR-001-monolith]], [[decisions/ADR-003-nats-streaming]], [[decisions/ADR-004-postgres-primary]].
`,
};

export const adrMock = {
  graphNodes: [
    { path: "decisions/ADR-001-monolith.md", tags: ["adr", "architecture"] },
    { path: "decisions/ADR-002-kafka-events.md", tags: ["adr", "superseded", "messaging"] },
    { path: "decisions/ADR-003-nats-streaming.md", tags: ["adr", "accepted", "messaging"] },
    { path: "decisions/ADR-004-postgres-primary.md", tags: ["adr", "accepted", "storage"] },
    { path: "decisions/ADR-005-retire-kafka.md", tags: ["adr", "accepted", "migration"] },
    { path: "decisions/ADR-006-sqlite-search.md", tags: ["adr", "accepted", "search"] },
    { path: "index.md", tags: ["index"] },
  ],
  graphEdges: [
    { source: "decisions/ADR-001-monolith.md", target: "decisions/ADR-003-nats-streaming.md" },
    { source: "decisions/ADR-001-monolith.md", target: "decisions/ADR-004-postgres-primary.md" },
    { source: "decisions/ADR-003-nats-streaming.md", target: "decisions/ADR-002-kafka-events.md" },
    { source: "decisions/ADR-003-nats-streaming.md", target: "decisions/ADR-004-postgres-primary.md" },
    { source: "decisions/ADR-003-nats-streaming.md", target: "decisions/ADR-005-retire-kafka.md" },
    { source: "decisions/ADR-005-retire-kafka.md", target: "decisions/ADR-002-kafka-events.md" },
    { source: "decisions/ADR-006-sqlite-search.md", target: "decisions/ADR-003-nats-streaming.md" },
    { source: "decisions/ADR-006-sqlite-search.md", target: "decisions/ADR-004-postgres-primary.md" },
    { source: "index.md", target: "decisions/ADR-003-nats-streaming.md" },
  ],
  searchResults: demoSearch([
    { path: "decisions/ADR-003-nats-streaming.md", score: 0.97, snippet: "...<mark>NATS JetStream</mark> subjects and pull consumers..." },
    { path: "decisions/ADR-002-kafka-events.md", score: 0.88, snippet: "...<mark>Kafka</mark> with topic-per-domain naming..." },
    { path: "decisions/ADR-006-sqlite-search.md", score: 0.82, snippet: "...<mark>SQLite FTS5</mark> sidecar at .kiwi/search..." },
    { path: "decisions/ADR-001-monolith.md", score: 0.76, snippet: "...<mark>modular monolith</mark>, because it preserves velocity..." },
  ]),
  backlinks: demoBacklinks([
    { path: "decisions/ADR-002-kafka-events.md", count: 3 },
    { path: "decisions/ADR-003-nats-streaming.md", count: 5 },
    { path: "decisions/ADR-004-postgres-primary.md", count: 4 },
    { path: "decisions/ADR-001-monolith.md", count: 2 },
  ]),
  comments: demoComments("decisions/ADR-003-nats-streaming.md", [
    {
      id: "adr-c1",
      anchor: { quote: "Redis Streams", prefix: "Option C — ", suffix: "" },
      body: "Should we document when Redis Streams *is* appropriate (cache invalidation)?",
      author: "lena",
      createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
      resolved: false,
    },
    {
      id: "adr-c2",
      anchor: { quote: "7-day retention", prefix: "Stream per domain, ", suffix: " (30-day" },
      body: "Compliance wants 90-day for audit — filed follow-up ticket.",
      author: "compliance-bot",
      createdAt: new Date(Date.now() - 86400000 * 12).toISOString(),
      resolved: true,
    },
  ]),
  queryRows: [
    { _path: "decisions/ADR-001-monolith.md", adr_number: 1, title: "Start as modular monolith", status: "accepted", domain: "architecture", date: "2024-03-12", deciders: "platform, eng-leads" },
    { _path: "decisions/ADR-002-kafka-events.md", adr_number: 2, title: "Kafka for domain events", status: "superseded", domain: "messaging", date: "2024-06-18", deciders: "platform" },
    { _path: "decisions/ADR-003-nats-streaming.md", adr_number: 3, title: "Use NATS JetStream for event streaming", status: "accepted", domain: "messaging", date: "2025-09-04", deciders: "platform, backend, sre" },
    { _path: "decisions/ADR-004-postgres-primary.md", adr_number: 4, title: "PostgreSQL as system of record", status: "accepted", domain: "storage", date: "2024-08-22", deciders: "platform, data" },
    { _path: "decisions/ADR-005-retire-kafka.md", adr_number: 5, title: "Retire Kafka cluster after NATS migration", status: "accepted", domain: "messaging", date: "2025-11-15", deciders: "platform, finance" },
    { _path: "decisions/ADR-006-sqlite-search.md", adr_number: 6, title: "SQLite FTS for workspace search index", status: "accepted", domain: "search", date: "2026-01-09", deciders: "platform, search" },
  ],
  metaResults: [
    { path: "decisions/ADR-003-nats-streaming.md", frontmatter: { title: "ADR-003: Use NATS JetStream for event streaming", status: "accepted", domain: "messaging", adr_number: 3 } },
    { path: "decisions/ADR-002-kafka-events.md", frontmatter: { title: "ADR-002: Kafka for domain events", status: "superseded", domain: "messaging", adr_number: 2 } },
  ],
};
