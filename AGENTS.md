# AGENTS.md

Instructions for AI agents (Codex, Claude Code, Cursor, etc.) working in this repository.

## Project Overview

KiwiFS is a single Go binary that turns a folder of markdown files into a searchable, versioned, multi-protocol knowledge server with an embedded React web UI. Files on disk are the source of truth; indexes are rebuildable derivatives.

**Tech stack:** Go 1.27+ (backend), React 19 + TypeScript + Vite + Tailwind 4 + shadcn/ui (frontend), SQLite FTS5 (search), Git (versioning).

## Repository Structure

```
kiwifs/
|-- cmd/              # Cobra CLI commands (serve, init, mcp, query, import, export, widgets, ...)
|-- internal/         # All backend packages (~40 subpackages)
|   |-- api/          # REST API handlers (Echo framework)
|   |-- bootstrap/    # Dependency wiring
|   |-- pipeline/     # Write pipeline (storage -> git -> index -> SSE)
|   |-- search/       # grep + SQLite FTS5 + metadata index
|   |-- storage/      # Filesystem abstraction
|   |-- vectorstore/  # Pluggable vector search backends
|   |-- versioning/   # Git, copy-on-write, noop
|   |-- mcpserver/    # MCP server (78 tools)
|   |-- dataview/     # DQL parser and query engine (Pratt parser)
|   |-- workflow/     # Workflow state machine engine
|   |-- claims/       # Task claim system (path-level leases)
|   |-- importer/     # Data import from 19 sources + Airbyte protocol
|   |-- exporter/     # Export to JSONL/CSV/Parquet
|   |-- nfs/          # NFS server
|   |-- s3/           # S3-compatible API
|   |-- webdav/       # WebDAV server
|   |-- fuse/         # FUSE client
|   `-- ...
|-- pkg/kiwi/         # Public Go embed library
|-- ui/               # React frontend (embedded in binary via go:embed)
|   `-- src/
|       |-- components/   # React components
|       |-- lib/          # Utilities and API client
|       `-- App.tsx       # Main app with routing
|-- knowledge/        # Default knowledge base template
|-- docs/             # Project documentation
|-- tests/            # Integration tests
`-- main.go           # Entry point
```

## Build & Run

```bash
# Full build (UI + Go binary)
make build

# Go binary only (when UI hasn't changed)
make go-build

# Run dev server
make dev                # Go backend on :3333
make dev-ui             # Vite dev server (UI HMR)

# Build just the UI
make ui
```

## Testing

```bash
# Run all Go tests
go test ./... -race

# Run Go tests for a specific package
go test ./internal/dataview/... -race

# Run UI tests
cd ui && npm test

# Lint
go vet ./...
```

All PRs must pass the `test` CI check (go vet, go test, UI build) before merge.

## Code Style

- **Go:** `gofmt` formatting, `go vet` linting. No additional linter config.
- **TypeScript:** Prettier defaults. Tailwind for styling. shadcn/ui components.
- **Commits:** short summary, present tense ("Add search endpoint", not "Added search endpoint").
- **No narrating comments.** Don't add comments that just describe what the code does. Comments should explain non-obvious intent, trade-offs, or constraints.

## Architecture Principles

1. **Files are source of truth.** Every artifact is a plain markdown file. Indexes are derivative.
2. **All writes go through the pipeline.** Storage -> Git commit -> Index update -> SSE broadcast. The write pipeline uses a single mutex for serialization.
3. **Optimistic concurrency.** HTTP ETags (git blob hash) for conflict detection. `If-Match` header on writes; 409 on conflict.
4. **Storage-agnostic.** KiwiFS depends on `open()`, `read()`, `write()`, `listdir()`. Works on local disk, NFS, EFS, FUSE-S3.
5. **Search is three-tier.** grep (zero deps) -> FTS5/BM25 (default) -> vector (pluggable embedder + store).

## Key Patterns

- **REST handlers** are in `internal/api/handlers*.go`, registered in `internal/api/server.go`.
- **MCP tools** are registered in `internal/mcpserver/mcpserver.go` (78 tools: 70
  there + 2 in memory_tools.go + 1 in widget_tools.go + 5 in refactor_tools.go).
  `TestToolCountMatchesTheDocs` fails when that number drifts from this file.
- **Widget fences** (` ```array `, ` ```tree `, …) are declared once in
  `ui/src/fences/specs/*.ts`. `make ui` regenerates
  `internal/markdown/fenceschemas/fences.json` from them, which the Go linter
  embeds and `kiwi_widget_reference` serves; CI fails if it drifts. Adding a
  widget means adding a spec, not touching the renderer.
- **kiwi-app** blocks (sandboxed HTML) get a kit stylesheet
  (`ui/src/components/kiwiApp/kit.css`) and a `kiwi` runtime
  (`ui/src/components/kiwiApp/runtime.js`). When writing an app, use the `k-`
  classes and tokens instead of hand-rolled CSS, and `kiwi.steps({count,
  onStep})` instead of your own step counter, so the app gets keyboard
  control, deep links and shared clocks. Reference: `docs/APPS.md`.
- **DQL queries** go through the Pratt parser in `internal/dataview/parser.go` and evaluator in `internal/dataview/evaluator.go`.
- **Workflows** are JSON state machines in `.kiwi/workflows/*.json`, managed by `internal/workflow/`.
- **UI state** uses React context + localStorage. No global state library.
- The frontend expects the API at the same origin (proxied in dev via Vite config).

## What NOT To Do

- Don't bypass the write pipeline. All file mutations must go through `internal/pipeline/`.
- Don't hand-edit `internal/markdown/fenceschemas/fences.json` or `docs/WIDGETS.md`;
  both are generated. Edit the spec in `ui/src/fences/specs/` and run
  `cd ui && npm run emit-schemas`.
- Don't add CGo dependencies. The SQLite driver (`modernc.org/sqlite`) is pure Go by design.
- Don't commit `.kiwi/state/` files — they're derivative and rebuildable via `kiwifs reindex`.
- Don't use `internal/` packages from outside the module. Use `pkg/kiwi/` for embedding.
