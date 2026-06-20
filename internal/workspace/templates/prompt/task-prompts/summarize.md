---
type: prompt
title: Summarize
model: claude-sonnet-4
label: production
temperature: 0.3
max_tokens: 1024
tags: [summarize, content]
success_rate: 0.94
usage_count: 128
eval_score: 0.93
last_tested: 2026-06-01
---

Summarize the following content in {{language}}.

Preserve key facts, decisions, and action items. Use bullet points for
lists and keep the summary under 200 words unless `{{content}}` requires
more detail.

## Input

{{content}}
