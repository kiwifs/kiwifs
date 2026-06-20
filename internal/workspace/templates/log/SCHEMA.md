# Event Log Schema

## Daily Log File

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | ✅ | "Events — YYYY-MM-DD" |
| `type` | `"daily-log"` | ✅ | File type |
| `date` | date | ✅ | Log date |
| `append_only` | boolean | ✅ | Must be `true` |
| `entry_count` | integer | ✅ | Number of entries in file |
| `tags` | string[] | ❌ | Tags for filtering |

## Event Entry (Markdown Section)

Each event is an H2 section with the format:

```markdown
## YYYY-MM-DDTHH:MM:SSZ | domain.resource.action.vN

- **Actor:** type:identifier
- **Target:** type:identifier
- **Correlation:** type:identifier
- **Details:** Human-readable description
```

## Event Type Naming

Format: `<domain>.<resource>.<action>.v<version>`

- Domain: `system`, `user`, `content`, `admin`, `agent`, `webhook`
- Resource: noun describing what's affected
- Action: past-tense verb or outcome
- Version: integer starting at 1

## Integrity

- Files with `append_only: true` reject PUT overwrites
- Only `POST /api/kiwi/file/append` is allowed
- Git commit chain provides cryptographic tamper evidence
- `kiwifs check --verify-chain` validates history integrity
