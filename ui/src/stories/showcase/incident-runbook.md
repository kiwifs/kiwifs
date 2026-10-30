---
title: "Runbook: job backlog after a config change"
tags: [runbook, incident, queues]
status: verified
owner: on-call
severity: sev2
last_drill: 2026-10-02
---

# Runbook: job backlog after a config change

Use this when the queue's oldest-job age climbs past five minutes within an hour of a configuration rollout. The usual cause is a worker setting that throttles throughput without failing any health check.

> [!IMPORTANT]
> Roll back first, investigate second. A rollback is safe at any point in this runbook; a forward fix is not.

## Response flow

```kiwi-steps id=response caption="From page to postmortem"
diagram: |
  flowchart TD
    A[Alert: oldest job > 5 min] --> B{Config change in the last hour?}
    B -->|yes| C[Roll back the change]
    B -->|no| D[Check worker health and error rate]
    C --> E{Backlog draining?}
    D --> E
    E -->|yes| F[Watch until age < 1 min]
    E -->|no| G[Scale workers and escalate]
    F --> H[Write the incident review]
    G --> H
steps:
  - note: "The page fires on oldest-job age, not queue depth. Depth alone rises during every batch import."
    focus: [A]
    dim: [C, D, E, F, G, H]
  - note: "Check the deploy log. A config change in the last hour is the cause more often than not."
    focus: [B]
    dim: [D, F, G, H]
  - note: "Roll it back through the normal pipeline. Do not hand-edit the running config."
    focus: [C]
    dim: [D, G, H]
  - note: "Give it five minutes. The oldest-job age should start falling within two."
    focus: [E, F]
    dim: [D, G]
  - note: "If it does not drain, scale out and bring in the queue owner."
    focus: [E, G]
    dim: [C, F]
  - note: "Either way, write it up within two working days."
    focus: [H]
```

## The usual fix

The last three incidents of this shape were the same setting: a concurrency limit lowered for a load test and shipped by mistake.

```kiwi-diff
title: worker.yaml — restore the concurrency limit
language: yaml
---
  queue: jobs-default
  worker:
-   concurrency: 2
+   concurrency: 16
    lease_seconds: 30
    renew_every_seconds: 10
-   prefetch: 1
+   prefetch: 4
```

## Checklist

- [ ] Acknowledge the page and post in the incident channel
- [ ] Check the deploy log for config changes in the last hour
- [ ] Roll back the most recent worker config change
- [ ] Confirm the oldest-job age is falling
- [ ] Confirm no jobs were processed twice (search the job store for duplicate tokens)
- [ ] Hand over or close the incident
- [ ] Open the incident review page

## What we believe about the cause

:::claim{evidence=derived confidence=0.8 source="reviews/backlog-2026-08"}
A concurrency limit below 4 cannot keep up with the weekday peak. At 3× average load the queue needs about 330 busy workers; with 40 hosts that is 8 per host, so a limit of 2 leaves three quarters of the peak unserved.
:::

:::claim{evidence=inferred confidence=0.5}
Prefetch of 1 makes the problem worse on hosts with high network latency to the queue, because each worker idles for a round-trip between jobs. We have not measured this directly.
:::

## Last occurrence

```timeline id=last-incident caption="Times in minutes after the config rollout" width=wide
lanes: [Deploy, Queue, On-call]
width: 760
laneHeight: 34
hoverPredecessors: true
intervals:
  - {id: rollout, lane: Deploy, start: 0, end: 4, label: "rollout", state: running}
  - {id: backlog, lane: Queue, start: 6, end: 38, label: "backlog growing", state: blocked}
  - {id: page, lane: On-call, start: 21, end: 21, label: "paged"}
  - {id: triage, lane: On-call, start: 21, end: 27, label: "triage", state: running}
  - {id: rollback, lane: Deploy, start: 27, end: 31, label: "rollback", state: running}
  - {id: drain, lane: Queue, start: 38, end: 52, label: "draining", state: running}
  - {id: resolved, lane: On-call, start: 52, end: 52, label: "resolved"}
links:
  - {from: rollout, to: backlog}
  - {from: rollback, to: drain}
marks:
  - {at: 21, label: "alert"}
ticks: [0, 10, 20, 30, 40, 50, 60]
min: 0
max: 60
steps:
  - note: "The rollout lowers concurrency on every worker. Nothing fails."
    activeIds: [rollout]
  - note: "Jobs arrive faster than they finish. The backlog grows for fifteen minutes before the alert."
    activeIds: [backlog]
  - note: "On-call is paged and finds the config change in the deploy log."
    activeIds: [page, triage]
  - note: "The rollback takes four minutes; workers restart with the old limit."
    activeIds: [rollback]
  - note: "The backlog drains in fourteen minutes and the incident is resolved."
    activeIds: [drain, resolved]
```

> [!CAUTION]
> Do not purge the queue to clear the backlog. Purged jobs are not retried, and the producers do not know they were dropped.
