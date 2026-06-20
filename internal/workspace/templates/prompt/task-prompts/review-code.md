---
type: prompt
title: Review Code
model: claude-sonnet-4
label: production
temperature: 0.1
max_tokens: 2048
tags: [review, coding]
success_rate: 0.89
usage_count: 76
eval_score: 0.88
last_tested: 2026-05-28
---

Review the following {{language}} code for correctness, security, and
maintainability.

## Context

{{context}}

## Code

```{{language}}
{{code}}
```

## Output format

1. **Summary** — one paragraph overview
2. **Issues** — numbered list with severity (critical / major / minor)
3. **Suggestions** — concrete improvements with examples where helpful
