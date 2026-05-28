# UC-4: Headless CMS

**Label:** [`uc:headless-cms`](https://github.com/kiwifs/kiwifs/labels/uc%3Aheadless-cms)

## Thesis

KiwiFS stores content as markdown with YAML frontmatter, versions every write via git, and exposes 80+ REST endpoints. With targeted additions it becomes a git-based headless CMS — like Decap/TinaCMS for the content model, but with the programmability of Strapi and zero external database.

## What Already Exists

| Feature | Status | Location |
|---------|--------|----------|
| Publish/unpublish API (`published: true` frontmatter) | ✅ | `internal/api/handlers_publish.go` |
| Public reader at `/p/*` (server-rendered HTML) | ✅ | `internal/api/handlers_reader.go` |
| REST file CRUD, search, metadata queries, DQL | ✅ | `internal/api/` |
| Export to JSONL, CSV, Parquet, HTML, PDF, slides, static site | ✅ | `internal/exporter/`, `internal/docexport/` |
| Atom/JSON feed syndication | ✅ | `internal/api/handlers_feed.go` |
| Webhooks with HMAC signing and retry | ✅ | `internal/webhooks/` |
| JSON Schema validation on writes | ✅ | `internal/schema/` |
| Multi-space support | ✅ | `internal/spaces/` |
| Git versioning (audit trail) | ✅ | `internal/versioning/` |
| Permalinks and `public_url` config | ✅ | `internal/api/` |

## Industry Comparison

| Feature | Strapi | Decap CMS | TinaCMS | Ghost | KiwiFS |
|---------|--------|-----------|---------|-------|--------|
| Content API (REST) | ✅ | ❌ (git commits) | ✅ | ✅ | ✅ |
| GraphQL | ✅ | ❌ | ✅ | ✅ | ❌ |
| Content type builder UI | ✅ | YAML config | TypeScript schema | ✅ | JSON Schema (no UI) |
| Git-native versioning | ❌ | ✅ | ✅ | ❌ | ✅ |
| Editorial workflow | Plugin | Branch-based | Branch-based | Built-in | Partial (drafts exist) |
| Live preview | ❌ | ❌ | ✅ (visual editing) | ✅ | ❌ |
| Self-hosted | ✅ (Node + DB) | ✅ (static) | ✅ (Node) | ✅ (Node) | ✅ (single binary) |
| Search | Plugin | ❌ | ❌ | Basic | FTS5 + vector + DQL |
| Agent integration | ❌ | ❌ | ❌ | ❌ | 62 MCP tools |

**KiwiFS's unique positioning:** Single binary, zero config, git-native, with the strongest search/query layer of any CMS. No database to manage — the filesystem is the database.

## What's Missing

| Gap | Why it matters | Industry reference |
|-----|---------------|-------------------|
| Content delivery API | Consumers need `GET /api/content/{path}` returning rendered HTML + structured frontmatter | Strapi Content API |
| GraphQL API | Next.js/Gatsby ecosystem expects GraphQL for content queries | Strapi GraphQL, TinaCMS |
| Draft → review → published workflow | Enforced editorial state machine, not just git branches | TinaCMS branch workflows |
| Preview URLs | Shareable draft preview links for reviewers | TinaCMS visual editing |
| Schema-driven form UI | Auto-generate editor forms from JSON Schema definitions | Strapi content type builder |
| Content SDK | Typed JS/TS client for frontend consumers | Ghost Content API SDKs |
| CDN / image optimization | Asset pipeline for production content sites | Ghost image optimization |
| i18n / localization | Multi-language content support | Strapi i18n plugin |

## Proposed Milestones

1. **Content delivery API** — `GET /api/content/{path}` returning rendered HTML + structured frontmatter. Optionally add GraphQL via code-generated schema from `.kiwi/schemas/`.
2. **Editorial workflow enforcement** — Wire existing workflow engine + drafts into `draft → review → published`. Add `GET /api/preview/{draft-id}`.
3. **Schema-driven forms** — Auto-generate editor form fields from JSON Schema definitions in the UI.
4. **Content SDK** — Publish `@kiwifs/client` wrapping the REST API with typed methods.
5. **Publish event webhooks** — Extend webhooks to fire on publish/unpublish transitions for static site rebuilds (Vercel/Netlify deploy hooks).

## Good First Issues

See the [Good First Issues](Good-First-Issues) page for issues tagged `uc:headless-cms`.
