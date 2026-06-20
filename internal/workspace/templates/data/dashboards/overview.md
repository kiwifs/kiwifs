---
title: Overview Dashboard
type: dashboard
owner: data-lead
status: active
tags: [dashboard, overview]
---

# Overview Dashboard

Live metrics from the data workspace.

## Users by Status

```kiwi-query
TABLE status, COUNT(status) AS count
FROM "collections/example-records/"
GROUP BY status
```

## Users by Plan

```kiwi-query
TABLE plan, COUNT(plan) AS count
FROM "collections/example-records/"
GROUP BY plan
```

## Plan Distribution

```kiwi-chart
type: pie
query: |
  TABLE plan, COUNT(plan) AS count
  FROM "collections/example-records/"
  GROUP BY plan
```

## Recent Activity

```kiwi-query
TABLE title, plan, status, last_active
FROM "collections/example-records/"
SORT last_active DESC
LIMIT 10
```

## Active Users Over Time

```kiwi-chart
type: bar
query: |
  TABLE created_at, COUNT(created_at) AS signups
  FROM "collections/example-records/"
  WHERE status = "active"
  GROUP BY created_at
  SORT created_at ASC
```
