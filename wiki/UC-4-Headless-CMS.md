# UC-4: Headless CMS

**Label:** [`uc:headless-cms`](https://github.com/kiwifs/kiwifs/labels/uc%3Aheadless-cms)

**Live demo:** [demo.kiwifs.com/cms](https://demo.kiwifs.com/cms/)

## Thesis

KiwiFS stores content as markdown with YAML frontmatter, versions every write via git, and exposes 80+ REST endpoints. With targeted additions it becomes a git-based headless CMS — like Decap/TinaCMS for the content model, but with the programmability of Strapi and zero external database.

## Features

| Feature | Status | Location |
|---------|--------|----------|
| Publish/unpublish API (`published: true` frontmatter) | ✅ | `internal/api/handlers_publish.go` |
| Public reader at `/p/*` (server-rendered HTML) | ✅ | `internal/api/handlers_reader.go` |
| Content negotiation on `/p/*` (`Accept`: HTML, markdown, JSON) | ✅ | `internal/api/accept.go`, `handlers_reader.go` |
| REST file CRUD, search, metadata queries, DQL | ✅ | `internal/api/` |
| Export to JSONL, CSV, Parquet, HTML, PDF, slides, MkDocs | ✅ | `internal/exporter/`, `internal/docexport/` |
| Atom/JSON feed syndication with `published_at` timestamps | ✅ | `internal/api/handlers_feed.go` |
| Webhooks with HMAC signing and retry | ✅ | `internal/webhooks/` |
| Export webhook flag (`kiwifs export --webhook`) | ✅ | `internal/exporter/` |
| JSON Schema validation on writes | ✅ | `internal/schema/` |
| Multi-space support | ✅ | `internal/spaces/` |
| Git versioning (audit trail) | ✅ | `internal/versioning/` |
| Permalinks and `public_url` config | ✅ | `internal/api/` |
| Published page visibility + status badges in tree | ✅ | `ui/src/components/KiwiTree.tsx` |
| OpenAPI 3.0 spec at `/api/openapi.json` | ✅ | `internal/api/` |

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

## Public reader content negotiation

Published pages at `GET /p/{path}` support `Accept` header negotiation for headless CMS consumers:

| `Accept` header | Response |
|---|---|
| *(omitted)* / `text/html` / `*/*` | Server-rendered HTML page (default) |
| `text/markdown` | Raw file source including YAML frontmatter |
| `application/json` | `{ "frontmatter": {...}, "html": "...", "markdown": "..." }` |

Examples:

```bash
# Default HTML
curl -sS https://example.kiwifs.com/p/docs/guide.md

# Raw markdown for static site generators
curl -sS -H 'Accept: text/markdown' https://example.kiwifs.com/p/docs/guide.md

# Structured payload for headless frontends
curl -sS -H 'Accept: application/json' https://example.kiwifs.com/p/docs/guide.md
```

Unsupported `Accept` values (for example `image/png`) return **406 Not Acceptable** with an `Accept` response header listing supported formats. Malformed headers containing CR/LF injection attempts return **400 Bad Request**.

## What's Missing

| Gap | Why it matters | Industry reference |
|-----|---------------|-------------------|
| GraphQL API | Next.js/Gatsby ecosystem expects GraphQL for content queries | Strapi GraphQL, TinaCMS |
| Draft → review → published workflow | Enforced editorial state machine, not just git branches | TinaCMS branch workflows |
| Preview URLs | Shareable draft preview links for reviewers | TinaCMS visual editing |
| Schema-driven form UI | Auto-generate editor forms from JSON Schema definitions | Strapi content type builder |
| Content SDK | Typed JS/TS client for frontend consumers | Ghost Content API SDKs |
| CDN / image optimization | Asset pipeline for production content sites | Ghost image optimization |
| i18n / localization | Multi-language content support | Strapi i18n plugin |

## Proposed Milestones

1. **Editorial workflow enforcement** — Wire existing workflow engine + drafts into `draft → review → published`. Add `GET /api/preview/{draft-id}`.
2. **Schema-driven forms** — Auto-generate editor form fields from JSON Schema definitions in the UI.
3. **Content SDK** — Publish `@kiwifs/client` wrapping the REST API with typed methods.

## Good First Issues

See the [Good First Issues](Good-First-Issues) page for issues tagged `uc:headless-cms`.
