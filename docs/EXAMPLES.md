<p align="center">
  <a href="../README.md">README</a> · <a href="FAQ.md">FAQ</a> · <a href="ARCHITECTURE.md">Architecture</a> · <a href="API.md">API</a> · <a href="POSIX.md">POSIX</a>
</p>

# Examples

Practical workflows for agents, teams, and developers using KiwiFS.

---

## Table of Contents

- [The LLM Wiki Pattern](#the-llm-wiki-pattern)
- [Agent Workflows](#agent-workflows)
- [MCP Tool Sequences](#mcp-tool-sequences)
- [DQL Queries](#dql-queries)
- [Aggregation](#aggregation)
- [Data Import](#data-import)
- [Data Export](#data-export)
- [Init Templates](#init-templates)
- [Widgets](#widgets)
- [Workflows and Task Orchestration](#workflows-and-task-orchestration)
- [Publishing](#publishing)
- [Configuration](#configuration)
- [Deployment](#deployment)

---

## The LLM Wiki Pattern

KiwiFS implements [Karpathy's LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) as production infrastructure. The pattern: raw sources in, compiled wiki out, agent maintains it over time.

```bash
kiwifs init --template knowledge --root ./knowledge
```

```
knowledge/
├── SCHEMA.md          # Structure and frontmatter conventions
├── index.md           # Auto-maintained table of contents
├── log.md             # Append-only chronological record
├── pages/             # Durable knowledge (one page per concept)
├── episodes/          # Per-session episodic notes
└── .kiwi/
    └── playbook.md    # Agent-readable operation guide
```

Every template ships with two agent-facing documents:

- **`SCHEMA.md`** defines structure, directory layout, and frontmatter field tables
- **`.kiwi/playbook.md`** provides step-by-step MCP tool sequences for each operation

The agent calls `kiwi_context` on connect to receive both documents plus the current index in one call. Operations from the playbook:

| Operation | What it does |
|-----------|-------------|
| **Ingest** | Process a new source, create/update pages, update index + log |
| **Query** | Search the wiki to answer a question |
| **Remember** | Save episodic observations during a session |
| **Consolidate** | Merge episodes into durable pages |
| **Lint** | Audit for orphan pages, broken links, stale content |

Other templates: `kb`, `wiki`, `tasks`, `data`, `cms`, `runbook`, `adr`, `prompt`, `research`, `log`, or start blank with `kiwifs init`.

---

## Agent Workflows

### Writing via filesystem (NFS / FUSE mount)

```bash
cat /kiwi/pages/authentication.md
grep -r "timeout" /kiwi/
ls /kiwi/pages/
echo "# New finding" > /kiwi/pages/finding-042.md
```

### Writing via REST API

```bash
curl -X PUT 'localhost:3333/api/kiwi/file?path=pages/auth.md' \
  -H "X-Actor: my-agent" \
  -H "X-Provenance: run:run-249" \
  -d "# Authentication\n\nOAuth2 + JWT..."
```

### Bulk write (single commit)

```bash
curl -X POST 'localhost:3333/api/kiwi/bulk' \
  -H "Content-Type: application/json" \
  -d '{
    "files": [
      {"path": "pages/auth.md", "content": "# Auth\n\nUpdated..."},
      {"path": "pages/payments.md", "content": "# Payments\n\n..."},
      {"path": "log.md", "content": "- 2026-05-21: Updated auth and payments"}
    ],
    "actor": "agent:exec_abc",
    "message": "run #249: updated auth and payments"
  }'
```

### Provenance tracking

```bash
curl -X PUT localhost:3333/api/kiwi/file?path=report.md \
  -H "X-Actor: agent:exec_abc" \
  -H "X-Provenance: run:run-249" \
  -d "# Run 249 Report..."
```

KiwiFS injects `derived-from` into the frontmatter automatically. Query later with:

```
GET /api/kiwi/meta?where=$.derived-from[*].id=run-249
```

---

## MCP Tool Sequences

### First connection (load context)

```
kiwi_context → returns SCHEMA.md + playbook.md + index.md
```

### Ingest a new source

```
kiwi_search("authentication")        → check if page exists
kiwi_write("pages/auth.md", content) → create or update
kiwi_read("index.md")                → get current index
kiwi_write("index.md", updated)      → update table of contents
kiwi_append("log.md", entry)         → log the change
```

### Answer a question

```
kiwi_search("payment timeout")       → find relevant pages
kiwi_read("pages/payments.md")       → read the full page
```

### Save session memory

```
kiwi_append("episodes/2026-05-21.md", observation)
```

### Consolidate episodes into durable pages

```
kiwi_search("episodes/")             → list unmerged episodes
kiwi_read("episodes/2026-05-21.md")  → read episode
kiwi_write("pages/topic.md", merged) → update durable page
```

### Health check

```
kiwi_analytics()                      → workspace-level health
kiwi_health_check("pages/auth.md")    → per-page diagnostics
kiwi_lint()                           → orphans, broken links, missing frontmatter
```

---

## DQL Queries

DataView Query Language: SQL-like queries over frontmatter metadata.

### Basic queries

```bash
# List all draft pages sorted by priority
kiwifs query 'TABLE title, status, priority FROM "pages" WHERE status = "draft" SORT priority DESC'

# Count pages by status
kiwifs query 'COUNT FROM "pages" GROUP BY status'

# Find all pages tagged "security"
kiwifs query 'LIST FROM "pages" WHERE contains(tags, "security")'
```

### Via REST API

```
GET /api/kiwi/query?q=TABLE title, status FROM "pages" WHERE priority = "high"
```

### Computed views

Markdown files whose body is auto-generated from a DQL query:

```bash
kiwifs view create --query 'TABLE title, status FROM "pages"' --output views/overview.md
kiwifs view refresh   # re-run all view queries
```

Set `kiwi-view: true` and `kiwi-query: "..."` in frontmatter, and KiwiFS will regenerate the body on refresh.

### Computed frontmatter fields

Define expressions in config that are evaluated at index time:

```toml
# .kiwi/config.toml
[dataview]
computed_fields.age_days = "days_since(updated)"
computed_fields.is_long = "len(body) > 5000"
computed_fields.priority_score = "priority * 10 + len(tags)"
```

These fields appear in DQL queries and meta API responses alongside real frontmatter.

---

## Aggregation

SQL-style aggregates over frontmatter fields:

```bash
kiwifs aggregate --group status --calc count,avg:priority
```

```
GET /api/kiwi/query/aggregate?group_by=status&calc=count,avg:priority
```

Functions: `count`, `avg`, `sum`, `min`, `max`. Optional `--where` filters and `--path-prefix` scoping.

---

## Data Import

Bulk-import from 21 sources. Each row becomes a markdown file with structured frontmatter:

```bash
# From another markdown folder
kiwifs import --from markdown --path ./docs --root ./knowledge

# From a database
kiwifs import --from postgres --dsn "postgres://..." --table users --root ./knowledge

# From files
kiwifs import --from csv --path data.csv --root ./knowledge

# From SaaS
kiwifs import --from notion --api-key $NOTION_KEY --database-id $DB_ID --root ./knowledge

# From an Obsidian vault
kiwifs import --from obsidian --path ~/my-vault --root ./knowledge

# From an ML dataset's Croissant metadata — the column schema becomes
# kiwi-data records you can query with `FROM RECORDS "dataset-schema"`
kiwifs import --from croissant --url https://www.kaggle.com/datasets/OWNER/NAME/croissant/download --root ./knowledge
```

| Category | Sources |
|---|---|
| **Databases** | PostgreSQL, MySQL, SQLite, MongoDB, DynamoDB, Redis, Elasticsearch |
| **Files** | CSV, JSON, JSONL, YAML, Excel, BibTeX, Croissant |
| **SaaS** | Notion, Airtable, Google Sheets, Confluence |
| **Knowledge** | Markdown, Obsidian vaults, Firebase/Firestore |

Features: idempotent upserts (re-importing skips unchanged rows), `--dry-run`, `--columns` filtering, `--primary-key` control, `_source` / `_source_id` tracking in frontmatter.

---

## Data Export

```bash
kiwifs export --format jsonl --output knowledge.jsonl
kiwifs export --format csv --include-embeddings --output dataset.csv
kiwifs export --format parquet --include-content --output knowledge.parquet
```

```
GET /api/kiwi/export?format=jsonl&include_content=true&include_embeddings=true
```

Options:

| Flag | What it includes |
|------|-----------------|
| `--include-content` | Full markdown body |
| `--include-links` | Wiki link graph for each page |
| `--include-embeddings` | Vector embeddings (writes `.schema.json` sidecar) |
| `--columns` | Export only specific frontmatter fields |

### Document export

```bash
kiwifs export --format pdf --path docs/report.md --output report.pdf
kiwifs export --format html --path concepts/ --self-contained --output site.html
kiwifs export --format slides --path talks/intro.md --output slides.html
kiwifs export --format mkdocs --path docs/ --site-name "My Wiki" --output docs-project/
```

```
POST /api/kiwi/export/document
{"format": "pdf", "path": "pages/report.md", "pdf_engine": "typst"}
```

Formats: `pdf` (Typst or XeLaTeX), `html`, `slides` (Marp), `mkdocs`, `site` (static ZIP). The web UI also supports in-browser PDF via Typst.

---

## Init Templates

Scaffold a workspace for any use case:

```bash
kiwifs init --template kb --root ./docs-kb          # Governed knowledge base
kiwifs init --template wiki --root ./team-wiki       # Team wiki
kiwifs init --template memory --root ./agent-memory  # Agent episodic memory
kiwifs init --template tasks --root ./project        # Task tracking + Kanban
kiwifs init --template data --root ./analytics       # Data collections + DQL dashboards
kiwifs init --template cms --root ./blog             # Headless CMS + feeds
kiwifs init --template runbook --root ./ops          # Ops runbooks
kiwifs init --template adr --root ./decisions        # Architecture decision records
kiwifs init --template prompt --root ./prompts       # Prompt library + eval
kiwifs init --template research --root ./research    # Research + citations
kiwifs init --template log --root ./audit            # Append-only event log
```

---

## Widgets

Embed interactive blocks in markdown using fenced code blocks:

### Chart

````
```kiwi-chart
type: bar
title: Sprint velocity
data:
  - label: Sprint 1
    value: 21
  - label: Sprint 2
    value: 34
  - label: Sprint 3
    value: 28
```
````

Supported types: `bar`, `line`, `area`, `pie`, `radar`, `scatter`.

### Inline DQL query

````
```kiwi-query
TABLE title, status, priority
FROM "tasks"
WHERE status != "done"
SORT priority DESC
```
````

### Inline kanban

````
```kiwi-kanban
columns:
  - name: Todo
    cards:
      - title: Design API
  - name: In Progress
    cards:
      - title: Build UI
  - name: Done
    cards:
      - title: Write tests
```
````

### Tabs and columns

```
:::tabs
::tab[REST]
Use `PUT /api/kiwi/file` to create or update a page.
::tab[MCP]
Call `kiwi_write` with `path` and `content` arguments.
:::
```

Callouts: `> [!NOTE]`, `> [!TIP]`, `> [!WARNING]`, `> [!CAUTION]`, `> [!IMPORTANT]`. Foldable: `> [!NOTE]-` (collapsed) or `> [!NOTE]+` (expanded).

---

## Workflows and Task Orchestration

### Define a workflow

```json
// .kiwi/workflows/review.json
{
  "name": "review",
  "states": ["draft", "review", "approved", "published"],
  "transitions": {
    "draft": ["review"],
    "review": ["approved", "draft"],
    "approved": ["published"]
  }
}
```

### Advance a page via REST

```bash
curl -X POST 'http://localhost:3333/api/kiwi/workflow/advance' \
  -H 'Content-Type: application/json' \
  -d '{"path":"pages/report.md","target_state":"review","actor":"agent:reviewer"}'
```

### Task orchestration via MCP

```
kiwi_task_create({
  "title": "Implement auth flow",
  "priority": "high",
  "assignee": "agent:eng-bot"
})

kiwi_task_progress({
  "path": "tasks/implement-auth-flow.md",
  "status": "Started OAuth2 integration",
  "actor": "agent:eng-bot"
})

kiwi_workflow_advance({
  "path": "tasks/implement-auth-flow.md",
  "target_state": "review"
})
```

### Memory tools

```
kiwi_remember({
  "content": "The auth service returns 403 when tokens expire within 5 minutes of a request",
  "scope": "backend"
})

kiwi_forget({
  "path": "episodes/2026-06-15/abc123.md"
})
```

---

## Publishing

### Publish a page

```bash
curl -X POST 'http://localhost:3333/api/kiwi/publish' \
  -H 'Content-Type: application/json' \
  -d '{"path":"blog/welcome-post.md"}'
```

Published pages are accessible at `/p/blog/welcome-post.md`. Subscribe to feeds at `/api/kiwi/feed.xml` (Atom) or `/api/kiwi/feed.json`.

### Create a share link

```bash
curl -X POST 'http://localhost:3333/api/kiwi/share' \
  -H 'Content-Type: application/json' \
  -d '{"path":"reports/q2-review.md"}'
```

---

## Configuration

```toml
# .kiwi/config.toml

[server]
port = 3333
host = "0.0.0.0"
public_url = "https://wiki.mycompany.com"  # enables permalinks

[storage]
root = "/data/knowledge"

[search]
engine = "sqlite"                # grep | sqlite

[search.vector]
enabled = true
worker_count = 1

[search.vector.embedder]
provider = "ollama"              # openai | ollama | cohere | bedrock | vertex | http
model = "nomic-embed-text"
timeout = "120s"

[search.vector.store]
provider = "sqlite-vec"          # sqlite-vec | qdrant | pgvector | pinecone | weaviate | milvus

# Fully local ONNX alternative (requires a binary built with `go build -tags onnx`):
# [search.vector.embedder]
# type = "onnx"                  # provider = "onnx" also works
# model_path = "~/.kiwi/models/multilingual-e5-small/onnx/model.onnx"
# dimensions = 384
# query_prefix = "query: "
# passage_prefix = "passage: "
# tokenizer_path optional — auto-discovered from parent dir after kiwifs model download
# runtime_path = "/opt/onnxruntime/lib/libonnxruntime.so.1.25.0"  # optional if lib is discoverable

[versioning]
strategy = "git"                 # git | cow | none

[auth]
type = "none"                    # none | apikey | perspace | oidc
```

CLI flags override config: `kiwifs serve --port 4000 --search sqlite --versioning git`.

---

### ONNX local embedder

Build KiwiFS with ONNX support when you want vector search without API keys or a running embedding service:

```bash
kiwifs model download all-minilm-l6-v2          # English baseline (384-dim)
# or: kiwifs model download multilingual-e5-small  # CJK-friendly
go build -tags onnx -o kiwifs .
```

```toml
[search.vector.embedder]
type = "onnx"                  # provider = "onnx" also works
model_path = "~/.kiwi/models/all-MiniLM-L6-v2/onnx/model.onnx"
dimensions = 384
# tokenizer_path optional — auto-discovered from parent dir after kiwifs model download
```

Download an ONNX Runtime shared library that matches `github.com/yalue/onnxruntime_go` and point `runtime_path` at it if it is not on the system library path. For CJK-friendly search, use `multilingual-e5-small` and set `query_prefix = "query: "` plus `passage_prefix = "passage: "` so reindexing stores `passage: ...` vectors and search embeds `query: ...`.

---

## Deployment

### Docker

```bash
docker run -v ./knowledge:/data -p 3333:3333 ameliaanhlam/kiwifs
```

### Docker Compose (with vector search)

```yaml
services:
  kiwifs:
    image: ameliaanhlam/kiwifs
    volumes:
      - ./knowledge:/data
    ports:
      - "3333:3333"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}

  # Optional: pgvector for large-scale vector search
  pgvector:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: kiwi
      POSTGRES_USER: kiwi
      POSTGRES_PASSWORD: kiwi
```

### Embedded in your Go app

```go
import "github.com/kiwifs/kiwifs/pkg/kiwi"

srv, err := kiwi.New("/data/knowledge", kiwi.WithSearch("sqlite"))
if err != nil { log.Fatal(err) }
defer srv.Close()

mux.Handle("/knowledge/", http.StripPrefix("/knowledge", srv.Handler()))
```

### With NFS (Docker / Kubernetes)

```bash
kiwifs serve --root /data/knowledge --nfs --nfs-port 2049
```

```yaml
# Kubernetes PersistentVolume
apiVersion: v1
kind: PersistentVolume
spec:
  nfs:
    server: kiwifs.internal
    path: /
```

For full deployment documentation, see [docs.kiwifs.com/deploy/docker](https://docs.kiwifs.com/deploy/docker).
