# Data Workspace Schema

## Record Structure

Every record in a collection has:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | ✅ | Human-readable record title |
| `type` | string | ✅ | Record type (matches collection schema) |
| `status` | string | ❌ | Record status (active, archived, etc.) |
| `created_at` | date | ❌ | When the record was created |
| `tags` | string[] | ❌ | Tags for filtering |

Additional fields are defined per-collection in `.kiwi/schemas/`.

## Dashboard Pages

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | ✅ | Dashboard title |
| `type` | `"dashboard"` | ✅ | Page type |
| `owner` | string | ❌ | Dashboard maintainer |

## DQL Reference

| Query Type | Syntax |
|------------|--------|
| Table | `TABLE field1, field2 FROM "path/" WHERE condition SORT field LIMIT N` |
| Count | `COUNT FROM "path/" WHERE condition` |
| List | `LIST FROM "path/" WHERE condition` |
| Group | `TABLE field, COUNT(field) FROM "path/" GROUP BY field` |
| Flatten | `TABLE ... FROM "path/" FLATTEN array_field` |

## Chart Types

| Type | Use For |
|------|---------|
| `pie` | Distribution / proportions |
| `bar` | Comparisons, categories |
| `line` | Trends over time |
| `area` | Cumulative values over time |
