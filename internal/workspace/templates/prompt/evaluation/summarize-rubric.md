---
title: Summarize Quality Rubric
type: rubric
prompt: "[[task-prompts/summarize]]"
tags: [evaluation, summarize]
status: active
---

Scoring rubric for the [[task-prompts/summarize]] prompt.

## Criteria

| Criterion | Weight | Pass threshold |
|-----------|--------|----------------|
| Factual accuracy | 40% | No hallucinated facts |
| Completeness | 30% | Captures all key points |
| Conciseness | 20% | Within word limit |
| Structure | 10% | Clear bullets or paragraphs |

## Scoring

- **1.0** — All criteria met on a diverse test set
- **0.8** — Minor omissions or verbosity
- **0.6** — Missing important details
- **Below 0.6** — Keep `label: staging`; iterate on prompt body

## Test cases

1. Long technical article → bullet summary under 200 words
2. Meeting notes → action items preserved
3. Mixed-language input → consistent {{language}} output
