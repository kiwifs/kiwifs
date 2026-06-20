# UC-1: Knowledge Base

**Label:** [`uc:knowledge-base`](https://github.com/kiwifs/kiwifs/labels/uc%3Aknowledge-base)

## Thesis

Every team above 10 people hits the same wall: answers live in Slack threads, Google Docs, and tribal memory. A knowledge base is the cure — a curated, searchable, governed repository where answers are written once and consumed many times. The industry (Zendesk, Document360, Guru, Slite, HelpCenter.io) distinguishes knowledge bases from wikis by three properties: **editorial governance** (content is reviewed, verified, and owned), **structured article types** (how-to, troubleshooting, FAQ, reference), and **audience awareness** (internal vs. external, with different tone, access, and analytics).

KiwiFS already has the building blocks — search, frontmatter, schemas, workflows, publishing, share links, content health janitor. The `kb` template scaffolds the knowledge base pattern with proper categories, article-type conventions, verification workflows, and deflection analytics. Unlike a wiki (open editing, freeform), a knowledge base enforces structure and freshness so answers stay trustworthy.

## Features

| Feature | Status | Location |
|---------|--------|----------|
| Category-based folder structure (5-8 top-level by user goal) | ✅ | `internal/workspace/templates/kb/` |
| Article-type JSON schemas (how-to, troubleshooting, FAQ, reference) | ✅ | `internal/schema/` |
| Verification workflow (`draft → review → verified → stale → archived`) | ✅ | `internal/workflow/` |
| `verified_at` + `review_interval` freshness enforcement | ✅ | `internal/janitor/` |
| Content ownership (`owner` frontmatter) | ✅ | Every `.md` file |
| Full-text search (FTS5/BM25) | ✅ | `internal/search/` |
| Semantic/vector search | ✅ | `internal/vectorstore/` |
| DQL queries over article metadata | ✅ | `internal/dataview/` |
| Publishing for external KB (`published: true` + public reader `/p/*`) | ✅ | `internal/api/handlers_publish.go` |
| Content negotiation (HTML, markdown, JSON) on `/p/*` | ✅ | `internal/api/handlers_reader.go` |
| Atom/JSON feed syndication | ✅ | `internal/api/handlers_feed.go` |
| Page view analytics | ✅ | `internal/search/` (analytics tables) |
| Content health janitor (stale, orphan, broken links, duplicates) | ✅ | `internal/janitor/` |
| Inline comments for review feedback | ✅ | `internal/comments/` |
| MCP tools for agent-powered KB maintenance | ✅ | `internal/mcpserver/` (62 tools) |
| Password-protected share links | ✅ | `internal/api/handlers_share.go` |
| Wiki links + backlinks + graph view | ✅ | `internal/links/` |
| Git versioning (every edit tracked, blame, diff, restore) | ✅ | `internal/versioning/` |
| `kiwifs check` for CI-friendly validation | ✅ | `cmd/check.go` |
| Multi-space (separate KBs per product/team) | ✅ | `internal/spaces/` |

## Article Types

The knowledge base enforces four core article types via JSON Schema:

| Type | Purpose | Structure |
|------|---------|-----------|
| **How-to** | Step-by-step task completion | Prerequisites → Steps (numbered) → Verification → Troubleshooting |
| **Troubleshooting** | Symptom-first problem resolution | Symptom → Possible Causes → Solutions (ordered by likelihood) → Escalation |
| **FAQ** | Direct answer to a conceptual question | Question (title) → Answer (2-3 paragraphs max) → Related links |
| **Reference** | Technical details, settings, limits | Overview → Fields/Parameters table → Examples → Constraints |

## Industry Comparison

| Feature | Zendesk Guide | Document360 | Guru | Slite | HelpCenter.io | KiwiFS |
|---------|---------------|-------------|------|-------|---------------|--------|
| Article types enforced | Categories | Templates | Cards | Free-form | AI-generated | JSON Schema + workflow |
| Verification workflow | ❌ | Workflows | Expert verification | Auto-verification | ❌ | Workflow state machine |
| Internal + External | ❌ (external) | Both | ❌ (internal) | ❌ (internal) | ❌ (external) | Both (publish toggle) |
| AI search | ✅ | ✅ | ✅ | ✅ (Ask Slite) | ✅ | FTS5 + vector + DQL |
| Self-hosted | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (single binary) |
| Agent-native (MCP) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (62 tools) |
| Version history | Revisions | Versions | Card history | Page history | ❌ | Git (blame, diff, restore) |
| Content health | Basic | ❌ | Stale alerts | AI suggestions | ❌ | Full janitor (orphan, stale, broken, duplicate) |
| Markdown-native | ❌ | Partial | ❌ | ❌ | ❌ | ✅ (source of truth) |
| Graph / backlinks | ❌ | ❌ | ❌ | ❌ | ❌ | Full (2D/3D, communities) |

**KiwiFS's unique positioning:** The only knowledge base that's self-hosted, markdown-native, agent-accessible via MCP, and supports both internal and external audiences from the same workspace. A support agent (human or AI) queries the KB via MCP; verified answers are published to customers via the same system.

## How It Differs From Wiki (UC-2)

| Dimension | Wiki | Knowledge Base |
|-----------|------|----------------|
| Editing model | Open — anyone edits freely | Governed — owners verify and approve |
| Content structure | Freeform pages, project-shaped | Categorized by user goal, article types enforced by schema |
| Audience | Internal team only | Internal OR external (customer-facing) |
| Tone | Inside-out, assumes context | Outside-in, no jargon, self-serve friendly |
| Analytics focus | Staleness, orphans | Deflection, search-no-results, engagement |
| Freshness model | `last-reviewed` (soft convention) | `verified_at` + `review_interval` (enforced via workflow) |
| Primary use | Collaboration, onboarding, project docs | Authoritative answers, support deflection, reference |

## What's Missing

| Gap | Why it matters | Industry reference |
|-----|---------------|-------------------|
| Search analytics (no-results tracking) | Know what users search for but can't find — drives content gap detection | Zendesk, Intercom |
| Feedback widget (helpful/not helpful) | Per-article quality signal without requiring comments | Every help center |
| Deflection rate metric | Prove KB value: "X% of users self-served without contacting support" | Zendesk, HelpCenter.io |
| Content gap suggestions | AI recommends articles to write based on failed searches and support tickets | Guru AI, Slite AI |
| Multi-language / i18n | Same article in multiple languages with locale switching | Document360, Zendesk |
| Custom branding on public reader | Logo, colors, domain for customer-facing KB | All external KB tools |

## Proposed Milestones

1. **`kb` template** — Ship `internal/workspace/templates/kb/` with category scaffold, article-type schemas, verification workflow, and agent playbook. Wire into `kiwifs init --template kb`.
2. **Search analytics** — Track search queries and no-result events in analytics tables. DQL: `TABLE query, count FROM "_analytics/searches" WHERE results = 0 SORT count DESC`.
3. **Feedback API** — `POST /api/kiwi/feedback` with `{path, helpful: bool, comment?}`. Stored in frontmatter or sidecar. Surfaces in janitor reports.
4. **Deflection dashboard** — Calculate self-serve rate from page views vs. support ticket creation (via webhook integration).
5. **Content gap AI** — Agent analyzes search-no-results + feedback signals, proposes new articles via `kiwi_write` in draft state.

## Good First Issues

See the [Good First Issues](Good-First-Issues) page for issues tagged `uc:knowledge-base`.
