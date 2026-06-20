---
title: Prompt Library
owner: team
status: active
tags: [meta, prompts]
---

# Prompt Library

Versioned prompt registry for AI workflows. Each prompt is a markdown file
with structured frontmatter — searchable, diffable, and agent-retrievable via MCP.

## System Prompts

Persona definitions and system messages used across workflows.

| Prompt | Model | Label | Tags |
|--------|-------|-------|------|
| [[system-prompts/code-assistant]] | claude-sonnet-4 | production | coding, assistant |

## Task Prompts

Task-specific prompts for common operations.

| Prompt | Model | Label | Success Rate | Uses |
|--------|-------|-------|--------------|------|
| [[task-prompts/summarize]] | claude-sonnet-4 | production | 0.94 | 128 |
| [[task-prompts/review-code]] | claude-sonnet-4 | production | 0.89 | 76 |
| [[task-prompts/translate]] | claude-sonnet-4 | staging | 0.82 | 12 |

## Evaluation

Scoring rubrics and benchmarks for prompt quality.

| Rubric | Status | Target Prompt |
|--------|--------|---------------|
| [[evaluation/summarize-rubric]] | active | [[task-prompts/summarize]] |

## Workflow

1. **Create** a prompt → add to `system-prompts/` or `task-prompts/` with `label: staging`
2. **Test** → run against evaluation rubrics in `evaluation/`
3. **Measure** → update `success_rate`, `eval_score`, and `usage_count`
4. **Promote** → change `label` to `production` when eval threshold is met
5. **Iterate** → create variants with `variant_of` for A/B testing

## Quick Queries

Production prompts ranked by success:

```dql
TABLE title AS Title, success_rate AS Success, usage_count AS Uses
WHERE type = "prompt" AND label = "production"
SORT success_rate DESC
```
