import * as blk from "../blocks";
import { daysAgo } from "../helpers";
import { demoBacklinks, demoComments, demoSearch } from "./mockExtras";

export const runbookPages: Record<string, string> = {
  "procedures/deploy.md": `---
title: Deploy to production
type: procedure
owner: platform
status: active
last_reviewed: 2026-06-01
last_tested: 2026-05-28
estimated_time: "25-40 minutes"
tags: [deploy, ci-cd, production]
---

Standard production deploy for \`platform-api\`, \`platform-web\`, and \`worker\`. Assumes \`main\` is green and change ticket **CHG-4821** (or successor) is approved.

## Pre-flight checklist

- [x] CI green on \`main\` (build + integration + smoke)
- [x] Change ticket linked in deploy PR
- [x] Database migrations reviewed — backward-compatible or expand-only
- [x] Feature flags default-safe for this release
- [ ] On-call notified in \`#platform-oncall\`
- [ ] Status page draft prepared (degraded performance template)

${blk.mermaid(`flowchart TD
  A[Start deploy] --> B{CI green?}
  B -->|No| Z[Stop — fix main]
  B -->|Yes| C[Run migrations]
  C --> D{Migration OK?}
  D -->|No| R[Rollback migration]
  D -->|Yes| E[Canary 10%]
  E --> F{Error rate OK 15m?}
  F -->|No| G[Rollback deploy]
  F -->|Yes| H[Rollout 100%]
  H --> I[Monitor 30m]
  I --> J{SLI breach?}
  J -->|Yes| G
  J -->|No| K[Done]
  G --> L[[procedures/incident-triage]]
  R --> Z`)}

${blk.tabs([
  {
    label: "Kubernetes",
    body: `\`\`\`bash
# 1. Confirm current revision
kubectl rollout history deployment/platform-api -n prod

# 2. Apply manifest (Kustomize prod overlay)
kubectl apply -k infra/k8s/overlays/prod

# 3. Canary via Argo Rollouts
kubectl argo rollouts promote platform-api -n prod --canary

# 4. Watch
kubectl argo rollouts status platform-api -n prod
kubectl logs -f deploy/platform-api -n prod --tail=50
\`\`\`

Rollback: \`kubectl argo rollouts undo platform-api -n prod\``,
  },
  {
    label: "Docker Compose",
    body: `\`\`\`bash
# Staging-only path — prod is k8s
cd /opt/platform
git fetch && git checkout v2.14.0
docker compose pull api web worker
docker compose up -d --no-deps api
docker compose exec api curl -sf localhost:8080/health
\`\`\`

Use for **staging validation** before k8s promote — not primary prod path.`,
  },
  {
    label: "Bare metal",
    body: `\`\`\`bash
# Legacy billing nodes only (retiring Q4)
ssh deploy@billing-01.internal
sudo systemctl stop platform-api
sudo -u deploy git -C /srv/platform pull --ff-only origin v2.14.0
sudo -u deploy pnpm --filter @acme/api build
sudo systemctl start platform-api
curl -sf http://127.0.0.1:8080/health
\`\`\`

Coordinate with **#billing-ops** — maintenance window required.`,
  },
])}

## Edge config change (this release)

Increase \`proxy_read_timeout\` for long-running export endpoints:

${blk.diff({
  language: "nginx",
  title: "nginx.conf — platform-api upstream",
  before: `location /api/v1/exports/ {
    proxy_pass http://platform_api;
    proxy_read_timeout 60s;
    proxy_connect_timeout 5s;
}`,
  after: `location /api/v1/exports/ {
    proxy_pass http://platform_api;
    proxy_read_timeout 300s;
    proxy_connect_timeout 5s;
    proxy_send_timeout 300s;
}`,
})}

Apply via \`ansible-playbook playbooks/nginx.yml -l edge\` **before** canary if release includes export changes.

${blk.progress({
  type: "bar",
  title: "Deploy phase status",
  items: [
    { label: "Pre-flight", value: 100, color: "#22c55e" },
    { label: "Canary", value: 100, color: "#22c55e" },
    { label: "Full rollout", value: 85, color: "#84cc16" },
    { label: "Rollback ready", value: 100, color: "#64748b" },
  ],
})}

${blk.chart({
  type: "line",
  title: "MTTR — deploy-related incidents (minutes, trailing 6 months)",
  xKey: "month",
  grid: true,
  legend: true,
  series: [
    { key: "mttr", name: "Mean time to recover", color: "#ef4444" },
    { key: "target", name: "SLO target (30m)", color: "#64748b" },
  ],
  data: [
    { month: "Jan", mttr: 42, target: 30 },
    { month: "Feb", mttr: 38, target: 30 },
    { month: "Mar", mttr: 55, target: 30 },
    { month: "Apr", mttr: 28, target: 30 },
    { month: "May", mttr: 22, target: 30 },
    { month: "Jun", mttr: 18, target: 30 },
  ],
})}

## Post-deploy verification

\`\`\`bash
curl -sf https://api.acme.io/health
curl -sf https://api.acme.io/ready | jq '.checks.postgres,.checks.redis'
# Error budget: 5xx rate < 0.1% for 30m — Grafana dashboard "Platform / Deploy"
\`\`\`

Escalation: [[procedures/incident-triage]] · Rollback details: [[procedures/scale#emergency-scale-down]] (capacity) · Past incident: [[incidents/2026-06-12-api-latency]]
`,

  "procedures/scale.md": `---
title: Scale workers and API replicas
type: procedure
owner: platform
status: active
tags: [scaling, hpa, capacity]
estimated_time: "10-20 minutes"
---

Horizontal scaling for stateless tiers. **Does not** replace fixing root causes — use after triage confirms capacity-bound.

## When to scale up

- CPU sustained > 70% on \`platform-api\` for 15m
- Queue depth on \`worker\` > 10k for 5m
- Planned traffic event (marketing launch, Black Friday)

## HPA (preferred)

\`\`\`bash
# Check current replicas
kubectl get hpa -n prod

# Temporary override (reverts on next sync unless patched)
kubectl patch hpa platform-api -n prod -p '{"spec":{"maxReplicas":24}}'
kubectl scale deployment/platform-api -n prod --replicas=16

# Worker queue consumers
kubectl scale deployment/worker -n prod --replicas=12
\`\`\`

## RDS / connection pool

Scaling pods **without** pool headroom causes [[incidents/2026-06-12-api-latency|connection exhaustion]].

| Pool setting | Current | Max safe at 16 pods |
|--------------|---------|---------------------|
| \`max_connections\` (RDS) | 500 | — |
| App \`pool.max\` per pod | 20 | 16 × 20 = 320 ✓ |

If approaching limit: raise RDS \`max_connections\` via parameter group **or** reduce per-pod pool — never both blindly.

## Emergency scale-down {#emergency-scale-down}

During bad deploy — scale to last known good revision first ([[procedures/deploy]]), then reduce load:

\`\`\`bash
kubectl argo rollouts undo platform-api -n prod
kubectl scale deployment/platform-api -n prod --replicas=8
\`\`\`

## Scale-down (cost recovery)

- Wait 24h after incident resolved
- Reduce by 25% per hour while p95 latency stable
`,

  "procedures/rotate-secrets.md": `---
title: Rotate API and database secrets
type: procedure
owner: security
status: active
tags: [secrets, rotation, compliance]
estimated_time: "45-60 minutes"
cadence: quarterly
---

Quarterly rotation for \`API_SIGNING_KEY\`, \`DATABASE_URL\` credentials, and \`REDIS_AUTH\`. Maintenance window **not** required if dual-key overlap is configured.

## Prerequisites

- [ ] Vault admin access (\`vault write\` on \`secret/platform/prod/*\`)
- [ ] kubectl \`edit secret\` on \`prod\` namespace
- [ ] On-call standing by — [[procedures/incident-triage]]

## Rotation sequence

### 1. API signing key (zero-downtime)

\`\`\`bash
# Generate new key in Vault
vault kv put secret/platform/prod/api-signing secondary="$(openssl rand -hex 32)"

# Deploy app config accepting BOTH keys (verify JWT with either)
# Wait 15m — all new tokens use primary
vault kv patch secret/platform/prod/api-signing primary="@secondary"
vault kv delete secret/platform/prod/api-signing secondary
\`\`\`

### 2. Database password

\`\`\`bash
# RDS: create secondary user, migrate apps, drop old
aws rds modify-db-instance --db-instance-identifier platform-prod \\
  --master-user-password "$(vault read -field=password secret/platform/prod/db/new)"

# Rolling restart to pick up K8s secret
kubectl rollout restart deployment/platform-api deployment/worker -n prod
kubectl rollout status deployment/platform-api -n prod
\`\`\`

### 3. Redis AUTH

Rotate via ElastiCache user group — see internal wiki \`redis-auth-rotation\`. Correlated incident: [[incidents/2026-06-18-cert-expiry]] (TLS cert, not AUTH — but same comms template).

## Verification

\`\`\`bash
curl -sf https://api.acme.io/health
redis-cli -u "$REDIS_URL" PING
psql "$DATABASE_URL" -c 'SELECT 1'
\`\`\`

Log completion in \`#security-audit\` with ticket **SEC-ROT-YYYY-QN**.
`,

  "procedures/incident-triage.md": `---
title: Incident triage
type: procedure
owner: platform
status: active
tags: [incident, oncall, sev]
estimated_time: "ongoing"
---

First 15 minutes — stabilize, communicate, gather evidence. Full postmortem template in \`incidents/\`.

## Severity matrix

| Sev | Criteria | Response |
|-----|----------|----------|
| SEV1 | Complete outage or data loss risk | Page IM + exec bridge |
| SEV2 | Major degradation, no workaround | Page on-call + team lead |
| SEV3 | Partial impact, workaround exists | Slack \`#platform-oncall\` |
| SEV4 | Minor, next business day | Ticket only |

## First 15 minutes

${blk.mermaid(`sequenceDiagram
  participant Alert
  participant Oncall
  participant Slack
  participant Status
  Alert->>Oncall: Page fires
  Oncall->>Slack: Declare sev + thread
  Oncall->>Oncall: Check deploys, flags, dashboards
  alt Customer impact
    Oncall->>Status: Degraded / outage
  end
  Oncall->>Slack: Mitigation or escalate
`)}

## Diagnostic checklist

\`\`\`bash
# Recent deploys
kubectl rollout history deployment/platform-api -n prod | tail -5

# Error rate (Prometheus)
curl -sG 'http://prometheus:9090/api/v1/query' \\
  --data-urlencode 'query=sum(rate(http_requests_total{status=~"5.."}[5m]))'

# Pod restarts
kubectl get pods -n prod -o wide | grep -v Running

# RDS connections
aws cloudwatch get-metric-statistics --namespace AWS/RDS \\
  --metric-name DatabaseConnections --dimensions Name=DBInstanceIdentifier,Value=platform-prod \\
  --start-time $(date -u -v-1H +%Y-%m-%dT%H:%M:%S) --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \\
  --period 300 --statistics Maximum
\`\`\`

## Common playbooks

| Symptom | Likely cause | Procedure |
|---------|--------------|-----------|
| 5xx spike post-deploy | Bad release | [[procedures/deploy]] rollback |
| Latency + pool errors | DB connections | [[procedures/scale]], [[incidents/2026-06-12-api-latency]] |
| TLS errors on edge | Cert expiry | [[incidents/2026-06-18-cert-expiry]] |
| Auth failures spike | Secret rotation | [[procedures/rotate-secrets]] |

## Communication template

\`\`\`
[SEV2] platform-api elevated latency — investigating
Impact: ~15% of API requests slow or timing out
Lead: @oncall · Thread: #inc-YYYY-MM-DD-slug
Next update: 15 min
\`\`\`
`,

  "incidents/2026-06-12-api-latency.md": `---
title: "Incident: API latency spike"
date: 2026-06-12
severity: sev2
status: resolved
on_call: lena
detection_minutes: 8
mitigation_minutes: 22
resolution_minutes: 47
users_affected: "~12% of API requests (US-East)"
error_budget_impact: "4.2% of monthly availability budget"
tags: [platform-api, postgres, connection-pool]
postmortem: complete
related_procedure: procedures/scale
---

# Postmortem: API latency spike (2026-06-12)

## Summary

Elevated p95 latency (800ms → 4.2s) and intermittent 503s on \`platform-api\` caused by **PostgreSQL connection pool exhaustion** after HPA scaled pods from 8 → 20 without adjusting per-pod \`pool.max\` or RDS limits.

## Impact

- **Affected:** \`platform-api\` REST endpoints; web dashboard slow loads
- **Blast radius:** US-East primary; EU unaffected (separate cluster)
- **Duration:** 47 minutes (14:02–14:49 UTC)
- **Revenue:** ~$18k estimated checkout abandonment (finance follow-up **FIN-991**)

## Timeline (UTC)

| Time | Event |
|------|-------|
| 13:54 | Marketing email blast drives traffic +40% |
| 14:02 | HPA scales \`platform-api\` 8 → 20 pods |
| 14:06 | \`DatabaseConnections\` CloudWatch alarm → PagerDuty |
| 14:08 | Lena acknowledges; sev2 declared in \`#inc-2026-06-12-api\` |
| 14:14 | Status page: degraded performance |
| 14:18 | Root cause identified — total pool demand 20×25=500 > RDS max 500, contention |
| 14:24 | **Mitigation:** scale pods to 12, reduce \`pool.max\` 25 → 15 via ConfigMap |
| 14:35 | p95 back under 400ms |
| 14:49 | Resolved; status page green |
| 15:30 | Post-incident: HPA maxReplicas capped pending pool math runbook |

## Root cause

1. HPA added pods linearly with CPU
2. Each pod opened up to 25 connections (\`packages/db\` default)
3. RDS \`max_connections=500\` — at 20 pods, pool starvation + wait timeouts
4. Runbook [[procedures/scale]] lacked explicit pool arithmetic check

## What went well

- Fast detection (8 min) via existing RDS connection alarm
- Rollback of pod count stopped bleeding before code deploy needed
- Clear thread in Slack with timeline updates every 10 min

## What went poorly

- HPA max raised in prior week without platform review
- No pre-flight check linking pod count × pool.max to RDS limit
- Staging load test used 8 pods only — did not catch

## Action items

| ID | Owner | Action | Status |
|----|-------|--------|--------|
| PLAT-441 | platform | Add pool calculator to [[procedures/scale]] | Done |
| PLAT-442 | platform | Cap HPA maxReplicas=16 until RDS upgrade | Done |
| PLAT-443 | sre | Load test at 2× expected pods in staging | In progress |
| PLAT-444 | docs | Link this PM from deploy runbook | Done |

## Lessons

- **Capacity is multi-dimensional** — CPU headroom ≠ connection headroom
- Update [[procedures/deploy]] canary step to watch \`DatabaseConnections\` not just 5xx rate

Related: [[procedures/scale]], [[procedures/incident-triage]]
`,

  "incidents/2026-06-18-cert-expiry.md": `---
title: "Incident: Edge TLS certificate expiry"
date: 2026-06-18
severity: sev3
status: resolved
on_call: marco
detection_minutes: 3
mitigation_minutes: 11
resolution_minutes: 19
users_affected: "Browser clients hitting expired cert on cdn.acme.io"
error_budget_impact: "0.3% availability budget"
tags: [tls, cert-manager, edge]
postmortem: complete
---

# Postmortem: Edge TLS certificate expiry (2026-06-18)

## Summary

Let's Encrypt certificate for \`cdn.acme.io\` expired at 06:00 UTC after cert-manager **ClusterIssuer** referenced wrong DNS-01 solver credentials (rotated in Vault 2026-06-10, cert-manager not restarted).

## Impact

- **Symptom:** \`NET::ERR_CERT_DATE_INVALID\` for static assets on CDN
- **API:** Unaffected (separate cert on \`api.acme.io\`)
- **Duration:** 19 minutes (06:00–06:19 UTC)
- **Sev3:** workaround existed (assets also on S3 direct link for internal tools)

## Timeline (UTC)

| Time | Event |
|------|-------|
| 06:00 | Cert expires; external synthetics fail |
| 06:03 | PagerDuty — cert expiry synthetic (3 min detection) |
| 06:05 | Marco declares sev3; verifies cert-manager logs |
| 06:08 | \`CertificateReady=False\` — ACME DNS challenge 403 |
| 06:11 | **Mitigation:** manual \`kubectl cert-manager renew cdn-tls\` after fixing Vault ref |
| 06:16 | New cert issued, nginx reload |
| 06:19 | Synthetics green |

## Root cause

Vault path \`secret/dns/cloudflare\` rotated API token; cert-manager \`ClusterIssuer\` still mounted old K8s secret synced pre-rotation. Renewal failed silently for 7 days (renewBefore: 720h should have caught — alert was misconfigured).

## Action items

| ID | Owner | Action | Status |
|----|-------|--------|--------|
| SEC-118 | security | Restart cert-manager after secret rotation SOP | Done |
| SRE-302 | sre | Alert on \`cert-manager_certificate_expiration_timestamp_seconds\` < 14d | Done |
| SRE-303 | sre | Cross-link [[procedures/rotate-secrets]] with cert-manager deps | Done |

## Diagnostics (preserved)

\`\`\`bash
kubectl describe certificate cdn-tls -n ingress
# Events: Failed to verify DNS challenge: 403 Forbidden

kubectl logs -n cert-manager deploy/cert-manager --since=24h | grep cloudflare
\`\`\`

Follow-up rotation procedure: [[procedures/rotate-secrets]]
`,

  "index.md": `---
title: Platform runbook index
type: index
owner: platform
---

Operational procedures, incident records, and postmortems for **Acme Platform** (\`platform-api\`, \`platform-web\`, \`worker\`).

${blk.progress({
  type: "gauge",
  title: "Runbook health (quarterly review)",
  items: [
    { label: "Tested on schedule", value: 78 },
    { label: "Stale (>90d)", value: 12 },
    { label: "Draft", value: 10 },
  ],
})}

## Procedures

${blk.queryTable('TABLE title, owner, estimated_time FROM "procedures/" SORT title ASC')}

## Recent incidents

${blk.queryTable('TABLE title, severity, status, date FROM "incidents/" SORT date DESC')}

## Quick links

| Scenario | Start here |
|----------|------------|
| Production deploy | [[procedures/deploy]] |
| Traffic spike | [[procedures/scale]] |
| Page fired | [[procedures/incident-triage]] |
| Quarterly secrets | [[procedures/rotate-secrets]] |
| Pool / latency issues | [[incidents/2026-06-12-api-latency]] |

> [!NOTE]
> All times UTC unless noted. On-call rotation: PagerDuty schedule \`Platform Primary\`.
`,
};

export const runbookMock = {
  graphNodes: [
    { path: "procedures/deploy.md", tags: ["deploy", "active"] },
    { path: "procedures/scale.md", tags: ["scaling"] },
    { path: "procedures/rotate-secrets.md", tags: ["security"] },
    { path: "procedures/incident-triage.md", tags: ["incident"] },
    { path: "incidents/2026-06-12-api-latency.md", tags: ["sev2", "resolved"] },
    { path: "incidents/2026-06-18-cert-expiry.md", tags: ["sev3", "resolved"] },
    { path: "index.md", tags: ["index"] },
  ],
  graphEdges: [
    { source: "procedures/deploy.md", target: "procedures/incident-triage.md" },
    { source: "procedures/deploy.md", target: "procedures/scale.md" },
    { source: "procedures/deploy.md", target: "incidents/2026-06-12-api-latency.md" },
    { source: "procedures/scale.md", target: "incidents/2026-06-12-api-latency.md" },
    { source: "procedures/rotate-secrets.md", target: "incidents/2026-06-18-cert-expiry.md" },
    { source: "procedures/incident-triage.md", target: "procedures/deploy.md" },
    { source: "procedures/incident-triage.md", target: "procedures/scale.md" },
    { source: "procedures/incident-triage.md", target: "incidents/2026-06-18-cert-expiry.md" },
    { source: "incidents/2026-06-12-api-latency.md", target: "procedures/scale.md" },
    { source: "incidents/2026-06-18-cert-expiry.md", target: "procedures/rotate-secrets.md" },
    { source: "index.md", target: "procedures/deploy.md" },
    { source: "index.md", target: "incidents/2026-06-12-api-latency.md" },
  ],
  searchResults: demoSearch([
    { path: "procedures/deploy.md", score: 0.95, snippet: "...<mark>Canary</mark> 10% — error rate OK 15m before full rollout..." },
    { path: "incidents/2026-06-12-api-latency.md", score: 0.92, snippet: "...<mark>connection pool</mark> exhaustion after HPA scaled pods 8 → 20..." },
    { path: "procedures/scale.md", score: 0.87, snippet: "...pool headroom — 16 × 20 = 320 connections max safe..." },
    { path: "procedures/incident-triage.md", score: 0.83, snippet: "...Declare <mark>sev</mark> + thread — check deploys, flags, dashboards..." },
    { path: "procedures/rotate-secrets.md", score: 0.79, snippet: "...<mark>Vault</mark> admin access — dual-key overlap for zero downtime..." },
    { path: "incidents/2026-06-18-cert-expiry.md", score: 0.74, snippet: "...<mark>cert-manager</mark> ClusterIssuer wrong DNS-01 solver credentials..." },
  ]),
  backlinks: demoBacklinks([
    { path: "procedures/deploy.md", count: 4 },
    { path: "procedures/scale.md", count: 3 },
    { path: "incidents/2026-06-12-api-latency.md", count: 3 },
    { path: "procedures/incident-triage.md", count: 5 },
  ]),
  comments: demoComments("procedures/deploy.md", [
    {
      id: "r1",
      anchor: { quote: "proxy_read_timeout 300s", prefix: "", suffix: "" },
      body: "Confirmed with API team — export max duration is 240s today.",
      author: "lena",
      createdAt: daysAgo(3),
      resolved: true,
    },
    {
      id: "r2",
      anchor: { quote: "On-call notified", prefix: "", suffix: "" },
      body: "Add checkbox for weekend deploy window approval.",
      author: "marco",
      createdAt: daysAgo(14),
      resolved: false,
    },
  ]),
  queryRows: [
    { _path: "procedures/deploy.md", title: "Deploy to production", owner: "platform", estimated_time: "25-40 minutes" },
    { _path: "procedures/scale.md", title: "Scale workers and API replicas", owner: "platform", estimated_time: "10-20 minutes" },
    { _path: "procedures/rotate-secrets.md", title: "Rotate API and database secrets", owner: "security", estimated_time: "45-60 minutes" },
    { _path: "procedures/incident-triage.md", title: "Incident triage", owner: "platform", estimated_time: "ongoing" },
    { _path: "incidents/2026-06-12-api-latency.md", title: "Incident: API latency spike", severity: "sev2", status: "resolved", date: "2026-06-12" },
    { _path: "incidents/2026-06-18-cert-expiry.md", title: "Incident: Edge TLS certificate expiry", severity: "sev3", status: "resolved", date: "2026-06-18" },
  ],
  timelineEvents: [
    { type: "write", path: "incidents/2026-06-18-cert-expiry.md", title: "Edge TLS certificate expiry", actor: "marco", timestamp: daysAgo(2), message: "Postmortem published — sev3 resolved" },
    { type: "write", path: "procedures/rotate-secrets.md", title: "Rotate API and database secrets", actor: "security", timestamp: daysAgo(4), message: "Added cert-manager cross-link" },
    { type: "write", path: "procedures/deploy.md", title: "Deploy to production", actor: "lena", timestamp: daysAgo(5), message: "nginx timeout diff for exports" },
    { type: "write", path: "incidents/2026-06-12-api-latency.md", title: "API latency spike", actor: "lena", timestamp: daysAgo(8), message: "Postmortem complete — PLAT-441 done" },
    { type: "write", path: "procedures/scale.md", title: "Scale workers and API replicas", actor: "platform", timestamp: daysAgo(7), message: "Pool calculator section added" },
    { type: "write", path: "procedures/incident-triage.md", title: "Incident triage", actor: "platform", timestamp: daysAgo(10), message: "RDS connections diagnostic added" },
    { type: "write", path: "index.md", title: "Platform runbook index", actor: "platform", timestamp: daysAgo(1), message: "Quarterly review gauges updated" },
    { type: "write", path: "procedures/deploy.md", title: "Deploy to production", actor: "platform", timestamp: daysAgo(30), message: "Canary monitoring step extended to 15m" },
  ],
  metaResults: [
    { path: "procedures/deploy.md", frontmatter: { title: "Deploy to production", owner: "platform", status: "active", tags: ["deploy"] } },
    { path: "incidents/2026-06-12-api-latency.md", frontmatter: { title: "Incident: API latency spike", severity: "sev2", status: "resolved" } },
  ],
};
