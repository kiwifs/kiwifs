# Agent task progress convention

Task pages use the default `tasks` workflow (`kiwifs init --template tasks`). Agents should append progress under a dedicated heading so humans and other agents can scan history.

## Progress section format

```markdown
## Progress

### 2026-06-03T17:00:00Z — agent-name
Completed initial analysis. Found 3 files to modify. Starting implementation.

### 2026-06-03T17:15:00Z — agent-name
Implementation complete. PR opened at https://github.com/org/repo/pull/42
```

- Use UTC timestamps in RFC3339 format.
- One `###` entry per update; newest entries are appended at the end of the section.
- The `agent` label should match the MCP `actor` or your session name.

## MCP tools

| Tool | Purpose |
|------|---------|
| `kiwi_task_create` | Create `tasks/<slug>.md` with task frontmatter (`workflow: tasks`, `state: backlog`) |
| `kiwi_task_progress` | Append a progress block to an existing task |
| `kiwi_workflow_advance` | Move a task to another workflow state |
| `kiwi_claim` | Exclusive lease on a task while working |

## Example

```json
{"tool":"kiwi_task_create","arguments":{"title":"Add login rate limit","description":"## Acceptance\n\n- [ ] Limit 10/min per IP","claim":true,"actor":"ci-agent"}}
```

```json
{"tool":"kiwi_task_progress","arguments":{"path":"tasks/add-login-rate-limit.md","message":"Opened PR #42, waiting for review.","agent":"ci-agent"}}
```
