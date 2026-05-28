# Contributing to KiwiFS

Thanks for your interest in contributing! This page supplements the [in-repo CONTRIBUTING.md](https://github.com/kiwifs/kiwifs/blob/main/CONTRIBUTING.md) with roadmap-specific guidance.

## Quick Start

```bash
git clone https://github.com/kiwifs/kiwifs.git
cd kiwifs

# Build the frontend
cd ui && npm install && npm run build && cd ..

# Run the server
go run . serve --root ./knowledge --port 3333

# Run tests
go test ./... -race
```

**Prerequisites:** Go 1.25+, Node.js 20+, Git

## Finding Work

1. **Browse [Good First Issues](Good-First-Issues)** — scoped tasks with context, relevant code links, and test guidance
2. **Filter by label** on GitHub:
   - [`good first issue`](https://github.com/kiwifs/kiwifs/labels/good%20first%20issue) — all beginner-friendly tasks
   - [`help wanted`](https://github.com/kiwifs/kiwifs/labels/help%20wanted) — tasks where help is welcome (may be harder)
   - Use case labels: [`uc:task-orchestration`](https://github.com/kiwifs/kiwifs/labels/uc%3Atask-orchestration), [`uc:team-wiki`](https://github.com/kiwifs/kiwifs/labels/uc%3Ateam-wiki), [`uc:data-query`](https://github.com/kiwifs/kiwifs/labels/uc%3Adata-query), [`uc:headless-cms`](https://github.com/kiwifs/kiwifs/labels/uc%3Aheadless-cms)
   - Area labels: `area:frontend`, `area:backend`, `area:mcp`, `area:dql`, `area:docs`, `area:infra`
3. **Check the [Roadmap](Roadmap)** for larger efforts you can contribute to

## How to Claim an Issue

1. **Comment on the issue** with a brief plan (1–2 sentences on your approach)
2. We'll respond within 48 hours with feedback and assign you
3. If you don't hear back, go ahead and start — we'll review your PR

Following [Kubernetes contributor guidelines](https://www.kubernetes.dev/docs/guide/help-wanted/): issues labeled `good first issue` get extra attention from maintainers to help you through the process.

## Submitting a Pull Request

1. Fork the repo and create a branch from `main`
2. Make your changes. **Add tests** if you're touching backend code
3. Run `go test ./... -race` and `go vet ./...`
4. Open a PR referencing the issue number
5. Describe what you changed and why (not just what files you touched)

## Code Style

- **Go:** standard `gofmt`, `go vet`
- **TypeScript:** Prettier defaults, Tailwind for styling
- **Commits:** short summary, present tense ("Add search endpoint", not "Added search endpoint")

## Project Structure

```
kiwifs/
├── cmd/              # CLI commands
├── internal/         # All backend packages (~40 subpackages)
│   ├── api/          # REST API handlers
│   ├── dataview/     # DQL parser and query engine
│   ├── mcpserver/    # MCP server (62 tools)
│   ├── workflow/     # Workflow engine
│   ├── claims/       # Task claim system
│   ├── search/       # FTS5 + metadata index
│   ├── importer/     # 18+ data source importers
│   └── ...
├── pkg/kiwi/         # Public Go library
├── ui/               # React + TypeScript + shadcn/ui
│   └── src/components/
│       ├── KiwiKanban.tsx
│       ├── KiwiTree.tsx
│       ├── KiwiPage.tsx
│       └── ...
└── knowledge/        # Sample knowledge base
```

## Areas Where Help Is Especially Welcome

- **Testing** — integration tests for MCP tools, NFS/S3/WebDAV protocols
- **Documentation** — usage guides, examples, config reference
- **Frontend** — UI polish, accessibility, Storybook stories
- **Search** — FTS5 ranking improvements, vector search UX
- **Importers** — testing and improving import fidelity

## License

By contributing, you agree that your contributions will be licensed under the [Business Source License 1.1](https://github.com/kiwifs/kiwifs/blob/main/LICENSE). Contributions convert to Apache 2.0 along with the rest of the codebase per the BSL terms.
