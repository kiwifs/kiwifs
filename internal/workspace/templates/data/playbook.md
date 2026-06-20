# Agent Playbook — Data Workspace

This workspace stores structured data as markdown with frontmatter.
Records are queryable via DQL, searchable via FTS5 + vector, and
visualizable with inline charts.

## Quick Start

1. Call `kiwi_context` to get this playbook + schema + index in one call
2. Call `kiwi_tree` to see collections and dashboards
3. Use DQL queries to analyze data

## Import Data

When adding data from external sources:

1. **Choose the source** — see `imports/README.md` for supported formats.
2. **Define a schema** — create `.kiwi/schemas/<type>.json` with expected fields.
3. **Run the import:**
   ```bash
   kiwifs import --from <source> --file <path> --root collections/<name>/ --schema .kiwi/schemas/<type>.json
   ```
4. **Verify** — `kiwi_query` to check record counts and field completeness.
5. **Build a dashboard** — create a page in `dashboards/` with DQL queries.

## Query Data

Use DQL for structured queries over frontmatter:

```
kiwi_query("TABLE title, status, plan FROM \"collections/users/\" WHERE status = \"active\" SORT created_at DESC LIMIT 20")
```

### Common Patterns

| Query | Purpose |
|-------|---------|
| `COUNT FROM "collections/X/"` | Total records |
| `TABLE field, COUNT(field) FROM "..." GROUP BY field` | Aggregation |
| `TABLE ... WHERE DAYS_AGO(date_field) < 7` | Recent records |
| `TABLE ... SORT field DESC LIMIT N` | Top N |

## Create Dashboard

When building analytics views:

1. **Create a page** in `dashboards/` with `type: dashboard` frontmatter.
2. **Add DQL blocks** using ` ```kiwi-query ` fences.
3. **Add chart blocks** using ` ```kiwi-chart ` fences with `type` (pie, bar, line).
4. **Cross-link** to the collection it analyzes.

## Maintain

1. `kiwi_query` to check for records with missing required fields.
2. `kiwi_analytics` to find orphan records (not linked from any index).
3. Verify schemas match actual data: `kiwifs check --schema`.
4. Update dashboards when new fields are added to collections.

## Quality Rules

- **One record per file.** Each imported row/document is a separate `.md` file.
- **Consistent frontmatter.** All records in a collection share the same schema.
- **Schemas are enforced.** Writes to collections validate against `.kiwi/schemas/`.
- **Dashboards stay current.** Update queries when collection schemas change.
- **Index files required.** Every collection folder has an `index.md`.
