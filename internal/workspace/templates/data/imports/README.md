---
title: Importing Data
owner: data-lead
status: active
tags: [imports, data]
---

# Importing Data

KiwiFS supports importing data from 18+ sources. Each record becomes a
markdown file with structured frontmatter.

## Supported Sources

| Source | Command |
|--------|---------|
| CSV | `kiwifs import --from csv --file data.csv --root collections/records/` |
| JSON/JSONL | `kiwifs import --from json --file data.json --root collections/records/` |
| PostgreSQL | `kiwifs import --from postgres --dsn "..." --table users --root collections/users/` |
| MySQL | `kiwifs import --from mysql --dsn "..." --table events --root collections/events/` |
| MongoDB | `kiwifs import --from mongodb --uri "..." --collection logs --root collections/logs/` |
| Firestore | `kiwifs import --from firestore --project my-project --collection users --root collections/users/` |
| DynamoDB | `kiwifs import --from dynamodb --table my-table --root collections/items/` |
| Redis | `kiwifs import --from redis --url "..." --pattern "user:*" --root collections/users/` |
| Elasticsearch | `kiwifs import --from elasticsearch --url "..." --index logs --root collections/logs/` |
| Excel | `kiwifs import --from excel --file data.xlsx --root collections/records/` |
| YAML | `kiwifs import --from yaml --file config.yaml --root collections/config/` |
| Airbyte | `kiwifs import --from airbyte --config connector.json --root collections/data/` |

## Import Options

| Flag | Description |
|------|-------------|
| `--schema` | Path to JSON Schema for validation |
| `--title-field` | Which field to use as the page title |
| `--slug-field` | Which field to use for the filename |
| `--tags-field` | Which field to extract as tags |
| `--flatten` | Flatten nested objects into dot-notation keys |
| `--batch-size` | Records per import batch (default: 100) |

## Example: Import from CSV

```bash
kiwifs import \
  --from csv \
  --file users.csv \
  --root collections/users/ \
  --title-field name \
  --slug-field email \
  --schema .kiwi/schemas/user.json
```

This creates one markdown file per row:

```markdown
---
title: "Alice Johnson"
type: user
email: alice@example.com
plan: pro
created_at: 2026-01-15
---

# Alice Johnson
```

## Querying Imported Data

Once imported, use DQL to query across all records:

```kiwi-query
TABLE title, plan, status
FROM "collections/users/"
WHERE plan = "pro" AND status = "active"
SORT created_at DESC
```
