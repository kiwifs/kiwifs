---
title: "ADR-014: Keep job state in an append-only log"
type: adr
adr_number: 14
status: accepted
date: 2026-09-30
deciders: [storage, platform]
domain: queues
supersedes: ADR-009
tags: [adr, storage, queues]
---

# ADR-014: Keep job state in an append-only log

## Context

The job store keeps one row per job and updates it in place on every state change: leased, renewed, written, acknowledged. At the current peak of roughly 400 state changes per second, row-level locking on hot jobs shows up as tail latency on lease renewals, and renewals that arrive late cause leases to expire under healthy workers.

We need a storage layout that keeps renewals cheap under contention, still answers "who holds job 7, and with which token?" quickly, and can be replayed after a crash.

## Options

::::columns{cols=3}
:::col
### A. Update in place

Keep the current table and tune it: shorter transactions, a partial index on active jobs.

- **+** No migration
- **+** Simple reads
- **−** Hot rows still contend
- **−** History is lost on every update
:::

:::col
### B. Append-only log

Write every state change as a new record, keyed by job and token. A compacted view holds the latest state.

- **+** Writes never contend on a row
- **+** Full history for incident review
- **−** Needs compaction
- **−** Reads go through the view
:::

:::col
### C. External lock service

Move leases out of the job store into a dedicated coordination service.

- **+** Purpose-built leases
- **−** A second system to run and page on
- **−** Fencing must still be enforced at the store
:::
::::

## Benchmark

Each option ran the same synthetic load for 30 minutes on identical hardware: 400 state changes per second at steady state, with bursts to 1,200.

```kiwi-chart
type: bar
title: Lease renewal latency (ms)
xKey: option
grid: true
legend: true
series:
  - key: p50
    name: p50
  - key: p99
    name: p99
  - key: p999
    name: p99.9
data:
  - option: A. Update in place
    p50: 3
    p99: 48
    p999: 310
  - option: B. Append-only log
    p50: 2
    p99: 9
    p999: 31
  - option: C. Lock service
    p50: 4
    p99: 14
    p999: 52
```

## Decision

We will adopt **option B**. Job state changes are appended to a log; a compacted table holds the latest record per job and is rebuilt from the log after a crash.

:::claim{evidence=stated confidence=0.9 source="benchmarks/job-store-2026-09"}
Under burst load, option B's p99.9 renewal latency stays under 40 ms, against 310 ms for the current layout. That is well inside the 10 second renewal interval, so a healthy worker no longer loses its lease to a slow renewal.
:::

:::claim{evidence=assumed confidence=0.6}
Compaction can run every minute without measurable impact on writes. We have tested it at steady state but not during a burst.
:::

## Consequences

- The fencing check moves to the append path: a record whose token is lower than the latest for that job is rejected.
- Incident reviews get a complete history of every job, which today we reconstruct from logs.
- Compaction is a new background process with its own alert on lag.
- Option C stays open if lease volume grows past what one store can absorb.

> [!NOTE]
> This decision supersedes ADR-009, which chose in-place updates when peak load was a tenth of today's.
