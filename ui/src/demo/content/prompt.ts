import * as blk from "../blocks";
import { demoBacklinks, demoComments, demoSearch, demoVersions } from "./mockExtras";

export const promptPages: Record<string, string> = {
  "index.md": `---
title: Prompt catalog
type: index
---

Versioned system prompts live in git — diff across revisions, tune playground parameters, and track eval scores without a separate prompt SaaS.

${blk.queryTable('TABLE title, version, model, label FROM "system/" WHERE type = "prompt" SORT version DESC')}

${blk.queryTable('TABLE title, status FROM "evaluation/" WHERE type = "rubric"')}

${blk.progress({
  type: "bar",
  title: "Registry health",
  items: [
    { label: "Production", value: 4, color: "#22c55e" },
    { label: "Staging", value: 2, color: "#eab308" },
    { label: "Archived rubrics", value: 1, color: "#64748b" },
  ],
})}

> [!NOTE]
> Promote to \`label: production\` only after rubric score ≥ 0.85 on the golden set.
`,

  "system/code-review-v1.md": `---
title: Code review system prompt
type: prompt
version: 1
model: gpt-4o
label: staging
temperature: 0.3
max_tokens: 4096
tags: [review, system, legacy]
variant_of: code-review
success_rate: 0.71
eval_score: 0.68
usage_count: 1240
last_tested: 2026-05-28
---

You are a code reviewer. List issues found in the patch.

## Rules

- One bullet per issue
- No praise
- Output plain markdown

## Superseded

Replaced by [[system/code-review-v2|v2]] (JSON output) then [[system/code-review-v3|v3]] (structured reasoning).
`,

  "system/code-review-v2.md": `---
title: Code review system prompt
type: prompt
version: 2
model: gpt-4.1
label: staging
temperature: 0.2
max_tokens: 8192
tags: [review, system]
variant_of: code-review
success_rate: 0.79
eval_score: 0.76
usage_count: 3890
last_tested: 2026-06-10
---

You are a senior engineer performing code review. Respond with **JSON only** — no markdown fences.

\`\`\`json
{
  "summary": "one sentence",
  "issues": [{ "severity": "major|minor|nit", "file": "path", "line": 0, "message": "..." }],
  "verdict": "approve|request_changes"
}
\`\`\`

## Changes from v1

- Structured output for CI parsing
- Severity taxonomy
- Removed subjective tone

Compare diff to [[system/code-review-v3|v3]] which adds chain-of-thought then strips it from the user-visible response.

${blk.diff({
  language: "markdown",
  title: "v1 → v2 output contract",
  before: `You are a code reviewer. List issues found in the patch.

- One bullet per issue
- Output plain markdown`,
  after: `You are a senior engineer performing code review. Respond with JSON only.

{ "summary", "issues": [{ severity, file, line, message }], "verdict" }`,
})}
`,

  "system/code-review-v3.md": `---
title: Code review system prompt
type: prompt
version: 3
model: gpt-4.1
label: production
temperature: 0.2
max_tokens: 8192
tags: [review, system, production]
variant_of: code-review
success_rate: 0.91
eval_score: 0.89
usage_count: 12450
last_tested: 2026-06-18
---

You are a **principal engineer** reviewing a pull request. Prefer actionable feedback over style nitpicks. Think step-by-step internally, then emit only the final JSON object.

## Output schema

\`\`\`json
{
  "summary": "string",
  "reasoning_trace": "string (internal, may be redacted in UI)",
  "issues": [{
    "severity": "blocker|major|minor|nit",
    "category": "security|correctness|performance|maintainability|style",
    "file": "path",
    "line": 0,
    "message": "string",
    "suggestion": "string | null"
  }],
  "verdict": "approve|request_changes|comment"
}
\`\`\`

## Policy

1. **Blockers** — secrets, auth bypass, data loss
2. **Major** — logic bugs, missing error handling on I/O
3. **Minor** — unclear naming, missing tests for edge cases
4. **Nit** — formatting only if inconsistent with file

Do not request changes for personal taste when code matches project conventions.

${blk.diff({
  language: "json",
  title: "v2 → v3 schema",
  before: `{
  "summary": "one sentence",
  "issues": [{ "severity": "major|minor|nit", "file": "path", "line": 0, "message": "..." }],
  "verdict": "approve|request_changes"
}`,
  after: `{
  "summary": "string",
  "reasoning_trace": "string",
  "issues": [{
    "severity": "blocker|major|minor|nit",
    "category": "security|correctness|performance|maintainability|style",
    "file": "path", "line": 0, "message": "string", "suggestion": "string | null"
  }],
  "verdict": "approve|request_changes|comment"
}`,
})}

${blk.playground({
  title: "Generation parameters",
  widgets: [
    "slider: Temperature, min: 0, max: 2, default: 0.2",
    "select: Model, options: gpt-4.1, gpt-4o, claude-sonnet-4, local-qwen",
    "number: Max tokens, min: 256, max: 16384, default: 8192",
    "toggle: Include reasoning trace in response",
    "select: Verdict strictness, options: lenient, balanced, strict",
  ],
})}

${blk.progress({
  type: "gauge",
  title: "Eval scores (golden set, n=120)",
  showPercent: true,
  items: [
    { label: "Accuracy", value: 89 },
    { label: "Relevance", value: 92 },
    { label: "Coherence", value: 88 },
    { label: "Actionability", value: 86 },
    { label: "Cost efficiency", value: 81 },
  ],
})}

${blk.chart({
  type: "bar",
  title: "Rubric score by prompt version",
  xKey: "version",
  grid: true,
  legend: true,
  series: [
    { key: "accuracy", name: "Accuracy", color: "#3b82f6" },
    { key: "relevance", name: "Relevance", color: "#22c55e" },
    { key: "overall", name: "Overall", color: "#a855f7" },
  ],
  data: [
    { version: "v1", accuracy: 0.62, relevance: 0.71, overall: 0.68 },
    { version: "v2", accuracy: 0.74, relevance: 0.78, overall: 0.76 },
    { version: "v3", accuracy: 0.88, relevance: 0.91, overall: 0.89 },
  ],
})}

## Token cost estimate

Estimated cost per review (median patch 1,800 tokens in, 900 out):

$$C = \\frac{t_{in} \\cdot p_{in} + t_{out} \\cdot p_{out}}{1000}$$

With GPT-4.1 pricing $2.00 / $8.00 per 1M tokens:

$$C \\approx \\frac{1800 \\cdot 2 + 900 \\cdot 8}{10^6} = \\$0.0108$$

Compare [[system/code-review-v2|v2]] · History in git versions panel.
`,

  "system/summarization-v1.md": `---
title: Document summarization prompt
type: prompt
version: 1
model: gpt-4.1-mini
label: production
temperature: 0.4
max_tokens: 2048
tags: [summarization, system]
success_rate: 0.94
eval_score: 0.87
usage_count: 45200
last_tested: 2026-06-15
---

Summarize the following markdown document for a busy engineering manager.

## Constraints

- **Length:** 120–180 words
- **Structure:** 1-sentence thesis, 3 bullet takeaways, 1 risk or open question
- Preserve proper nouns and ADR numbers verbatim
- Do not invent metrics

## Output format

\`\`\`markdown
**Thesis:** ...

**Takeaways:**
- ...

**Open question:** ...
\`\`\`

Evaluated against [[evaluation/summarization-rubric|summarization rubric]].
`,

  "system/translation-v1.md": `---
title: EN→ES technical translation prompt
type: prompt
version: 1
model: claude-sonnet-4
label: production
temperature: 0.1
max_tokens: 4096
tags: [translation, i18n, system]
success_rate: 0.88
eval_score: 0.84
usage_count: 8900
last_tested: 2026-06-12
---

Translate technical documentation from English to Spanish (neutral LATAM).

## Rules

- Keep code blocks, API paths, and \`backticks\` unchanged
- Translate UI strings in quotes; leave \`snake_case\` identifiers alone
- Use "tú" for developer docs, "usted" for compliance content
- Flag ambiguous terms in \`<!-- i18n: ... -->\` comments

Scored with [[evaluation/translation-rubric|translation rubric]].
`,

  "evaluation/rubric.md": `---
title: Code review eval rubric
type: rubric
status: active
prompt: system/code-review-v3.md
tags: [review, eval]
---

Human + LLM-as-judge rubric for code review prompts. Dimensions scored 1–5, normalized to 0–1.

| Dimension | Weight | Description |
|-----------|--------|-------------|
| Accuracy | 0.35 | Findings match ground-truth defect list |
| Relevance | 0.25 | No hallucinated files or lines |
| Coherence | 0.15 | JSON valid; severities consistent |
| Actionability | 0.15 | Suggestions are concrete |
| Cost | 0.10 | Tokens under budget |

Golden set: \`evaluation/golden/code-review/\` (120 patches, anonymized from internal repos).
`,

  "evaluation/summarization-rubric.md": `---
title: Summarization rubric
type: rubric
status: active
prompt: system/summarization-v1.md
tags: [summarization, eval]
---

| Dimension | Weight | Pass threshold |
|-----------|--------|----------------|
| Coverage | 0.30 | All H2 sections reflected |
| Concision | 0.25 | 120–180 words |
| Factual | 0.35 | Zero contradictions vs source |
| Tone | 0.10 | Neutral, no hype |

Automated checks: word count, entity overlap (spaCy), ROUGE-L ceiling 0.45 (avoid copy-paste).
`,

  "evaluation/translation-rubric.md": `---
title: Translation quality rubric
type: rubric
status: active
prompt: system/translation-v1.md
tags: [translation, eval]
---

Uses COMET-Kiwi + human spot checks on 50-segment holdout.

| Dimension | Weight |
|-----------|--------|
| Meaning fidelity | 0.40 |
| Terminology consistency | 0.25 |
| Fluency | 0.20 |
| Format preservation | 0.15 |

**Pass:** composite ≥ 0.84 · **Production gate:** 0 failures on code-block corruption.
`,
};

export const promptMock = {
  versions: demoVersions([
    { hash: "f3a9c21", author: "maya", date: "2026-06-18T16:22:00Z", message: "v3: add category field and blocker severity" },
    { hash: "b7e4d88", author: "maya", date: "2026-06-10T14:05:00Z", message: "v2: JSON-only output for CI parser" },
    { hash: "1c2d3e4", author: "maya", date: "2026-06-01T09:00:00Z", message: "v1: initial plain-markdown prompt" },
    { hash: "9a8b7c6", author: "maya", date: "2026-05-28T11:30:00Z", message: "chore: move prompts to system/ directory" },
    { hash: "0d1e2f3", author: "alex", date: "2026-05-15T08:00:00Z", message: "eval: golden set v2 import" },
  ]),
  queryRows: [
    { _path: "system/code-review-v3.md", title: "Code review system prompt", version: 3, model: "gpt-4.1", label: "production" },
    { _path: "system/code-review-v2.md", title: "Code review system prompt", version: 2, model: "gpt-4.1", label: "staging" },
    { _path: "system/code-review-v1.md", title: "Code review system prompt", version: 1, model: "gpt-4o", label: "staging" },
    { _path: "system/summarization-v1.md", title: "Document summarization prompt", version: 1, model: "gpt-4.1-mini", label: "production" },
    { _path: "system/translation-v1.md", title: "EN→ES technical translation prompt", version: 1, model: "claude-sonnet-4", label: "production" },
    { _path: "evaluation/rubric.md", title: "Code review eval rubric", status: "active" },
    { _path: "evaluation/summarization-rubric.md", title: "Summarization rubric", status: "active" },
    { _path: "evaluation/translation-rubric.md", title: "Translation quality rubric", status: "active" },
  ],
  searchResults: demoSearch([
    { path: "system/code-review-v3.md", score: 0.98, snippet: "...<mark>chain-of-thought</mark> internally, then emit only the final JSON..." },
    { path: "evaluation/rubric.md", score: 0.85, snippet: "...<mark>Accuracy</mark> 0.35 — findings match ground-truth..." },
    { path: "system/summarization-v1.md", score: 0.79, snippet: "...120–180 words <mark>takeaways</mark>..." },
  ]),
  backlinks: demoBacklinks([
    { path: "system/code-review-v2.md", count: 2 },
    { path: "system/code-review-v1.md", count: 1 },
    { path: "evaluation/rubric.md", count: 3 },
  ]),
  comments: demoComments("system/code-review-v3.md", [
    {
      id: "p-c1",
      anchor: { quote: "blocker", prefix: "**", suffix: "**" },
      body: "Should SQL injection in string concat be blocker or major?",
      author: "sam",
      createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
      resolved: false,
    },
  ]),
  metaResults: [
    { path: "system/code-review-v3.md", frontmatter: { title: "Code review system prompt", version: 3, model: "gpt-4.1", label: "production", eval_score: 0.89 } },
    { path: "system/code-review-v2.md", frontmatter: { title: "Code review system prompt", version: 2, model: "gpt-4.1", label: "staging", eval_score: 0.76 } },
  ],
};
