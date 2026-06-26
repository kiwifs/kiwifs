# UC-8: Prompt Library

**Label:** [`uc:prompt-library`](https://github.com/kiwifs/kiwifs/labels/uc%3Aprompt-library)

**Live demo:** [demo.kiwifs.com/prompt](https://demo.kiwifs.com/prompt/)

## Thesis

As teams scale AI usage, they accumulate hundreds of prompts across codebases, Slack threads, and individual notebooks. The industry response (PromptLayer, Langfuse, Humanloop) is a versioned prompt registry that decouples prompt updates from code deployment. But these are all SaaS products with opaque storage. KiwiFS turns each prompt into a git-versioned markdown file with structured frontmatter — the prompt text is `cat`-able, the version history is `git log`, the performance data is DQL-queryable, and agents retrieve the best prompt for a task via MCP. No separate prompt management SaaS needed.

## Features

KiwiFS already has the infrastructure for prompt versioning and retrieval:

| Feature | Status | Location |
|---------|--------|----------|
| Markdown files with YAML frontmatter (model, temperature, label, tags) | ✅ | Every `.md` file |
| Git versioning (every prompt edit tracked, diff, blame, restore) | ✅ | `internal/versioning/` |
| Full-text search (find prompts by content) | ✅ | `internal/search/` |
| Semantic/vector search (find similar prompts by meaning) | ✅ | `internal/vectorstore/` |
| DQL queries (filter by model, label, performance metrics) | ✅ | `internal/dataview/` |
| JSON Schema validation (enforce prompt metadata structure) | ✅ | `internal/schema/` |
| `X-Actor` / `X-Provenance` (track which agent used which prompt) | ✅ | `internal/pipeline/` |
| Page view analytics (track prompt access frequency) | ✅ | `internal/search/` (analytics tables) |
| Wiki links + backlinks (link prompt variants and families) | ✅ | `internal/links/` |
| MCP tools (agents search and retrieve prompts) | ✅ | `internal/mcpserver/` |
| Multi-space (separate prompt libraries per team/project) | ✅ | `internal/spaces/` |
| Webhooks (notify on prompt changes) | ✅ | `internal/webhooks/` |

## Industry Comparison

| Feature | PromptLayer | Langfuse | Humanloop | KiwiFS |
|---------|-------------|----------|-----------|--------|
| Prompt versioning | ✅ | ✅ | ✅ | ✅ (git — full diff, blame, restore) |
| Release labels (prod/staging) | ✅ | ✅ | ✅ | Frontmatter field (`label`) + DQL |
| Template variables | ✅ | ✅ | ✅ | Convention (parse `{{var}}` from body) |
| Performance tracking | ✅ (built-in) | ✅ (traces) | ✅ (evaluations) | Frontmatter metrics + DQL |
| A/B testing | Dynamic labels | Label-based | Experiments | `variant_of` links + DQL comparison |
| Playground / testing | ✅ | ✅ | ✅ | ❌ |
| Self-hosted | ❌ (SaaS) | ✅ (OSS) | ❌ (SaaS) | ✅ (single binary) |
| Search (semantic) | ❌ | Basic | ❌ | FTS5 + vector + DQL |
| Agent-native access | API only | API only | API only | MCP (68+ tools) + REST + NFS + S3 |
| Portable (no lock-in) | ❌ | Partial | ❌ | ✅ (plain `.md` files on disk) |

**KiwiFS's unique positioning:** The only prompt management system where prompts are plain markdown files you own, with git history as the version control, DQL as the analytics layer, and MCP as the agent interface. No SaaS, no vendor lock-in, no separate database.

## What's Missing

| Gap | Why it matters | Industry reference |
|-----|---------------|-------------------|
| ~~Template variable extraction~~ | ✅ Shipped: `{{variable}}` placeholders indexed (#331) | PromptLayer template variables |
| Variant linking | No `variant_of` frontmatter indexed as links for prompt families | PromptLayer/Langfuse A/B testing |
| Performance metadata schema | No convention for `success_rate`, `avg_tokens`, `eval_score`, `usage_count` | Langfuse trace-linked metrics |
| ~~Word-level diff~~ | ✅ Shipped: word-level diff support (#332) | PromptLayer version diff |
| Provenance-based usage analytics | Page views track access but don't segment by actor/agent | PromptLayer per-prompt analytics |
| ~~Prompt init template~~ | ✅ Shipped: `kiwifs init --template prompt` (#333) | PromptLayer registry organization |

## Proposed Milestones

1. ~~**Prompt init template**~~ ✅ — Shipped: `kiwifs init --template prompt` with `system-prompts/`, `task-prompts/`, `evaluation/`, `.kiwi/schemas/prompt.json`, `.kiwi/schemas/rubric.json` (#333).
2. **Performance metadata schema** — Standardize frontmatter fields: `model`, `temperature`, `max_tokens`, `label`, `success_rate`, `avg_tokens`, `eval_score`, `usage_count`, `last_tested`. DQL: `TABLE title, success_rate, usage_count FROM "prompts/" WHERE model = "claude-4" SORT success_rate DESC`.
3. ~~**Template variable extraction**~~ ✅ — Shipped: `{{variable}}` placeholders indexed from markdown body (#331).
4. **Variant linking** — Index `variant_of` frontmatter as typed links. Graph view shows prompt families. DQL: `TABLE title, success_rate FROM "prompts/" WHERE variant_of = "[[summarize-v1]]"`.
5. ~~**Word-level diff**~~ ✅ — Shipped: word-level diff for prose-optimized comparisons (#332).
6. **Usage analytics by actor** — Extend page view analytics to segment by `X-Actor` header. DQL over analytics: "which agents use this prompt most?"

## Good First Issues

See the [Good First Issues](Good-First-Issues) page for issues tagged `uc:prompt-library`.
