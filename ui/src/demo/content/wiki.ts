import {
  chart,
  progress,
  colorPalette,
  tabs,
  columns,
  queryTable,
  mermaid,
  kiwiApp,
  playground,
  diff,
  counterApp,
  eventCounterApp,
} from "../blocks";
import { demoBacklinks, demoComments, demoSearch, demoVersions } from "./mockExtras";

export const wikiPages: Record<string, string> = {
  "welcome.md": `---
title: Welcome to the KiwiFS engineering wiki
tags: [home, wiki]
status: published
owner: eng-platform
---

This wiki **is** a KiwiFS workspace — we dogfood the same binary, UI, and MCP tools we ship. Pages are markdown on disk; every edit is a git commit; search indexes rebuild from files.

${progress({
  type: "bar",
  title: "Wiki health (last lint run)",
  items: [
    { label: "Published", value: 94, color: "#22c55e" },
    { label: "Draft", value: 4, color: "#64748b" },
    { label: "Broken links", value: 2, color: "#ef4444" },
  ],
})}

## Start here

| If you are… | Read |
|-------------|------|
| New engineer | [[engineering/onboarding]] → [[engineering/architecture]] |
| Writing a design doc | [[decisions/README]] (ADR pattern) |
| Shipping a release | [[processes/releases]] |
| Reviewing PRs | [[processes/code-review]] |

${queryTable('TABLE title, tags, status FROM "engineering/" WHERE status = "published" SORT title ASC')}

${counterApp}

> [!NOTE]
> Prefer wiki links (\`[[page]]\`) over raw paths — backlinks and the graph view stay accurate. See [[engineering/search#wiki-links|search docs]] for how links are indexed.
`,

  "engineering/architecture.md": `---
title: Architecture overview
tags: [engineering, architecture]
status: published
owner: eng-platform
last_reviewed: 2026-06-10
---

KiwiFS is a single Go binary: markdown files on disk are the source of truth; SQLite FTS5 + optional vector store are rebuildable indexes; git records every write. The React UI is embedded via \`go:embed\` — no separate frontend deploy for self-hosters.

## Write path

A PUT from an agent, the wiki UI, or \`kiwifs connect\` NFS mount hits one storage layer, then fans out to git + search + SSE subscribers.

${mermaid(`sequenceDiagram
  participant Client as Client (UI / MCP / REST)
  participant API as Echo API (:3333)
  participant Store as pkg/storage
  participant Git as git repo
  participant Idx as FTS5 + vector
  participant SSE as event bus

  Client->>API: PUT /api/kiwi/file?path=...
  API->>Store: Validate schema (optional)
  Store->>Git: atomic commit (X-Actor header)
  Store->>Idx: reindex page + embeddings
  Store->>SSE: page.write event
  API-->>Client: 200 + etag

  Note over Client,SSE: UI graph/backlinks refresh via SSE`)}

${columns("2:1", [
  `### Layer map

| Layer | Tech | Notes |
|-------|------|-------|
| Protocols | REST, MCP, NFS, S3, WebDAV, FUSE | All converge on storage |
| Search | SQLite FTS5, sqlite-vec | BM25 + hybrid vector |
| Versioning | go-git | Blame, diff, restore |
| UI | Vite + React + CodeMirror | Block editor, graph, kanban |
| Config | \`.kiwi/config.toml\` | Per-workspace |

Cross-read: [[engineering/search]], [[engineering/versioning]], [[engineering/mcp-tools]].`,
  `### Design constraints

1. **Files win** — indexes are disposable; \`kiwifs rebuild-index\` must succeed from disk alone.
2. **One binary** — no sidecar Postgres for core path (optional for pgvector).
3. **Actor attribution** — every write carries \`X-Actor\` for git author mapping.

${eventCounterApp}`,
])}

## Talking to KiwiFS

${tabs([
  {
    label: "Go (embed)",
    body: `\`\`\`go
import "github.com/kiwifs/kiwifs/pkg/kiwi"

ws, _ := kiwi.Open("./wiki", kiwi.Options{})
defer ws.Close()

err := ws.Write(ctx, "engineering/architecture.md", body,
    kiwi.WithActor("lena"))
// Triggers same pipeline as REST — git commit + reindex
\`\`\``,
  },
  {
    label: "TypeScript (REST)",
    body: `\`\`\`typescript
const res = await fetch(
  \`\${base}/api/kiwi/file?path=engineering/architecture.md\`,
  {
    method: "PUT",
    headers: {
      "Content-Type": "text/markdown",
      "X-Actor": "cursor-agent",
    },
    body: markdown,
  },
);
if (!res.ok) throw new Error(await res.text());
\`\`\``,
  },
  {
    label: "Shell (CLI)",
    body: `\`\`\`bash
# Local dev wiki root
export KIWI_ROOT=./internal/workspace/templates/wiki

echo "# Patch notes" | kiwifs write \\
  --root "$KIWI_ROOT" \\
  --path processes/releases.md \\
  --actor sam

kiwifs query --root "$KIWI_ROOT" \\
  'TABLE title FROM "engineering/" SORT title ASC'
\`\`\``,
  },
])}

## Storage vs index (mental model)

${mermaid(`graph LR
  MD[*.md on disk] --> Git[Git history]
  MD --> FTS[FTS5 index]
  MD --> Vec[Vector chunks]
  MD --> Graph[Wiki link graph]
  Git -. rebuild .-> FTS
  Git -. rebuild .-> Vec
  MD -. rebuild .-> Graph`)}

${colorPalette({
  name: "KiwiFS UI accents",
  showContrast: true,
  size: "medium",
  colors: [
    { hex: "#84cc16", label: "Primary (Kiwi)" },
    { hex: "#0ea5e9", label: "Ocean preset" },
    { hex: "#1e293b", label: "Sidebar dark" },
    { hex: "#f8fafc", label: "Canvas light" },
    { hex: "#ef4444", label: "Broken link badge" },
  ],
})}

${diff({
  title: "Recent storage interface tweak",
  language: "go",
  before: `func (s *Store) Put(path string, content []byte) error {
    return s.fs.WriteFile(path, content, 0644)
}`,
  after: `func (s *Store) Put(ctx context.Context, path string, content []byte, opts PutOpts) error {
    if err := s.schema.Validate(path, content); err != nil {
        return err
    }
    return s.commit(ctx, path, content, opts.Actor)
}`,
})}

Related process: [[processes/code-review]] · Onboarding: [[engineering/onboarding]]
`,

  "engineering/search.md": `---
title: Search & indexing
tags: [engineering, search, fts]
status: published
owner: eng-platform
---

Full-text search uses **SQLite FTS5** (BM25 ranking). Optional **hybrid search** blends FTS with vector similarity when \`[search.vector]\` is enabled in \`.kiwi/config.toml\`.

## Index lifecycle

1. **Startup** — walk \`*.md\`, tokenize body + frontmatter fields marked \`searchable: true\`.
2. **Write hook** — each successful PUT deletes old row, inserts new (path, title, headings, body text).
3. **Rebuild** — \`kiwifs rebuild-index\` or MCP \`rebuild_search_index\` — safe to run after restoring from git.

${chart({
  type: "bar",
  title: "Query latency p95 (local dev, 12k pages synthetic)",
  xKey: "mode",
  grid: true,
  legend: false,
  series: [{ key: "ms", name: "ms", color: "#0ea5e9" }],
  data: [
    { mode: "FTS only", ms: 8 },
    { mode: "Hybrid", ms: 22 },
    { mode: "Vector only", ms: 31 },
    { mode: "DQL TABLE", ms: 14 },
  ],
})}

## Wiki links {#wiki-links}

\`[[engineering/architecture]]\` and \`[[search#wiki-links|custom label]]\` are parsed at index time. The **graph view** stores directed edges; **backlinks** are the reverse index. Orphan detection flags pages with zero inbound links (excluding \`welcome.md\`).

${tabs([
  {
    label: "REST search",
    body: `\`\`\`bash
curl -s 'localhost:3333/api/kiwi/search?q=versioning+git' | jq '.results[:3]'
\`\`\``,
  },
  {
    label: "MCP",
    body: `\`\`\`json
{ "tool": "search", "arguments": { "query": "MCP tools list", "limit": 10 } }
\`\`\`
Agents should prefer \`search\` then \`read_file\` — not \`grep\` on the host filesystem when mounted via MCP.`,
  },
  {
    label: "DQL",
    body: `${queryTable('TABLE title, tags FROM "engineering/" WHERE title CONTAINS "search"')}`,
  },
])}

Trust-ranked results (when analytics enabled) deprioritize stale pages — see content health in main README. Versioning context: [[engineering/versioning]].
`,

  "engineering/versioning.md": `---
title: Git versioning
tags: [engineering, git, audit]
status: published
owner: eng-platform
---

Every mutating API call creates an **atomic git commit** in the workspace repo (\`.git/\` beside markdown). Read APIs never commit. Actor identity comes from \`X-Actor\` (REST/MCP) or OS user (CLI default).

## What gets recorded

| Field | Source |
|-------|--------|
| Author | \`X-Actor\` or config default |
| Message | Auto: \`write path/to/file.md\` or user-supplied |
| Parent | Current \`HEAD\` |
| Diff | Unified diff of file content |

${mermaid(`sequenceDiagram
  participant UI as Wiki UI
  participant API as KiwiFS
  participant Git as .git

  UI->>API: Save page (If-Match etag)
  API->>Git: commit blob
  Git-->>API: sha abc123
  API-->>UI: new etag + version id

  UI->>API: History / blame
  API->>Git: log -- path
  Git-->>UI: commits with actors`)}

## Restore & compare

- **Point-in-time** — MCP \`restore_version\` or UI history drawer.
- **Blame** — per-line last actor from \`git blame\` (CodeMirror gutter in editor).
- **Conflict** — optimistic locking via \`If-Match\`; 412 returns server copy.

${diff({
  title: "Example page edit (onboarding checklist)",
  language: "markdown",
  before: `- [ ] Clone kiwifs/kiwifs
- [ ] Run \`make ui-dev\``,
  after: `- [x] Clone kiwifs/kiwifs
- [x] Run \`make ui-dev\`
- [ ] Ship first doc PR via [[processes/code-review]]`,
})}

Releases tag the binary, not individual wiki commits — but production wiki content is promoted via git branches per [[processes/releases]]. Architecture: [[engineering/architecture]].
`,

  "engineering/mcp-tools.md": `---
title: MCP tools for agents
tags: [engineering, mcp, agents]
status: published
owner: eng-platform
---

KiwiFS exposes **62 MCP tools** over stdio (\`kiwifs mcp --root ./wiki\`) or HTTP (\`/mcp\` on cloud workspaces). Tools mirror REST capabilities — agents should not bypass the API when MCP is available.

## Tool categories

${columns("1:1", [
  `| Category | Examples |
|----------|----------|
| Files | \`read_file\`, \`write_file\`, \`delete_file\`, \`list_directory\` |
| Search | \`search\`, \`query\` (DQL), \`get_backlinks\` |
| Graph | \`get_graph\`, \`get_links\` |
| Versioning | \`list_versions\`, \`get_diff\`, \`restore_version\` |
| Workflows | \`list_workflows\`, \`move_card\` |
| Admin | \`rebuild_search_index\`, \`lint_workspace\` |`,
  `### Cursor config snippet

\`\`\`json
{
  "mcpServers": {
    "kiwifs-wiki": {
      "command": "kiwifs",
      "args": ["mcp", "--root", "/path/to/this/wiki"]
    }
  }
}
\`\`\`

Cloud: use \`url\` + bearer token from dashboard — see cloud README.`,
])}

${playground({
  title: "Common agent flows",
  widgets: [
    "search → read_file → write_file (doc update loop)",
    "query TABLE → get_backlinks (impact analysis)",
    "list_versions → get_diff (audit before restore)",
  ],
})}

## Guidelines for wiki edits via MCP

1. **Read before write** — fetch current etag; include in write if supported.
2. **Use wiki links** — preserves [[engineering/architecture|graph connectivity]].
3. **Actor header** — set identifiable agent name (\`cursor-lena\`, not \`anonymous\`).
4. **Schema** — frontmatter must match \`.kiwi/schemas/*.json\` when validation is on.

Dogfood example: this page was last updated by \`cursor-agent\` in staging. Search details: [[engineering/search]] · Review gate: [[processes/code-review]].

${kiwiApp(180, `<div style="font-family:system-ui;padding:12px">
  <div style="font-size:11px;text-transform:uppercase;color:#64748b;letter-spacing:.06em">MCP tools online</div>
  <div style="font-size:32px;font-weight:700;color:#84cc16">62</div>
  <div style="font-size:13px;color:#475569">stdio + HTTP on cloud workspaces</div>
</div>`)}
`,

  "engineering/onboarding.md": `---
title: Engineering onboarding
tags: [engineering, people, onboarding]
status: published
owner: eng-platform
---

Welcome — you'll touch Go (\`cmd/\`, \`internal/\`), TypeScript (\`ui/src/\`), and this wiki on day one.

## Week-one checklist

- [ ] Get GitHub access to \`kiwifs/kiwifs\` and \`kiwifs/cloud\`
- [ ] Install toolchain: Go 1.25+, Node 22+, \`make deps\`
- [ ] Clone and run locally:
  \`\`\`bash
  git clone git@github.com:kiwifs/kiwifs.git
  cd kiwifs && make ui-dev   # :3333 UI + hot reload
  \`\`\`
- [ ] Read [[engineering/architecture]] (30 min)
- [ ] Skim [[engineering/search]] and [[engineering/versioning]]
- [ ] Connect Cursor MCP to your local wiki root (see [[engineering/mcp-tools]])
- [ ] Pick a **good first issue** — label \`help wanted\`
- [ ] Shadow one [[processes/code-review|code review]] before opening your first PR
- [ ] Add yourself to \`#eng-kiwifs\` Slack

${progress({
  type: "gauge",
  title: "Typical ramp (self-reported)",
  showPercent: true,
  items: [
    { label: "Run serve + UI", value: 100 },
    { label: "First doc PR", value: 85 },
    { label: "First Go PR", value: 60 },
    { label: "On-call shadow", value: 40 },
  ],
})}

## Key repos

| Repo | Purpose |
|------|---------|
| \`kiwifs/kiwifs\` | Core binary + embedded UI |
| \`kiwifs/cloud\` | Hosted workspaces (FastAPI + Next) |
| This wiki | Dogfood workspace — edit via UI or MCP |

${queryTable('TABLE title FROM "engineering/" SORT title ASC')}

Questions? Ping **#eng-kiwifs** or lena@ — update this page when tooling changes.
`,

  "processes/code-review.md": `---
title: Code review
tags: [process, quality]
status: published
owner: eng-platform
---

Every change lands as a **git commit** (see [[engineering/versioning]]). PRs to \`kiwifs/kiwifs\` require one approval from a maintainer; docs-only wiki PRs can self-merge after CI green.

## Reviewer checklist

1. **Correctness** — tests cover behavior; no silent index corruption paths.
2. **Storage layer** — mutations go through \`pkg/storage\`, not ad-hoc filesystem writes.
3. **API compat** — REST + MCP stay in sync (check \`docs/API.md\`).
4. **UI** — Storybook snapshot or manual note for visual changes.
5. **Docs** — user-facing behavior → update docs or this wiki.

${tabs([
  {
    label: "Go",
    body: `- Run \`make test\` and \`make lint\`
- Prefer context-aware APIs; thread \`X-Actor\` into storage
- No new global mutable state in \`internal/\``,
  },
  {
    label: "TypeScript",
    body: `- \`npm run check\` in \`ui/\`
- API types live in \`ui/src/lib/api.ts\` — update mocks if shapes change
- Keep demo templates in sync (\`ui/src/demo/\`)`,
  },
  {
    label: "Docs / wiki",
    body: `- Wiki links over raw URLs
- Frontmatter \`status: published\` only when reviewed
- Behavior changes → [[decisions/README|ADR]] if architectural`,
  },
])}

> [!TIP]
> Link related ADRs in PR description. Example: git-as-source-of-truth → [[decisions/001-git-source-of-truth]].

Release cadence: [[processes/releases]] · Architecture context: [[engineering/architecture]].
`,

  "processes/releases.md": `---
title: Release process
tags: [process, release]
status: published
owner: eng-platform
---

KiwiFS ships **semver** tags on \`kiwifs/kiwifs\`. Cloud deploys track tagged releases after smoke tests.

## Release train

${mermaid(`graph TD
  A[main green CI] --> B{Release captain}
  B --> C[Version bump CHANGELOG]
  C --> D[Tag vX.Y.Z]
  D --> E[GitHub release + binaries]
  E --> F[Docker :latest]
  F --> G[Cloud staging deploy]
  G --> H{Smoke OK?}
  H -->|Yes| I[Cloud production]
  H -->|No| J[Rollback tag]`)}

| Step | Owner | Artifact |
|------|-------|----------|
| Freeze | Release captain | Slack #releases thread |
| Changelog | Contributor | \`CHANGELOG.md\` section |
| Binaries | CI | darwin/linux amd64 + arm64 |
| npm \`@kiwifs/mcp\` | Platform | Separate publish job |
| Wiki | Any engineer | [[processes/code-review|Reviewed]] updates to [[engineering/architecture]] etc. |

${chart({
  type: "line",
  title: "Weekly download trend (GitHub releases)",
  xKey: "week",
  series: [{ key: "downloads", name: "Downloads (k)", color: "#84cc16" }],
  data: [
    { week: "W20", downloads: 12 },
    { week: "W21", downloads: 18 },
    { week: "W22", downloads: 24 },
    { week: "W23", downloads: 31 },
    { week: "W24", downloads: 28 },
  ],
})}

Hotfix path: branch from tag, patch, \`vX.Y.Z+1\`, skip feature freeze. MCP breaking changes require minor bump and [[engineering/mcp-tools]] doc refresh.
`,

  "decisions/README.md": `---
title: Architecture Decision Records
tags: [decisions, adr]
status: published
owner: eng-platform
---

We document significant technical choices as **ADRs** — one markdown file per decision, numbered sequentially under \`decisions/\`.

## Template

\`\`\`markdown
# ADR-NNN: Title

## Status
Proposed | Accepted | Deprecated

## Context
What problem forced a decision?

## Decision
What we chose.

## Consequences
Tradeoffs, follow-ups, links.
\`\`\`

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [001](001-git-source-of-truth.md) | Git as source of truth | Accepted |
| — | (your ADR) | Proposed |

${queryTable('TABLE title, status FROM "decisions/" WHERE title != "Architecture Decision Records"')}

When to write an ADR: cross-cutting infra, irreversible schema, protocol changes. Routine bugfixes need not. Review via [[processes/code-review]].
`,

  "decisions/001-git-source-of-truth.md": `---
title: "ADR-001: Git as source of truth"
tags: [decisions, adr, git]
status: accepted
date: 2025-11-04
deciders: [lena, sam, devon]
---

## Status

**Accepted** — implements [[engineering/versioning]].

## Context

Agents and humans both write markdown. We needed auditability without running a separate database of record. Teams already trust git for code; wiki content benefits from the same blame, diff, and branch workflows.

## Decision

- Every KiwiFS write → atomic git commit in workspace repo.
- Search indexes, vector chunks, and link graphs are **derived** and rebuildable.
- \`kiwifs rebuild-index\` must succeed from a fresh clone + files only.

## Consequences

**Pros:** Point-in-time restore, familiar tooling, offline clone = full backup.

**Cons:** Large binary assets need LFS (out of scope for core); very chatty agents create noisy history — mitigate with squash policy on import branches.

**Follow-ups:** Documented in [[engineering/architecture]] and MCP \`list_versions\`.

## Links

- [[engineering/versioning]]
- [[processes/releases]]
- [[decisions/README]]
`,
};

export const wikiMock = {
  graphNodes: [
    { path: "welcome.md", tags: ["home"] },
    { path: "engineering/architecture.md", tags: ["architecture", "published"] },
    { path: "engineering/search.md", tags: ["search", "published"] },
    { path: "engineering/versioning.md", tags: ["git", "published"] },
    { path: "engineering/mcp-tools.md", tags: ["mcp", "published"] },
    { path: "engineering/onboarding.md", tags: ["people", "published"] },
    { path: "processes/code-review.md", tags: ["process"] },
    { path: "processes/releases.md", tags: ["process", "release"] },
    { path: "decisions/README.md", tags: ["adr"] },
    { path: "decisions/001-git-source-of-truth.md", tags: ["adr", "accepted"] },
  ],
  graphEdges: [
    { source: "welcome.md", target: "engineering/onboarding.md" },
    { source: "welcome.md", target: "engineering/architecture.md" },
    { source: "engineering/onboarding.md", target: "engineering/architecture.md" },
    { source: "engineering/onboarding.md", target: "engineering/search.md" },
    { source: "engineering/onboarding.md", target: "engineering/versioning.md" },
    { source: "engineering/onboarding.md", target: "engineering/mcp-tools.md" },
    { source: "engineering/onboarding.md", target: "processes/code-review.md" },
    { source: "engineering/architecture.md", target: "engineering/search.md" },
    { source: "engineering/architecture.md", target: "engineering/versioning.md" },
    { source: "engineering/architecture.md", target: "engineering/mcp-tools.md" },
    { source: "engineering/architecture.md", target: "processes/code-review.md" },
    { source: "engineering/search.md", target: "engineering/versioning.md" },
    { source: "engineering/mcp-tools.md", target: "engineering/search.md" },
    { source: "engineering/mcp-tools.md", target: "processes/code-review.md" },
    { source: "engineering/versioning.md", target: "processes/releases.md" },
    { source: "processes/code-review.md", target: "decisions/README.md" },
    { source: "processes/code-review.md", target: "decisions/001-git-source-of-truth.md" },
    { source: "processes/releases.md", target: "engineering/architecture.md" },
    { source: "processes/releases.md", target: "engineering/mcp-tools.md" },
    { source: "decisions/README.md", target: "decisions/001-git-source-of-truth.md" },
    { source: "decisions/001-git-source-of-truth.md", target: "engineering/versioning.md" },
    { source: "decisions/001-git-source-of-truth.md", target: "engineering/architecture.md" },
  ],
  searchResults: demoSearch([
    { path: "engineering/architecture.md", score: 0.97, snippet: "...single Go binary: markdown files on disk are the <mark>source of truth</mark>..." },
    { path: "engineering/search.md", score: 0.91, snippet: "...<mark>FTS5</mark> (BM25 ranking). Optional hybrid search..." },
    { path: "engineering/mcp-tools.md", score: 0.88, snippet: "...exposes <mark>62 MCP tools</mark> over stdio..." },
    { path: "engineering/versioning.md", score: 0.85, snippet: "...Every mutating API call creates an <mark>atomic git commit</mark>..." },
    { path: "decisions/001-git-source-of-truth.md", score: 0.79, snippet: "...Search indexes are <mark>derived</mark> and rebuildable..." },
  ]),
  backlinks: demoBacklinks([
    { path: "engineering/architecture.md", count: 8 },
    { path: "engineering/onboarding.md", count: 1 },
    { path: "engineering/versioning.md", count: 5 },
    { path: "processes/code-review.md", count: 4 },
    { path: "decisions/README.md", count: 2 },
  ]),
  comments: demoComments("engineering/architecture.md", [
    {
      id: "wc1",
      anchor: { quote: "go:embed", prefix: "UI is embedded via ", suffix: " — no separate" },
      body: "Should we mention the ui/build copy step in Makefile targets?",
      author: "sam",
      createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
      resolved: false,
    },
    {
      id: "wc2",
      anchor: { quote: "sequenceDiagram", prefix: "", suffix: " participant Client" },
      body: "Added sequence diagram — looks good for onboarding.",
      author: "lena",
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      resolved: true,
    },
  ]),
  queryRows: [
    { _path: "engineering/architecture.md", title: "Architecture overview", tags: "engineering, architecture", status: "published" },
    { _path: "engineering/search.md", title: "Search & indexing", tags: "engineering, search, fts", status: "published" },
    { _path: "engineering/versioning.md", title: "Git versioning", tags: "engineering, git, audit", status: "published" },
    { _path: "engineering/mcp-tools.md", title: "MCP tools for agents", tags: "engineering, mcp, agents", status: "published" },
    { _path: "engineering/onboarding.md", title: "Engineering onboarding", tags: "engineering, people, onboarding", status: "published" },
  ],
  metaResults: [
    { path: "engineering/architecture.md", frontmatter: { title: "Architecture overview", status: "published", tags: ["engineering", "architecture"] } },
    { path: "decisions/001-git-source-of-truth.md", frontmatter: { title: "ADR-001: Git as source of truth", status: "accepted", date: "2025-11-04" } },
  ],
  timelineEvents: [
    { type: "write", path: "engineering/architecture.md", title: "Architecture overview", actor: "lena", timestamp: new Date(Date.now() - 7200000).toISOString(), message: "Add MCP sequence diagram" },
    { type: "write", path: "engineering/mcp-tools.md", title: "MCP tools for agents", actor: "sam", timestamp: new Date(Date.now() - 86400000 * 2).toISOString(), message: "Document 62 tools" },
    { type: "write", path: "processes/code-review.md", title: "Code review", actor: "devon", timestamp: new Date(Date.now() - 86400000 * 5).toISOString(), message: "Link ADR pattern" },
    { type: "write", path: "decisions/001-git-source-of-truth.md", title: "ADR-001", actor: "lena", timestamp: new Date(Date.now() - 86400000 * 30).toISOString(), message: "Accepted" },
  ],
  versions: demoVersions([
    { hash: "abc123", author: "lena", message: "Add MCP sequence diagram", date: new Date(Date.now() - 7200000).toISOString() },
    { hash: "def456", author: "sam", message: "Storage layer table", date: new Date(Date.now() - 86400000 * 10).toISOString() },
  ]),
};
