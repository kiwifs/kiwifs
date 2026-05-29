---
title: Incident Response
owner: on-call
status: draft
tags: [processes, incidents, on-call]
last-reviewed: 2026-01-01
---

# Incident Response

What to do when something breaks in production.

## When to Use

- Users report an outage or degraded experience
- Monitoring alerts fire (error rate spike, latency, health check failures)
- A team member notices unexpected behavior in production

## Severity Levels

| Level | Criteria | Response Time |
|-------|----------|---------------|
| **SEV-1** | Full outage, all users affected | Immediate, all hands |
| **SEV-2** | Major feature broken, many users affected | < 30 min |
| **SEV-3** | Minor feature broken, workaround exists | < 4 hours |

## Steps

### 1. Assess

- Check monitoring dashboards
- Determine severity level
- Identify affected systems and users

### 2. Communicate

- Post in `#team-urgent` with: what's happening, severity, who's investigating
- For SEV-1/2: update stakeholders every 30 minutes until resolved

### 3. Mitigate

- Can you roll back? See [[processes/deployment|Deployment Process]] rollback section
- Can you toggle a feature flag?
- Can you scale up or restart the affected service?

### 4. Resolve

- Fix the root cause or confirm the mitigation is stable
- Update the channel: "Resolved — [brief summary]"

### 5. Follow Up

- Write a brief postmortem within 48 hours
- Identify action items to prevent recurrence
- File tasks in the tracker for follow-ups

## Related

- [[processes/deployment|Deployment Process]] — includes rollback steps
- [[architecture]] — system components and dependencies
