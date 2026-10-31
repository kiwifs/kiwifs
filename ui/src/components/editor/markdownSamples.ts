export const markdownSamples = {
  frontmatterAndTable: `---
title: OpenCode Tutorial for Beginners - Setup, Agents, Skills & MCP 학습 노트
tags:
  - opencode
  - ai-agent
  - mcp
status: draft
---

# OpenCode Tutorial for Beginners

| Section | Detail | Status |
| --- | --- | --- |
| Setup | Install CLI and configure provider | Done |
| Agents | Define skills and prompts | Review |
| MCP | Connect filesystem and wiki tools | Draft |

[[10 Ingest/OpenCode Tutorial]]
`,
  simpleMarkdown: `# Simple Note

This document has paragraphs, **bold**, and a list.

- one
- two
`,
  denseTyping: `# Daily Log

- [ ] Review KiwiFS frontmatter patch
- [ ] Keep raw Markdown safe
- [ ] Add Storybook states

\`inline code\` and [a link](https://example.com).
`,
  longNote: `${"## Section\n\nParagraph text with [[Wiki Link]] and a table reference.\n\n".repeat(40)}`,
  livePreview: `---
title: Release checklist
tags: [ops, release]
---

# Release checklist

Run this **before every tagged release**. See [[Getting Started]], the
[deploy guide](https://example.com/deploy), and \`kiwifs reindex\` for search.

## Steps

- [x] Freeze the branch
- [ ] Run the *full* test suite
- [ ] Tag and push
  - nested detail with ~~old~~ new wording

> [!note] Agents can run every step through MCP.

---

\`\`\`array
values: [3, 1, 4, 1, 5]
highlightIndices: [2]
\`\`\`

\`\`\`ts
export const done = true;
\`\`\`
`,
} as const;
