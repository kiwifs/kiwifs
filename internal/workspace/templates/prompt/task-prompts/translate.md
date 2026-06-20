---
type: prompt
title: Translate
model: claude-sonnet-4
label: staging
temperature: 0.2
max_tokens: 2048
tags: [translate, i18n]
success_rate: 0.82
usage_count: 12
eval_score: 0.79
last_tested: 2026-06-10
variant_of: "[[task-prompts/summarize]]"
---

Translate the text below from {{source_language}} to {{language}}.

Preserve tone, formatting, and technical terms. Flag ambiguous phrases
instead of guessing.

## Input

{{content}}
