<p align="center">
  <a href="../README.md">README</a> · <a href="ARCHITECTURE.md">Architecture</a> · <a href="API.md">API</a> · <a href="EXAMPLES.md">Examples</a> · <a href="POSIX.md">POSIX</a>
</p>

# Frequently Asked Questions

## Table of Contents

- **General:** [What is KiwiFS?](#what-is-kiwifs) · [vs Obsidian?](#how-is-this-different-from-obsidian) · [vs Notion/Confluence?](#how-is-this-different-from-outline--notion--confluence) · [Do I need Git?](#do-i-need-to-know-git) · [Production-ready?](#is-kiwifs-production-ready)
- **Installation:** [Requirements?](#what-are-the-system-requirements) · [How to install?](#how-do-i-install-it) · [What's in .kiwi/?](#whats-in-kiwi)
- **Agents:** [How agents write?](#how-do-agents-write-to-kiwifs) · [What is MCP?](#what-is-mcp-and-why-does-kiwifs-support-it) · [Without a server?](#can-agents-use-kiwifs-without-a-running-server) · [With Cursor/Claude Code?](#can-i-use-kiwifs-with-cursor--claude-code--windsurf) · [Auto-configure?](#how-does-kiwifs-connect-work) · [Provenance?](#how-does-provenance-tracking-work)
- **Search:** [Backends?](#what-search-backends-are-available) · [Offline vector?](#can-i-run-vector-search-without-an-api-key) · [Rebuild index?](#how-do-i-rebuild-the-search-index)
- **Web UI:** [Embed in my app?](#can-i-embed-the-ui-in-my-own-app) · [Custom theme?](#can-i-customize-the-theme) · [Mobile?](#does-the-web-ui-work-on-mobile)
- **Protocols:** [Which one?](#when-should-i-use-nfs-vs-s3-vs-webdav-vs-fuse) · [Same pipeline?](#do-all-protocols-go-through-the-same-pipeline)
- **POSIX:** [Compatible?](#is-kiwifs-posix-compatible) · [Symlinks?](#do-symlinks-work) · [Open-then-delete?](#what-happens-if-i-open-a-file-and-then-delete-it) · [mmap?](#can-i-mmap-files-on-a-kiwifs-mount) · [Two servers?](#what-prevents-two-kiwifs-servers-from-sharing-the-same-directory) · [Stuck git?](#what-happens-if-git-gets-stuck-mid-commit)
- **Data:** [Crash mid-write?](#what-happens-if-kiwifs-crashes-mid-write) · [Backup?](#how-do-i-back-up-my-knowledge-base) · [Migrate from Obsidian/Notion?](#can-i-migrate-from-obsidian--notion--confluence) · [Import sources?](#what-data-sources-can-i-import-from) · [Idempotent?](#is-import-idempotent) · [Export?](#what-export-formats-are-available) · [ML training?](#can-i-use-exported-data-for-ml-training)
- **Queries:** [DQL?](#what-is-dql) · [Aggregation?](#what-aggregation-functions-are-available) · [Computed views?](#what-are-computed-views) · [Computed fields?](#what-are-computed-frontmatter-fields)
- **Analytics:** [kiwifs analytics?](#what-does-kiwifs-analytics-report) · [Health check?](#what-is-a-health-check)
- **Deployment:** [Production setup?](#whats-the-recommended-production-setup) · [Multiple KBs?](#can-i-run-multiple-knowledge-bases-on-one-server) · [KiwiFS Cloud?](#how-does-kiwifs-cloud-differ-from-self-hosted)
- **License:** [Commercial use?](#can-i-use-kiwifs-commercially) · [Contribute?](#can-i-contribute)

---

## General

### What is KiwiFS?

KiwiFS is a markdown filesystem for agents and teams. A single Go binary that serves markdown files with a web UI, git versioning, full-text + vector search, and multi-protocol access (REST, NFS, S3, WebDAV, FUSE, MCP). Think PocketBase for markdown, or Obsidian with a web UI and an agent interface.

### How is this different from Obsidian?

Obsidian is a desktop app. KiwiFS is a server. Obsidian's core insight (files are the database, wiki links connect them) is brilliant. KiwiFS takes that insight and adds: a web UI anyone can access (no app install), an agent interface (agents write with `cat`, not a custom SDK), git versioning (immutable audit trail), and full-text + vector search over the same files.

### How is this different from Outline / Notion / Confluence?

Those tools store your content in a proprietary database. You need their UI to read it, their API to query it, and their export tool to leave. KiwiFS stores everything as plain markdown files. `cat file.md` always works. `git clone` gets you everything. No lock-in.

### Do I need to know Git?

No. Git runs under the hood (every write is an atomic commit) but users never interact with it directly. The API and UI abstract it completely. Git is the audit trail, not a user interface.

### Is KiwiFS production-ready?

KiwiFS is in active development (v0.4). The core is stable: file CRUD, search, versioning, web UI, MCP, data import/export, DQL queries, and all access protocols work. We use it in production internally. That said, APIs may evolve before v1.0.

---

## Installation and Setup

### What are the system requirements?

Just the binary. KiwiFS is a single statically-linked Go binary with zero runtime dependencies. SQLite is embedded (pure Go, no CGo). The web UI is embedded via `go:embed`. It runs on macOS, Linux, and in Docker.

### How do I install it?

```bash
# Homebrew (macOS / Linux)
brew install kiwifs/tap/kiwifs

# One-line install (macOS / Linux)
curl -fsSL https://raw.githubusercontent.com/kiwifs/kiwifs/main/install.sh | sh

# Go
go install github.com/kiwifs/kiwifs@latest
```

Or build from source (requires Go 1.25+ and Node.js 20+):

```bash
git clone https://github.com/kiwifs/kiwifs.git && cd kiwifs
cd ui && npm install && npm run build && cd ..
go build -o kiwifs .
```

Docker:

```bash
docker run -v ./knowledge:/data -p 3333:3333 ameliaanhlam/kiwifs
```

### What's in `.kiwi/`?

The `.kiwi/` directory inside your knowledge root stores derived state: search indexes, comment data, config. It is **not** your content. You can delete it and KiwiFS will rebuild it from files on next startup (`kiwifs reindex`).

```
.kiwi/
├── config.toml       # Server and search configuration
├── playbook.md       # Agent-readable operation guide
├── state/
│   └── search.db     # SQLite FTS5 + metadata + vector indexes
├── comments/         # Inline comment annotations (JSON)
└── templates/        # Page templates for slash commands
```

---

## Agent Integration

### How do agents write to KiwiFS?

Three ways, depending on what your agent has access to:

1. **Filesystem** — if you mount KiwiFS via NFS or FUSE, the agent uses `cat`, `echo`, `grep`, `ls` directly. No SDK.
2. **REST API** — `curl -X PUT localhost:3333/api/kiwi/file?path=page.md -d "content"`.
3. **MCP** — `kiwifs mcp --root ~/knowledge` gives Claude, Cursor, or any MCP-compatible agent 62 structured tools (`kiwi_read`, `kiwi_write`, `kiwi_search`, etc.).

### What is MCP and why does KiwiFS support it?

[Model Context Protocol](https://modelcontextprotocol.io) is a standard for connecting AI agents to external tools. KiwiFS's MCP server exposes 62 tools and 3 resources, so any MCP-compatible agent can read, write, search, and query your knowledge base without custom integration code. Call `kiwi_context` first to get the schema, playbook, and index in one shot.

### Can agents use KiwiFS without a running server?

Yes. `kiwifs mcp --root ~/knowledge` runs entirely in-process: it opens the knowledge directory directly, no HTTP server needed. This is ideal for local agent setups where you don't want to run a separate service.

### Can I use KiwiFS with Cursor / Claude Code / Windsurf?

Yes. Add KiwiFS as an MCP server in your IDE's configuration:

```json
{
  "mcpServers": {
    "kiwifs": {
      "command": "kiwifs",
      "args": ["mcp", "--root", "/path/to/knowledge"]
    }
  }
}
```

Or use the auto-configuration command:

```bash
kiwifs connect my-workspace --write auto
```

This detects installed MCP clients (Cursor, Claude Desktop, VS Code, Windsurf, Claude Code) and writes the config for you.

### How does `kiwifs connect` work?

`kiwifs connect` scans your system for known MCP client configuration files, then writes the KiwiFS MCP server entry into each one. Use `--write auto` to update all detected clients, or `--write cursor` (etc.) to target a specific one. It supports both local workspaces and KiwiFS Cloud workspaces.

### How does provenance tracking work?

When an agent writes, it can include `X-Provenance` and `X-Actor` headers. KiwiFS injects this into the file's YAML frontmatter as a `derived-from` entry. You can later query "what did run-249 produce?" via the metadata API.

---

## Search

### What search backends are available?

Three tiers, configurable at startup:

| Tier | Engine | Use case |
|---|---|---|
| 1 | `grep` | Zero deps, exact match, tiny knowledge bases |
| 2 | `sqlite` (default) | SQLite FTS5, BM25 ranked, handles thousands of files |
| 3 | `vector` | Semantic similarity via embeddings, on top of tier 2. Enable via `[search.vector]` in config |

### Can I run vector search without an API key?

Yes. Two local options are supported:

- `provider = "ollama"` with sqlite-vec. Ollama runs locally, but still requires the Ollama service to be running.
- `provider = "onnx"` with a KiwiFS binary built using `-tags onnx`. This loads an ONNX model and matching HuggingFace `tokenizer.json` in-process, so no API key or embedding service is required. For Korean/Japanese/Chinese search, prefer a multilingual model such as `intfloat/multilingual-e5-small` and configure `query_prefix = "query: "` plus `passage_prefix = "passage: "`.

On small CPU-only machines, set `[search.vector].worker_count` lower and `[search.vector.embedder].timeout` higher for service-backed embedders.

### How do I rebuild the search index?

```bash
kiwifs reindex --root ./knowledge
```

This rebuilds FTS5, vector embeddings, metadata, and wiki link indexes from the files on disk. The files are always the source of truth.

---

## Web UI

### Can I embed the UI in my own app?

The web UI is built as React components (`<KiwiTree />`, `<KiwiPage />`, `<KiwiEditor />`, `<KiwiSearch />`), currently embedded in the binary via `go:embed`. A standalone `kiwifs-ui` npm package for embedding in your own React app is on the roadmap. See [ROADMAP.md](ROADMAP.md).

### Can I customize the theme?

Yes. The UI uses CSS variables prefixed with `--kiwi-`. KiwiFS ships with several built-in themes (kiwi, ocean, forest, sunset, neutral) and you can create your own. It's built on shadcn/ui + Tailwind, so it drops into any shadcn project.

### Does the web UI work on mobile?

The UI is responsive but optimized for desktop. Mobile works for reading; editing is best on a larger screen.

---

## Access Protocols

### When should I use NFS vs S3 vs WebDAV vs FUSE?

| Protocol | Best for |
|---|---|
| **NFS** | Docker/Kubernetes native mounts. No FUSE, no privileged containers |
| **S3** | Backup tools, data pipelines, anything that "supports S3" |
| **WebDAV** | Windows mapped drives, legacy tools |
| **FUSE** | Developer workstations. Mount a remote KiwiFS as a local folder |
| **REST API** | Web frontends, scripts, CI/CD |
| **MCP** | AI agents (Claude, Cursor, custom) |

### Do all protocols go through the same pipeline?

Yes. Every write, regardless of how it enters (REST, NFS, S3, WebDAV, FUSE, MCP), flows through the same pipeline: storage write, git commit, search index update, SSE broadcast. Consistency is guaranteed.

---

## POSIX and Filesystem Semantics

### Is KiwiFS POSIX-compatible?

Yes, to the degree that matters for agent and human workflows. KiwiFS stores real files on a real filesystem, not blobs in a database. Through NFS and FUSE mounts, agents get standard filesystem semantics: `cat`, `echo >>`, `mv`, `ln -s`, `ls`, `stat`, `rm` all work as expected.

The storage layer uses crash-safe atomic writes (temp+fsync+rename+dirsync), the NFS adapter supports open-then-delete (deferred unlink), and FUSE reports sub-second mtime. See the [full POSIX compliance table](POSIX.md) for the complete matrix.

### Do symlinks work?

Yes. Symlinks are supported on both NFS and FUSE mounts. NFS uses real `os.Symlink` on disk. FUSE creates symlinks via the REST API with `Content-Type: application/x-symlink`. There's also a `/api/kiwi/readlink` endpoint. Symlink targets are validated: absolute paths and path-traversal targets (e.g., `../../etc/passwd`) are rejected.

### What happens if I open a file and then delete it?

On NFS, KiwiFS implements POSIX open-unlink semantics: the file is hidden (renamed to `.kiwi-unlinked-*`) and deindexed from search immediately, but the actual deletion and git commit are deferred until the last file handle closes. This matches how Linux ext4/XFS behave.

### Can I `mmap` files on a KiwiFS mount?

On NFS mounts, yes. The kernel handles mmap transparently since NFS presents as a regular filesystem. On FUSE mounts, mmap is not supported because FUSE operates over HTTP (writes are buffered in memory and flushed on `close()`/`fsync()`).

### What prevents two KiwiFS servers from sharing the same directory?

A `flock(2)` advisory lock on `.kiwi/server.lock`. The lock is acquired at startup and released on shutdown. The kernel releases it automatically on any form of process exit (including SIGKILL), so there's no stale lock problem. This is the same pattern used by Prometheus, etcd, and Grafana Loki.

### What happens if git gets stuck mid-commit?

KiwiFS sends SIGTERM (not SIGKILL) to git subprocesses on timeout, giving git a chance to release `index.lock`. A background watcher runs every 10 seconds and removes any `index.lock` older than 60 seconds. On startup, stale locks are also cleaned. This means a stuck git process blocks writes for at most ~70 seconds, not forever.

---

## Data and Durability

### What happens if KiwiFS crashes mid-write?

Every write is an atomic git commit. If KiwiFS crashes, git's reflog provides crash recovery. On restart, KiwiFS detects and recovers from interrupted state.

### How do I back up my knowledge base?

Your knowledge base is a folder of markdown files with a `.git` directory. You can:

- `git push` to any git remote (GitHub, GitLab, your own server)
- `kiwifs backup` for one-shot push to a configured git remote
- Configure `[backup]` in `.kiwi/config.toml` for automatic scheduled pushes
- `aws s3 sync` via the S3 protocol
- Plain `rsync` or `cp` since the files are the truth

### Can I migrate from Obsidian / Notion / Confluence?

Yes. `kiwifs import` supports all three:

```bash
kiwifs import --from obsidian --path ~/my-vault --root ./knowledge
kiwifs import --from notion --api-key $NOTION_KEY --database-id $DB_ID --root ./knowledge
kiwifs import --from confluence --url https://yoursite.atlassian.net --root ./knowledge
```

Obsidian vaults also work by simply copying the `.md` files into your knowledge root and running `kiwifs reindex`.

---

## Data Import and Export

### What data sources can I import from?

KiwiFS supports 19 import sources across four categories:

| Category | Sources |
|---|---|
| **Databases** | PostgreSQL, MySQL, SQLite, MongoDB, DynamoDB, Redis, Elasticsearch |
| **Files** | CSV, JSON, JSONL, YAML, Excel |
| **SaaS** | Notion, Airtable, Google Sheets, Confluence |
| **Knowledge** | Markdown, Obsidian vaults, Firebase/Firestore |

Each row becomes a markdown file with structured frontmatter. Use `--dry-run` to preview before importing.

### Is import idempotent?

Yes. Re-importing the same data skips unchanged rows. KiwiFS tracks `_source` and `_source_id` in frontmatter to identify previously imported records. Only fields that actually changed trigger an update.

### What export formats are available?

JSONL and CSV. Both support optional flags: `--include-content` (full markdown body), `--include-links` (wiki link graph), `--include-embeddings` (vector embeddings with `.schema.json` sidecar), `--columns` (specific frontmatter fields).

### Can I use exported data for ML training?

Yes. The JSONL export with `--include-embeddings` produces ML-ready datasets. The `.schema.json` sidecar documents the embedding dimensions and model used. Combined with DQL for feature selection, you can build training pipelines directly from your knowledge base.

---

## Queries and Aggregation

### What is DQL?

DataView Query Language: a query language for frontmatter. If you've used the Obsidian Dataview plugin, it's the same idea but runs server-side:

```
TABLE title, status, priority FROM "pages" WHERE status = "draft" SORT priority DESC
```

Supports `TABLE`, `LIST`, `COUNT`, `DISTINCT` modes, `WHERE` filters with boolean logic, `SORT`, `GROUP BY`, `FLATTEN`, and implicit fields like `_path`, `_updated`, `_size`.

### What aggregation functions are available?

`count`, `avg`, `sum`, `min`, `max` applied over any numeric frontmatter field, grouped by another field:

```bash
kiwifs aggregate --group status --calc count,avg:priority
```

### What are computed views?

Markdown files whose body is auto-generated from a DQL query. Set `kiwi-view: true` and `kiwi-query: "..."` in frontmatter, and KiwiFS will regenerate the body on refresh or when the file is read.

### What are computed frontmatter fields?

Virtual fields defined as expressions in `.kiwi/config.toml`. They're evaluated at index time and appear alongside real frontmatter in queries:

```toml
[dataview]
computed_fields.age_days = "days_since(updated)"
computed_fields.is_long = "len(body) > 5000"
```

---

## Analytics and Health

### What does `kiwifs analytics` report?

A health dashboard for your knowledge base: total pages, stale pages (past review date), orphan pages (no incoming links), broken wiki links, empty pages, pages without frontmatter, link coverage percentage, and recently updated pages.

### What is a health check?

Per-page diagnostics via `GET /api/kiwi/health-check?path=...`. Returns word count, link count, backlink count, days since last update, optional quality score, and any issues from the last janitor scan.

---

## Deployment

### What's the recommended production setup?

```bash
docker run -d --restart always \
  -v /data/knowledge:/data \
  -p 3333:3333 \
  ameliaanhlam/kiwifs serve --root /data --search sqlite --versioning git
```

For persistent vector search with pgvector, configure `[search.vector.store] provider = "pgvector"` in `.kiwi/config.toml` and run a pgvector instance alongside KiwiFS.

### Can I run multiple knowledge bases on one server?

Yes. Multi-space support lets one server host multiple independent knowledge bases, each with its own root directory, git repo, and search index:

```
GET /api/kiwi/{space}/tree
GET /api/kiwi/{space}/file?path=...
```

### How does KiwiFS Cloud differ from self-hosted?

[KiwiFS Cloud](https://app.kiwifs.com) is the hosted version. It handles provisioning, backups, TLS, and multi-user auth (via WorkOS). Your workspaces are accessible via the web UI at `app.kiwifs.com` and via MCP at `api.kiwifs.com`. The same `kiwifs` CLI works with both local and cloud workspaces. Self-hosted gives you full control; Cloud gives you zero ops.

---

## License

### Can I use KiwiFS commercially?

Yes. KiwiFS is licensed under [BSL 1.1](../LICENSE). You can use, self-host, modify, and embed it in commercial products. The only restriction: you cannot offer KiwiFS itself as a commercial hosted service (i.e., selling "KiwiFS-as-a-Service"). Each release converts to Apache 2.0 after 4 years.

### Can I contribute?

Absolutely. See [CONTRIBUTING.md](../CONTRIBUTING.md). By contributing, you agree that your contributions are licensed under BSL 1.1 (converting to Apache 2.0 per the license terms).
