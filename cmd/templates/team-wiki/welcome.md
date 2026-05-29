---
title: Welcome
owner: team-lead
status: active
tags: [meta, onboarding]
last-reviewed: 2026-01-01
---

# Welcome

This is your team's single source of truth — the place where processes,
decisions, architecture, and institutional knowledge live so they're
findable by anyone (human or AI agent) at any time.

## How This Wiki Is Organized

We organize around **how work gets done**, not org charts. Everything
lives under one of six sections:

| Section | What goes here |
|---------|---------------|
| **How We Work** | Communication norms, meeting cadences, approval flows |
| **Onboarding** | Week-1 checklist, tool access, team norms |
| **Architecture** | System overview, services, data flow, infrastructure |
| **Decisions** | Architecture Decision Records — the *why* behind choices |
| **Processes** | Step-by-step SOPs and runbooks for recurring tasks |
| **Reference** | Glossary, FAQ, templates, vendor info |

## How to Find Things

- **Browse the sidebar** — sections are listed in the order above
- **Search** — use the search bar or `kiwi_search` via MCP
- **Follow links** — pages cross-link to related content with `[[wikilinks]]`

## How to Contribute

1. **Check for duplicates first.** Search before creating a new page.
2. **Pick the right section.** If unsure, `processes/` is a safe default.
3. **Use frontmatter.** Every page needs `title`, `owner`, `status`, and `tags`.
4. **Keep it short.** Split pages over 300 lines.
5. **Link related pages.** Cross-links make the wiki a web, not a list.
6. **Review regularly.** Update `last-reviewed` when you verify content is current.

## Conventions

- Page titles use plain language: "Deployment Process" not "Ship It Guide"
- Tags are lowercase and hyphenated: `ci-cd`, `team-norms`, `api-design`
- Status lifecycle: `draft` → `active` → `review` → `deprecated`
- Every folder has an `index.md` landing page
