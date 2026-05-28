# UC-1: Agent Task Orchestration

**Label:** [`uc:task-orchestration`](https://github.com/kiwifs/kiwifs/labels/uc%3Atask-orchestration)

## Thesis

OpenAI's [Symphony](https://openai.com/index/open-source-codex-orchestration-symphony/) turns Linear into a control plane for coding agents — every open issue gets an agent, agents run continuously, humans review results. KiwiFS already has the markdown-native primitives to be that control plane *without requiring an external issue tracker*. The goal: a workspace where humans file tasks as markdown, agents pick them up and work on them, and progress is tracked in the same filesystem.

## What Already Exists

KiwiFS has remarkably strong alignment with the Symphony model:

| Symphony concept | KiwiFS equivalent | Location |
|-----------------|-------------------|----------|
| Issue tracker (Linear) | Markdown files with `workflow` + `state` frontmatter | `internal/workflow/` |
| Issue states | Workflow state machine (`.kiwi/workflows/*.json`) with states, transitions, WIP limits | `internal/workflow/workflow.go` |
| Kanban board | Full Kanban UI + inline `` ```kiwi-kanban `` blocks | `ui/src/components/KiwiKanban.tsx` |
| Task assignment | Claims system with path-level leases | `internal/claims/` |
| Per-issue workspace | Drafts system (git-branch-based isolation) | `internal/draft/` |
| Agent tools | 62 MCP tools including `kiwi_workflow_advance`, `kiwi_claim`, `kiwi_draft_*` | `internal/mcpserver/` |
| `WORKFLOW.md` | `.kiwi/rules.md` exportable to Cursor/Claude Code/AGENTS.md | `cmd/rules.go` |
| Task metadata | YAML frontmatter | Every `.md` file |
| Checklists / subtasks | GFM `- [ ]` checklists | Editor slash commands |
| Observability | Analytics, audit log, SSE events | `internal/api/` |

## Industry Comparison

| Tool | Approach | Strengths | Weaknesses vs. KiwiFS |
|------|----------|-----------|----------------------|
| [Symphony](https://github.com/openai/symphony) (OpenAI) | Polls Linear, dispatches Codex agents, per-issue git worktrees | Battle-tested at OpenAI, SPEC.md is language-agnostic | Requires Linear ($), external to the codebase, no built-in search/query |
| [Better Symphony](https://github.com/frederik-jacques/better-symphony) | Multi-tracker (Linear, GitHub Issues, GitHub PRs), Claude Code agents | GitHub Issues support, PR review workflows | Still depends on external trackers |
| [Syner](https://github.com/synerops/syner) | Markdown notes as agent context, skill-based routing | Markdown-native, skill system | No structured workflow/kanban, more of a routing layer |
| Linear / GitHub Issues | SaaS issue trackers | Rich UI, established ecosystem | Not markdown-native, not self-hosted, vendor lock-in |

**KiwiFS's unique positioning:** The only tool where the task tracker, the knowledge base, and the agent workspace are the same filesystem.

## What's Missing

| Gap | What Symphony has | What KiwiFS needs |
|-----|-------------------|-------------------|
| Orchestrator daemon | Polls Linear every 30s, dispatches agents | `kiwifs orchestrate` command that polls workflow boards and spawns agent sessions |
| Agent runner protocol | Codex app-server JSON-RPC | Integration with Codex app-server, Claude Code, or Cursor SDK |
| Blocked-by dependency graph | Checks blocker refs before dispatch | `blocked_by` frontmatter with automatic dispatch gating |
| Agent workspace isolation | Per-issue git worktree | Extend drafts to auto-create per-task branches |
| Auto-retry / stall detection | Exponential backoff, stall timeouts | Claim TTL with auto-release + retry queue |
| Task decomposition | Agents create sub-tasks in Linear | MCP tool for creating child pages with `parent` frontmatter |
| Artifact linking | PRs linked to Linear issues | `artifacts` frontmatter array |
| Multi-agent concurrency | `max_concurrent_agents`, per-state limits | Configuration in workflow JSON |
| Progress reporting | Agents comment on issues | Convention for agents to append timestamped progress sections |

## Proposed Milestones

1. **Task primitives** — Standardize task frontmatter schema (`assignee`, `priority`, `due_date`, `blocked_by`, `parent`, `artifacts`). Ship default `.kiwi/workflows/tasks.json` and `.kiwi/templates/task.md`.
2. **Dependency-aware board** — Extend Kanban UI to grey out blocked tasks. DQL query for ready tasks.
3. **Claim TTL** — Add expiry to claims. Background goroutine releases expired claims.
4. **`kiwifs orchestrate`** — Long-running daemon: poll workflow board → dispatch agents → monitor progress → restart stalled sessions → advance workflow state.
5. **Agent progress protocol** — Convention + MCP tool for agents to append timestamped progress sections to task pages.
6. **Sub-task decomposition** — MCP tool `kiwi_decompose` that creates child pages linked via `parent` frontmatter.

## Good First Issues

See the [Good First Issues](Good-First-Issues) page for issues tagged `uc:task-orchestration`.
