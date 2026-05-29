---
title: Architecture
owner: tech-lead
status: draft
tags: [architecture, system-design]
last-reviewed: 2026-01-01
---

# Architecture

High-level overview of our system — what the components are, how they
connect, and where data flows.

## System Diagram

_Replace this section with your actual architecture diagram. You can use
Excalidraw-in-Markdown, Mermaid, or link to an external diagram._

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│  Client   │────▶│   API    │────▶│   DB     │
│  (Web)    │     │  Server  │     │ (Postgres)│
└──────────┘     └────┬─────┘     └──────────┘
                      │
                      ▼
                ┌──────────┐
                │  Worker  │
                │  Queue   │
                └──────────┘
```

## Components

| Component | Tech | Owner | Repo |
|-----------|------|-------|------|
| Frontend | React / Next.js | @frontend-team | `org/frontend` |
| API Server | Go / Python | @backend-team | `org/backend` |
| Database | PostgreSQL | @infra-team | N/A |
| Worker | Celery / Go | @backend-team | `org/backend` |

## Data Flow

1. Client sends request to API server
2. API validates, processes, and persists to database
3. For async work, API enqueues a job
4. Worker picks up the job and processes it

## Key Decisions

Link to relevant [[decisions/index|ADRs]] that shaped this architecture:

- _Example: [[decisions/adr-001-use-postgres|ADR-001: Use PostgreSQL over MongoDB]]_
- _Example: [[decisions/adr-002-event-driven|ADR-002: Event-driven worker queue]]_

## Environments

| Environment | URL | Purpose |
|-------------|-----|---------|
| Local | `localhost:3000` | Development |
| Staging | `staging.example.com` | Pre-production testing |
| Production | `app.example.com` | Live |

## Infrastructure

_Document your cloud provider, regions, key services, and how
deployment works. Link to [[processes/deployment|Deployment Process]]
for the step-by-step guide._
