# UC-7: Architecture Decision Records

**Label:** [`uc:adr`](https://github.com/kiwifs/kiwifs/labels/uc%3Aadr)

## Thesis

Architecture Decision Records capture the "why" that code cannot express. The industry standard (Nygard, MADR, AWS Prescriptive Guidance, Martin Fowler) is clear: ADRs are numbered markdown files with status lifecycles, stored in the repo next to the code. But existing tools (adr-tools, Log4brains) are CLI wrappers that create files — they don't index, query, or connect decisions. KiwiFS already has frontmatter indexing, DQL, wiki-link graphs, the contradictions system, and workflow state machines. An ADR system where agents can query "what architectural decisions constrain authentication?" before writing code is a natural fit.

## Features

KiwiFS already has the primitives for structured ADR management:

| Feature | Status | Location |
|---------|--------|----------|
| Markdown files with YAML frontmatter (status, date, deciders, domain) | ✅ | Every `.md` file |
| Workflow state machine (status transitions) | ✅ | `internal/workflow/` |
| `contradicts` frontmatter indexed as backlinks | ✅ | `internal/links/` |
| Wiki links + backlinks + graph view | ✅ | `internal/links/`, `ui/src/components/KiwiGraph.tsx` |
| DQL queries over frontmatter | ✅ | `internal/dataview/` |
| JSON Schema validation on writes | ✅ | `internal/schema/` |
| Git versioning (immutable history, blame, diff) | ✅ | `internal/versioning/` |
| `kiwifs check` for CI validation | ✅ | `cmd/check.go` |
| Content health janitor (stale detection) | ✅ | `internal/janitor/` |
| Templates system | ✅ | `internal/workspace/templates/` |
| MCP tools for agent queries | ✅ | `internal/mcpserver/` |

## Industry Comparison

| Feature | adr-tools | Log4brains | MADR (manual) | Backstage ADR | KiwiFS |
|---------|-----------|------------|---------------|---------------|--------|
| Sequential numbering | ✅ (CLI) | ✅ | Manual | Plugin | Pipeline hook |
| Status lifecycle | Links only | ✅ | Manual | Display only | Workflow engine |
| Supersession links | ✅ | ✅ | Manual | ❌ | Indexed backlinks + graph |
| Search across decisions | `grep` | Full-text | `grep` | Backstage search | FTS5 + vector + DQL |
| Contradiction detection | ❌ | ❌ | ❌ | ❌ | ✅ (built-in) |
| CI validation | ❌ | ❌ | ❌ | ❌ | `kiwifs check` |
| Agent-queryable | ❌ | ❌ | ❌ | ❌ | 62 MCP tools |
| Immutability enforcement | Convention | Convention | Convention | ❌ | Schema validation |
| YAML frontmatter (machine-readable) | ❌ | ✅ | ✅ (Structured MADR) | ❌ | ✅ (native) |

**KiwiFS's unique positioning:** The only ADR system where decisions are queryable by agents, contradictions are automatically surfaced, and the supersession graph is navigable. An agent can ask "what accepted decisions affect the database layer?" before proposing a new architecture.

## What's Missing

| Gap | Why it matters | Industry reference |
|-----|---------------|-------------------|
| Auto-incrementing sequence numbers | ADRs are conventionally numbered (`ADR-001`, `ADR-002`). Manual numbering causes conflicts. | adr-tools, MADR |
| Supersession chain indexing | `supersedes` / `superseded_by` not indexed as typed links (only `contradicts` is) | adr-tools link management |
| Status lifecycle workflow | No default ADR workflow config shipping with `kiwifs init` | AWS Prescriptive Guidance |
| Immutability-after-acceptance | No enforcement that accepted ADRs can only have frontmatter updates | Nygard, Fowler: "supersede, don't edit" |
| Domain-scoped queries | No convention for `domain` field to scope ADR queries by area | Backstage ADR categorization |
| Quarterly review janitor rule | No staleness rule specifically for accepted ADRs past review period | AWS: quarterly ADR review |

## Proposed Milestones

1. **ADR init template** — Ship `.kiwi/templates/adr/` with MADR-format template (Context, Decision, Consequences), `.kiwi/workflows/adr.json` (`proposed → accepted → deprecated → superseded`), and `.kiwi/schemas/adr.json`. Wire into `kiwifs init --template adr`.
2. **Supersession chain links** — Index `supersedes` and `superseded_by` frontmatter as typed links (same pattern as `contradicts`). Graph view shows decision evolution.
3. **Auto-sequence pipeline hook** — `FormatWrite` hook assigns next `adr_number` when writing to `decisions/` directory with no existing number. DQL: `TABLE adr_number, title, status FROM "decisions/" SORT adr_number DESC`.
4. **Immutability-after-acceptance** — `ValidateWrite` hook rejects body changes to files with `status: accepted|deprecated|superseded`. Only frontmatter updates (`superseded_by`, `status`) allowed.
5. **Review staleness janitor** — Janitor flags ADRs where `status = "accepted"` and `last_reviewed` exceeds a configurable interval (default 90 days).
6. **Domain-scoped queries** — Document `domain` frontmatter convention. DQL: `TABLE adr_number, title FROM "decisions/" WHERE domain = "auth" AND status = "accepted"`.

## Good First Issues

See the [Good First Issues](Good-First-Issues) page for issues tagged `uc:adr`.
