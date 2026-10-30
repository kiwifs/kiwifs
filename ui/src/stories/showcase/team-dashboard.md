---
title: Platform team dashboard
tags: [dashboard, team]
owner: platform
refresh: weekly
---

# Platform team dashboard

Everything here is computed from the pages in this workspace, except the sprint board and the service-level targets, which live on this page.

## Open work

```kiwi-query
TABLE title, status, priority, owner
FROM "tasks/"
WHERE status != "done"
SORT priority ASC
```

## Quarter goals

```kiwi-progress
type: bar
title: Q4 objectives
showPercent: true
items:
  - label: Move job state to the append-only log
    value: 70
  - label: Cut p99 lease renewal below 20 ms
    value: 85
  - label: Runbook for every paging alert
    value: 55
  - label: Two incident drills
    value: 50
```

## Throughput

```kiwi-chart
type: line
title: Jobs processed per day (millions)
xKey: week
grid: true
legend: true
series:
  - key: processed
    name: Processed
  - key: retried
    name: Retried
data:
  - week: W36
    processed: 9.8
    retried: 0.4
  - week: W37
    processed: 10.4
    retried: 0.3
  - week: W38
    processed: 11.1
    retried: 0.9
  - week: W39
    processed: 11.6
    retried: 0.3
  - week: W40
    processed: 12.2
    retried: 0.2
```

## Sprint board

```kiwi-kanban
title: Sprint 44
columns:
  - name: To do
    cards:
      - id: compaction-alert
        title: Alert on compaction lag
        tags: [observability]
        priority: high
  - name: In progress
    cards:
      - id: append-path
        title: Fencing check on the append path
        tags: [storage]
        priority: critical
        assignee: storage
  - name: Review
    cards:
      - id: renewal-panel
        title: Renewal latency panel
        tags: [observability]
        assignee: platform
  - name: Done
    cards:
      - id: bench
        title: Benchmark the three storage options
        tags: [storage]
```

## Service-level targets

```kiwi-data
kind: slo
records:
  - service: job-queue
    objective: lease renewal p99
    target: 20 ms
    current: 9 ms
    status: met
  - service: job-queue
    objective: oldest job age
    target: 5 min
    current: 40 s
    status: met
  - service: job-store
    objective: write availability
    target: 99.95%
    current: 99.97%
    status: met
  - service: scheduler
    objective: on-time dispatch
    target: 99.9%
    current: 99.7%
    status: missed
```

> [!TIP]
> Edit a target in the block above and it is re-indexed on save, so `FROM RECORDS "slo"` queries elsewhere pick it up.
