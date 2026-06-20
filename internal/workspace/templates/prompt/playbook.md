# Agent Playbook — Prompt Library

You are maintaining a versioned prompt registry. When connected via MCP,
use these operations to create, test, and promote prompts.

## Quick Start

1. Call `kiwi_context` to get this playbook, SCHEMA.md, and the prompt catalog
2. Call `kiwi_query` to list prompts by label, model, or success rate
3. Use the operations below to manage the library

## Find Prompts

Production prompts ranked by success rate:

```
kiwi_query("TABLE _path, title, model, success_rate, usage_count WHERE type = 'prompt' AND label = 'production' SORT success_rate DESC")
```

Staging prompts awaiting promotion:

```
kiwi_query("TABLE _path, title, eval_score, last_tested WHERE type = 'prompt' AND label = 'staging' SORT eval_score DESC")
```

## Create a Prompt

1. Choose `system-prompts/` for personas or `task-prompts/` for task templates.
2. `kiwi_write` with required frontmatter (`type`, `title`, `model`, `label`):
   ```yaml
   ---
   type: prompt
   title: "My Prompt"
   model: claude-sonnet-4
   label: staging
   temperature: 0.3
   max_tokens: 2048
   tags: [topic]
   ---
   ```
3. Use `{{variable}}` placeholders in the body for runtime substitution.
4. Set `label: staging` until evaluation passes.
5. Update `index.md` with a wikilink to the new prompt.

## Test a Prompt

1. `kiwi_read` the prompt and its linked rubric in `evaluation/`.
2. Run eval cases against the rubric criteria.
3. Update `eval_score`, `success_rate`, `usage_count`, and `last_tested`.

## Promote to Production

When `eval_score` meets your threshold:

1. Change `label` from `staging` to `production`.
2. For A/B variants, set `variant_of` to the parent prompt path (e.g. `task-prompts/summarize.md`).
3. Update the catalog table in `index.md`.

## Validate

After writes, call `kiwi_lint` on changed files. Prompt frontmatter is
validated against `.kiwi/schemas/prompt.json` when `type: prompt` is set.
Rubric frontmatter is validated against `.kiwi/schemas/rubric.json` when
`type: rubric` is set.

## Secure the workspace

Before serving this library over REST, NFS, S3, or WebDAV:

1. Edit `.kiwi/config.toml` and set `[auth] type` to `apikey`, `perspace`,
   or `oidc`. The template defaults to `host = "127.0.0.1"` and `type = "none"`.
2. Store API keys in environment variables (`api_key = "${KIWI_API_KEY}"`), not
   in git.
3. Use `perspace` keys when multiple agents or teams share one KiwiFS server.
4. Restrict MCP access to trusted agents — they can read all prompts via
   `kiwi_read` once connected.
