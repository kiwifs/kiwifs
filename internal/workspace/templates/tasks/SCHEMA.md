# Task Schema

_Template version: 2.0_

Each task is a markdown file with YAML frontmatter. Tasks are displayed
on the Kanban board and queryable via DQL.

## Required Fields

| Field | Type | Values / Notes |
|-------|------|----------------|
| `type` | string | Always `task` |
| `title` | string | Short summary of what needs to be done |
| `status` | string | See lifecycle below |
| `priority` | integer | See priority scale below |

## Optional Fields

| Field | Type | Values / Notes |
|-------|------|----------------|
| `category` | string | `feature` · `bug` · `chore` · `spike` · `epic` — what kind of work |
| `effort` | string | `xs` · `s` · `m` · `l` · `xl` — t-shirt size estimate |
| `assignee` | string | Agent or human identifier |
| `parent` | string | Path to parent epic/task for grouping |
| `blocked-by` | string[] | List of task paths that must be `done` first |
| `due` | date | ISO 8601 deadline |
| `tags` | string[] | Topic tags for filtering |
| `started-at` | datetime | When work began |
| `completed-at` | datetime | When task was marked done |
| `claimed-by` | string | Set automatically by claim endpoint |
| `claimed-at` | datetime | Set automatically by claim endpoint |
| `lease-expires` | datetime | Set automatically by claim endpoint |

## Kanban workflow (default)

New workspaces created with `kiwifs init --template tasks` include:

- `.kiwi/workflows/tasks.json` — states `backlog` → `todo` → `in_progress` → `review` → `done`, plus terminal `cancelled`, with WIP limits on `in_progress` (5) and `review` (3)
- `.kiwi/templates/task.md` — starter frontmatter using `workflow: tasks` and `state: backlog`

Pages on the board use **`workflow`** and **`state`** frontmatter (see `internal/workflow/workflow.go`). The legacy `status` field remains supported for DQL and imports.

## Status Lifecycle

```
backlog → todo → in_progress → review → done
                      ↓                   ↑
                   blocked ──────────────→┘
                                    cancelled
```

| Status | Meaning |
|--------|---------|
| `backlog` | Acknowledged but not yet ready to work on |
| `todo` | Ready to be picked up |
| `in_progress` | Someone (human or agent) is actively working on it |
| `review` | Work complete, awaiting review/approval |
| `blocked` | Cannot proceed — see `blocked-by` for dependencies |
| `done` | Complete and verified |
| `cancelled` | No longer needed |

## Priority Scale

| Priority | Label | Meaning |
|----------|-------|---------|
| 0 | **Urgent** | Drop everything. Production is broken or critical deadline. |
| 1 | **High** | Do this next. Important and time-sensitive. |
| 2 | **Medium** | Normal priority. Do in order. |
| 3 | **Low** | Nice to have. Do when higher-priority work is clear. |
| 4 | **Backlog** | Someday/maybe. Not urgent, not blocking anything. |

## Effort Scale

| Size | Meaning | Typical Duration |
|------|---------|-----------------|
| `xs` | Trivial change, < 1 hour | Minutes to 1 hour |
| `s` | Small, well-scoped | Half day |
| `m` | Medium, may touch multiple files | 1-2 days |
| `l` | Large, requires design thought | 3-5 days |
| `xl` | Very large, consider splitting | 1-2 weeks |

If a task is `xl`, strongly consider decomposing it into an epic
with smaller sub-tasks.

## Task Categories

| Category | When to Use |
|----------|-------------|
| `feature` | New functionality for users |
| `bug` | Something broken that needs fixing |
| `chore` | Maintenance, refactoring, tooling, deps |
| `spike` | Time-boxed research or proof-of-concept |
| `epic` | Container for related sub-tasks |

## Epics and Sub-Tasks

An **epic** is a task with `category: epic` that groups related work.
Sub-tasks reference their parent via the `parent` field:

```yaml
# The epic
---
type: task
title: "User authentication system"
category: epic
status: in_progress
priority: 1
---

# A sub-task
---
type: task
title: "Implement JWT token generation"
category: feature
status: todo
priority: 1
parent: tasks/auth-system.md
effort: m
---
```

Query sub-tasks of an epic:
```
kiwi_query("TABLE _path, title, status, effort WHERE parent = 'tasks/auth-system.md' SORT priority ASC")
```

## Task Decomposition

- **Use sub-tasks** (checkboxes in the body) when steps are sequential
  and one agent/person handles them all in a single session.
- **Use separate task files** with `blocked-by` when steps can be
  parallelized, span multiple sessions, or need different assignees.
- **Use epics** when there are 3+ related tasks that form a logical unit.
- Rule of thumb: can one agent finish everything in a single session?
  → Sub-tasks. Otherwise → separate files.

## Acceptance Criteria

Every task should include acceptance criteria in the body — a clear
definition of "done" that the assignee (human or agent) can verify.

```markdown
## Acceptance Criteria

- [ ] First criterion
- [ ] Second criterion
- [ ] Tests pass
```

## Definition of Done (Board Level)

A task may only move to `done` when ALL of these are true:

- [ ] All acceptance criteria in the task body are checked off
- [ ] Code changes have been reviewed (if applicable)
- [ ] Tests pass (no regressions)
- [ ] Documentation is updated (if user-facing)
- [ ] No known bugs introduced
- [ ] Assignee has verified the result works as expected
