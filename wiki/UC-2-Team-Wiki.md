# UC-2: Team Wiki

**Label:** [`uc:team-wiki`](https://github.com/kiwifs/kiwifs/labels/uc%3Ateam-wiki)

## Thesis

KiwiFS already functions as a team wiki — wiki links, backlinks, graph view, comments, sharing, multi-space, git history. The gap vs. Outline/Confluence is around collaboration UX, discoverability, and plugging into agent workflows so that new team members (human or AI) can onboard by querying the wiki.

## What Already Exists

| Feature | Status | Location |
|---------|--------|----------|
| Wiki links `[[page]]` + backlinks | ✅ | `internal/links/` |
| Knowledge graph (2D + 3D) | ✅ | `ui/src/components/KiwiGraph.tsx` |
| Inline comments anchored to text | ✅ | `internal/comments/` |
| Password-protected share links | ✅ | `internal/api/handlers_share.go` |
| Multi-space (isolated workspaces) | ✅ | `internal/spaces/` |
| Templates (`.kiwi/templates/`) | ✅ | `cmd/init.go` |
| Git blame, diff, version history | ✅ | `ui/src/components/KiwiHistory.tsx` |
| WYSIWYG + source editing | ✅ | `ui/src/components/KiwiEditor.tsx` |
| Slash commands, ToC, tags | ✅ | `ui/src/components/editor/` |
| SSE live updates | ✅ | `internal/api/handlers_events.go` |
| Star, pin, recent pages | ✅ | Client-side localStorage |
| Content health (stale, orphan, broken links) | ✅ | `internal/janitor/` |
| MCP tools for agents | ✅ | `internal/mcpserver/` (62 tools) |
| Rules export to Cursor/Claude Code | ✅ | `cmd/rules.go` |

## Industry Comparison

| Feature | Confluence | Outline | Wiki.js | KiwiFS |
|---------|-----------|---------|---------|--------|
| Real-time co-editing | ✅ | ✅ (CRDT) | ❌ | ❌ |
| Markdown-native | ❌ | ✅ | ✅ | ✅ (source of truth) |
| Search quality | Good | Good | Good | Excellent (FTS5 + vector + DQL) |
| API surface | REST | REST | GraphQL | REST + MCP + NFS + S3 + WebDAV |
| Self-hosted | ✅ (paid) | ✅ (BSL) | ✅ (AGPL) | ✅ (BSL → Apache) |
| Git versioning | ❌ | ❌ | Optional | Native (every write) |
| Agent integration | ❌ | ❌ | ❌ | ✅ (62 MCP tools) |
| Graph / backlinks | Minimal | ❌ | ❌ | Full (2D/3D, communities) |
| Spaces | ✅ | ✅ (collections) | ❌ | ✅ |
| Comments | ✅ | ✅ | ❌ | ✅ (inline, anchored) |

**KiwiFS's unique positioning:** The only wiki natively accessible to AI agents. A new team member — human or agent — can `kiwifs connect <workspace>` and immediately search, read, and query the entire knowledge base via MCP.

## What's Missing

| Gap | Why it matters |
|-----|---------------|
| Real-time co-editing | Outline's killer feature. Without OT/CRDT, concurrent edits on the same page conflict. |
| RBAC permissions | Teams need viewer/editor/admin roles per space. (Planned for v0.5) |
| Notifications (watch pages) | Confluence sends alerts when watched pages update. KiwiFS has SSE but no notification layer. |
| Page ordering (drag-and-drop) | Confluence/Outline let you reorder pages. KiwiFS tree is filesystem-ordered. |
| Onboarding template | No "welcome to this workspace" scaffold for new team wikis. |
| Search suggestions ("did you mean") | Failed search tracking exists but no user-facing suggestions. |
| Page status badges | Visual indicators for draft/current/archived derived from frontmatter. |
| Confluence import fidelity | Import exists but loses page tree hierarchy and some macros. |
| IDE integration | `kiwifs connect` works for MCP, but an inline wiki reader in Cursor/VSCode would be powerful. |

## Proposed Milestones

1. **Onboarding template** — Ship `.kiwi/templates/team-wiki/` with `welcome.md`, `how-we-work.md`, `architecture.md`, `onboarding-checklist.md`. Wire into `kiwifs init --template team-wiki`.
2. **Watch & notify** — Users "watch" pages/folders. On write events, fire webhook notifications (Slack, email, Discord).
3. **Page ordering** — `order` frontmatter field + drag-and-drop in tree. Persist order in `.kiwi/order.json`.
4. **RBAC (v0.5)** — Casbin-based roles: viewer, editor, admin per space. JWT/OIDC identity.
5. **Cursor/Codex wiki reader** — A skill that teaches agents to search the team wiki before asking questions.
6. **Conflict-aware editing** — ETag-based concurrent edit detection + three-way merge UI.

## Good First Issues

See the [Good First Issues](Good-First-Issues) page for issues tagged `uc:team-wiki`.
