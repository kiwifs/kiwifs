---
title: Dev Setup
owner: tech-lead
status: draft
tags: [processes, onboarding, dev-environment]
last-reviewed: 2026-01-01
---

# Dev Setup

How to set up your local development environment from scratch.

## Prerequisites

- macOS / Linux (or WSL2 on Windows)
- Git installed
- _List your required tools: Node.js, Go, Python, Docker, etc._

## Steps

### 1. Clone the Repositories

```bash
git clone git@github.com:org/repo.git
cd repo
```

### 2. Install Dependencies

_Replace with your actual commands:_

```bash
# Example for Node.js
npm install

# Example for Go
go mod download

# Example for Python
python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
```

### 3. Configure Environment

```bash
cp .env.example .env.local
# Edit .env.local with your local settings
```

### 4. Start Services

```bash
# Example: Docker Compose for local databases
docker compose up -d

# Example: Start the dev server
npm run dev
```

### 5. Verify

- App runs at `http://localhost:3000`
- API responds: `curl http://localhost:8000/health`
- Tests pass: `npm test` or `go test ./...`

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Port already in use | `lsof -ti:3000 \| xargs kill -9` |
| Database connection refused | Check Docker is running: `docker ps` |
| Missing environment variable | Compare `.env.local` with `.env.example` |

## Related

- [[onboarding/index|Onboarding]] — full new-member checklist
- [[architecture]] — what you're building
