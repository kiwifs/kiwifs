# Schema — Prompt Library

_Template version: 1.0 (UC-8)_

Versioned prompt registry for AI workflows. Each prompt is a git-versioned
markdown file with structured frontmatter — prompt text is readable, history
is `git log`, and performance metrics are DQL-queryable.

## Directory Structure

    system-prompts/      System messages and persona definitions
    task-prompts/        Task-specific prompts (summarize, review, translate, etc.)
    evaluation/          Eval criteria and scoring rubrics
    index.md             Prompt catalog overview
    SCHEMA.md            This file — structure and conventions
    .kiwi/
      schemas/prompt.json   Prompt frontmatter validation

## Frontmatter Fields

Every prompt file should have YAML frontmatter. Required fields marked *.
Validated by `.kiwi/schemas/prompt.json` when `type: prompt` is set.

### Prompts (`system-prompts/*.md`, `task-prompts/*.md`)

| Field          | Type       | Required | Values / Notes                              |
|----------------|------------|----------|---------------------------------------------|
| type           | string     | *        | Always `prompt`                             |
| title          | string     | *        | Human-readable prompt name (1–120 chars)    |
| model          | string     | *        | Target model slug, e.g. `claude-sonnet-4`   |
| label          | string     | *        | `production` · `staging` — release track    |
| temperature    | number     |          | 0.0–2.0 sampling temperature                |
| max_tokens     | integer    |          | Maximum response tokens                     |
| tags           | string[]   |          | Topic tags for filtering                    |
| success_rate   | number     |          | 0.0–1.0, measured success rate              |
| usage_count    | integer    |          | Times this prompt was invoked               |
| eval_score     | number     |          | 0.0–1.0, latest evaluation score            |
| variant_of     | string     |          | Wikilink to parent prompt for A/B variants  |
| last_tested    | date       |          | ISO 8601 date of last eval run              |

### Evaluation Rubrics (`evaluation/*.md`)

Validated by `.kiwi/schemas/rubric.json` when `type: rubric` is set.

| Field   | Type       | Required | Values / Notes                              |
|---------|------------|----------|---------------------------------------------|
| type    | string     | *        | Always `rubric`                             |
| title   | string     | *        | Rubric name (1–120 chars)                   |
| status  | string     | *        | `draft` · `active` · `archived`             |
| prompt  | string     |          | Path or wikilink to the prompt being scored |
| tags    | string[]   |          | Topic tags (at least one when present)      |

## Template Variables

Prompt bodies use `{{variable}}` placeholders for runtime substitution.
Common patterns:

- `{{content}}` — input text to process
- `{{language}}` — target or source language
- `{{code}}` — code snippet under review
- `{{context}}` — additional background information

Future KiwiFS releases will index `{{variable}}` names into metadata for
DQL queries like `WHERE parameters CONTAINS "language"`.

## Release Labels

Use `label` to track prompt lifecycle:

| Label        | Meaning                                      |
|--------------|----------------------------------------------|
| `production` | Approved for live agent use                  |
| `staging`    | Under evaluation, not yet promoted           |

Promote staging prompts to production after eval scores meet your threshold.
Use `variant_of` to link A/B test variants to their parent prompt.

## DQL Examples

Production prompts by success rate:

```dql
TABLE _path AS Path, title AS Title, model AS Model, success_rate AS Success
WHERE type = "prompt" AND label = "production"
SORT success_rate DESC
```

Staging prompts awaiting promotion:

```dql
TABLE title AS Title, eval_score AS Score, last_tested AS Tested
WHERE type = "prompt" AND label = "staging"
SORT eval_score DESC
```

Most-used prompts:

```dql
TABLE title AS Title, usage_count AS Uses, model AS Model
WHERE type = "prompt"
SORT usage_count DESC
LIMIT 10
```

## Operations

See `.kiwi/playbook.md` for MCP tool sequences.

## Conventions

- One prompt per file, named by slug (`summarize.md`, `code-assistant.md`).
- System prompts live in `system-prompts/`; task prompts in `task-prompts/`.
- Use `{{variable}}` syntax for all runtime placeholders.
- Set `label: staging` for new prompts; promote to `production` after eval.
- Link variants with `variant_of: "[[task-prompts/summarize]]"`.
- Keep evaluation rubrics in `evaluation/` linked to their target prompts.
- Update `usage_count` and `success_rate` from agent telemetry or manual review.

## Security

Prompt libraries often contain production system prompts and proprietary
instructions. Treat this workspace as sensitive data:

1. **Enable authentication** in `.kiwi/config.toml` before binding to a
   network interface. Use `apikey`, `perspace`, or `oidc` — never expose
   `type = "none"` on `0.0.0.0`.
2. **Bind localhost** (`host = "127.0.0.1"`) during local development; switch
   to `0.0.0.0` only after auth is configured.
3. **Scope production prompts** — keep `label: production` prompts in
   restricted spaces; use separate staging workspaces for experimentation.
4. **Rotate API keys** when team members leave or prompts are promoted to
   production. Never commit secrets; use `${ENV_VAR}` references in config.
5. **Audit changes** via `git log` — every `kiwi_write` is versioned.
   Review diffs before merging prompt updates to production.
