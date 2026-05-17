import type {
  TreeEntry,
  SearchResult,
  Version,
  BacklinkEntry,
  Comment,
  GraphNode,
  GraphEdge,
} from "@kw/lib/api";

export const mockTree: TreeEntry = {
  path: "",
  name: "",
  isDir: true,
  children: [
    { path: "index.md", name: "index.md", isDir: false, size: 420 },
    { path: "welcome.md", name: "welcome.md", isDir: false, size: 1280 },
    {
      path: "pages",
      name: "pages",
      isDir: true,
      children: [
        { path: "pages/frontmatter.md", name: "frontmatter.md", isDir: false, size: 2100 },
        { path: "pages/wikilinks.md", name: "wikilinks.md", isDir: false, size: 1800 },
        { path: "pages/use-sqlite-for-search.md", name: "use-sqlite-for-search.md", isDir: false, size: 3200 },
      ],
    },
    {
      path: "episodes",
      name: "episodes",
      isDir: true,
      children: [
        { path: "episodes/example-episode.md", name: "example-episode.md", isDir: false, size: 5400 },
      ],
    },
  ],
};

export const mockMarkdownSimple = `---
title: Welcome to KiwiFS
---

KiwiFS is a knowledge filesystem that turns a folder of Markdown files into a browsable, searchable wiki.

## Getting Started

Create a new \`.md\` file in your knowledge directory and it will appear in the tree automatically.

\`\`\`bash
echo "# My First Page" > my-page.md
\`\`\`

That's it — open your browser and start writing.
`;

export const mockMarkdownRich = `---
title: Frontmatter Guide
tags:
  - documentation
  - guide
  - metadata
status: published
date: 2025-12-15
author: Kiwi Team
priority: high
---

## Overview

Frontmatter is YAML metadata placed at the top of a Markdown file between triple-dashed lines. KiwiFS uses frontmatter to power search, filtering, and display.

## Supported Fields

| Field | Type | Description |
|-------|------|-------------|
| title | string | Page title displayed in the header |
| tags | list | Categorization labels |
| status | string | Workflow status (draft, published, etc.) |
| date | string | ISO date for the page |

### Title

The \`title\` field overrides the filename-derived title:

\`\`\`yaml
title: My Custom Title
\`\`\`

### Tags

Tags can be a single value or a list:

\`\`\`yaml
tags:
  - documentation
  - guide
\`\`\`

## Math Support

KiwiFS supports KaTeX math blocks:

$$
E = mc^2
$$

## Wiki Links

Link to other pages using double brackets: [[wikilinks]].

You can also link to pages that don't exist yet: [[future-page]].

> ℹ️ Frontmatter fields are indexed by the search engine and can be used with field filters like \`status:published\`.

> ⚠️ Invalid YAML in frontmatter will cause the parser to fall back to plain text rendering.

## Related Pages

See also [[use-sqlite-for-search]] for how search indexing works.

![Architecture diagram](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iI2YxZjVmOSIgcng9IjgiLz48dGV4dCB4PSIyMDAiIHk9IjEwNSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQiIGZpbGw9IiM2NDc0OGIiPkFyY2hpdGVjdHVyZSBEaWFncmFtIFBsYWNlaG9sZGVyPC90ZXh0Pjwvc3ZnPg==)
`;

export const mockMarkdownExcalidraw = `---
excalidraw-plugin: parsed
tags:
  - diagram
  - excalidraw
---

# Excalidraw Drawing

## Drawing

\`\`\`json
{
  "type": "excalidraw",
  "version": 2,
  "source": "https://github.com/zsviczian/obsidian-excalidraw-plugin",
  "elements": [
    {
      "id": "rect1",
      "type": "rectangle",
      "x": 100,
      "y": 100,
      "width": 200,
      "height": 100,
      "angle": 0,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "#a5d8ff",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "roughness": 1,
      "opacity": 100,
      "roundness": { "type": 3 },
      "seed": 1234,
      "version": 1,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1700000000000,
      "link": null,
      "locked": false,
      "groupIds": [],
      "frameId": null
    },
    {
      "id": "text1",
      "type": "text",
      "x": 140,
      "y": 135,
      "width": 120,
      "height": 30,
      "angle": 0,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "roughness": 1,
      "opacity": 100,
      "roundness": null,
      "seed": 5678,
      "version": 1,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1700000000000,
      "link": null,
      "locked": false,
      "text": "KiwiFS",
      "fontSize": 20,
      "fontFamily": 1,
      "textAlign": "center",
      "verticalAlign": "middle",
      "containerId": null,
      "originalText": "KiwiFS",
      "autoResize": true,
      "lineHeight": 1.25,
      "groupIds": [],
      "frameId": null
    }
  ],
  "appState": {
    "gridSize": null,
    "viewBackgroundColor": "#ffffff"
  },
  "files": {}
}
\`\`\`
`;

/**
 * Body-only versions (frontmatter stripped) for stories that render
 * markdown with bare ReactMarkdown and don't have gray-matter.
 */
export const mockMarkdownRichBody = mockMarkdownRich
  .replace(/^---[\s\S]*?---\n*/, "");

export const mockMarkdownSimpleBody = mockMarkdownSimple
  .replace(/^---[\s\S]*?---\n*/, "");

export const mockMarkdownMermaid = `---
title: Mermaid Diagram
tags:
  - diagrams
---

# Mermaid Diagram

\`\`\`mermaid
graph TD
  A[Start] --> B{Decision}
  B -->|Yes| C[OK]
  B -->|No| D[End]
\`\`\`
`;

export const mockMarkdownRenderingTest = `---
title: Rendering Test — All Features
tags:
  - test
  - rendering
author: Kiwi Team
---

## Highlight Syntax

This is ==highlighted text== in a sentence. Multiple ==highlights== can appear ==on one line==.

## Obsidian Comments

This text is visible. %%This comment is hidden from render.%% And this is visible again.

%%
This is a multi-line
hidden comment block.
%%

## GitHub-style Admonitions (All Types)

> [!NOTE]
> This is a note admonition with **bold** and \`code\`.

> [!TIP]
> A helpful tip for users.

> [!IMPORTANT]
> Critical information that users need to know.

> [!WARNING]
> Something that could cause problems.

> [!CAUTION]
> Dangerous action that could have consequences.

### Extended Admonition Types

> [!INFO]
> An info admonition (alias of Note).

> [!HINT]
> A hint admonition (alias of Tip).

> [!SUCCESS]
> A success admonition.

> [!QUESTION]
> Is this rendering correctly?

> [!EXAMPLE]
> This is an example callout.

> [!ABSTRACT]
> This is an abstract/summary callout.

> [!BUG]
> This is a bug report callout.

> [!DANGER]
> This is a danger callout.

> [!FAILURE]
> This is a failure callout.

> [!QUOTE]
> To be or not to be — Shakespeare

### Callout Custom Titles

> [!NOTE] Custom Title Here
> This note has a custom title instead of "Note".

> [!WARNING] Be Careful!
> This warning has a custom title.

### Callout Fold Markers

> [!TIP]- Collapsed by default
> This content is hidden until you click the title.

> [!NOTE]+ Expanded by default
> This content is visible but can be collapsed.

## Code Block with Title & Line Highlighting

\`\`\`typescript title="config.ts" {1,3-5}
interface KiwiConfig {
  dataDir: string;
  port: number;
  search: {
    vector?: { enabled: boolean; embedder: string };
  };
}
\`\`\`

## Code Block Language Label

\`\`\`python
def hello():
    print("Hello from KiwiFS!")
\`\`\`

\`\`\`rust
fn main() {
    println!("Hello, world!");
}
\`\`\`

## Diff Code Block

\`\`\`diff
- const old = "remove this";
+ const new = "add this";
  const unchanged = "stays the same";
- removed_function();
+ added_function();
\`\`\`

## Emoji Shortcodes

Hello :wave: welcome to KiwiFS :rocket: Let's build something great :tada:

## Superscript & Subscript

Water is H~2~O. Einstein's equation: E = mc^2^.

The 1^st^ item, the 2^nd^ item, and the 3^rd^ item.

## Inline Tags

This paragraph has #documentation and #guide tags inline. Nested tags like #project/alpha also work.

## Definition Lists

Term 1
: Definition for term 1

Term 2
: First definition for term 2
: Second definition for term 2

## Mermaid Diagram

\`\`\`mermaid
graph TD
  A[Start] --> B{Decision}
  B -->|Yes| C[OK]
  B -->|No| D[End]
\`\`\`

## Wide Table with Alignment

| Left | Center | Right | Default |
|:-----|:------:|------:|---------|
| L1   |   C1   |    R1 | D1      |
| L2   |   C2   |    R2 | D2      |
| L3   |   C3   |    R3 | D3      |

## Collapsible Details

<details>
<summary>Click to expand — hidden content inside</summary>

This section is collapsible. It supports **bold**, *italic*, and \`inline code\`.

- Bullet one
- Bullet two

</details>

## Keyboard Shortcuts

Press <kbd>Ctrl</kbd>+<kbd>C</kbd> to copy and <kbd>Ctrl</kbd>+<kbd>V</kbd> to paste.

## Task Lists

- [x] Highlight syntax
- [x] Obsidian comments
- [x] Extended callout types
- [x] Callout custom titles
- [x] Callout fold markers
- [ ] More features coming

## Footnotes

KiwiFS uses SQLite FTS5 for full-text search[^1]. The indexer runs asynchronously[^2].

[^1]: FTS5 is SQLite's built-in full-text search extension with BM25 ranking.
[^2]: Async indexing drops write latency from ~5.5ms to ~1ms.

## Math

$$
\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}
$$

Inline math: $E = mc^2$ in a sentence.

## Strikethrough & Emphasis

This text is normal but ~~this text is deleted~~ and this is normal again.

## Wiki Links with Heading Anchors

Link to [[wikilinks]] and a link with anchor [[wikilinks#advanced-usage]].

## Image Caption from Alt

![A beautiful sunset over the mountains](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iI2YxZjVmOSIgcng9IjgiLz48dGV4dCB4PSIyMDAiIHk9IjEwNSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQiIGZpbGw9IiM2NDc0OGIiPkxhbmRzY2FwZSBJbWFnZSBQbGFjZWhvbGRlcjwvdGV4dD48L3N2Zz4=)
`;

export const mockSearchResults: SearchResult[] = [
  {
    path: "pages/frontmatter.md",
    score: 0.95,
    snippet: "Frontmatter is YAML metadata placed at the top of a <mark>Markdown</mark> file",
    matches: [{ line: 12, text: "Frontmatter is YAML metadata..." }],
  },
  {
    path: "pages/wikilinks.md",
    score: 0.82,
    snippet: "Wiki links use double brackets to create connections between <mark>pages</mark>",
    matches: [{ line: 5, text: "Wiki links use double brackets..." }],
  },
  {
    path: "pages/use-sqlite-for-search.md",
    score: 0.71,
    snippet: "SQLite FTS5 provides full-text <mark>search</mark> with ranking",
    matches: [{ line: 20, text: "SQLite FTS5 provides..." }],
  },
  {
    path: "episodes/example-episode.md",
    score: 0.55,
    snippet: "This episode covers the basics of <mark>knowledge</mark> management",
  },
];

export const mockVersions: Version[] = [
  {
    hash: "a1b2c3d",
    author: "alice",
    date: "2025-12-15T10:30:00Z",
    message: "Update frontmatter documentation",
  },
  {
    hash: "e4f5g6h",
    author: "bob",
    date: "2025-12-14T16:45:00Z",
    message: "Add math support section",
  },
  {
    hash: "i7j8k9l",
    author: "alice",
    date: "2025-12-13T09:15:00Z",
    message: "Initial frontmatter guide",
  },
  {
    hash: "m0n1o2p",
    author: "charlie",
    date: "2025-12-12T14:00:00Z",
    message: "Create pages directory",
  },
];

export const mockBacklinks: BacklinkEntry[] = [
  { path: "welcome.md", count: 2 },
  { path: "pages/wikilinks.md", count: 1 },
  { path: "pages/use-sqlite-for-search.md", count: 1 },
];

export const mockComments: Comment[] = [
  {
    id: "c1",
    path: "pages/frontmatter.md",
    anchor: {
      quote: "Frontmatter is YAML metadata",
      prefix: "",
      suffix: " placed at the top",
    },
    body: "Should we mention TOML frontmatter support as a future possibility?",
    author: "alice",
    createdAt: "2025-12-15T11:00:00Z",
    resolved: false,
  },
  {
    id: "c2",
    path: "pages/frontmatter.md",
    anchor: {
      quote: "Tags can be a single value or a list",
      prefix: "### Tags\n\n",
      suffix: ":",
    },
    body: "Good explanation. Maybe add an example of nested tags?",
    author: "bob",
    createdAt: "2025-12-14T17:30:00Z",
    resolved: false,
  },
  {
    id: "c3",
    path: "pages/frontmatter.md",
    anchor: {
      quote: "Invalid YAML in frontmatter",
      prefix: "> ⚠️ ",
      suffix: " will cause",
    },
    body: "This was fixed in v0.3 — parser now shows a warning banner instead of breaking.",
    author: "charlie",
    createdAt: "2025-12-13T10:00:00Z",
    resolved: true,
  },
];

export const mockGraphNodes: GraphNode[] = [
  { path: "index.md", tags: [] },
  { path: "welcome.md", tags: [] },
  { path: "pages/frontmatter.md", tags: ["documentation", "guide"] },
  { path: "pages/wikilinks.md", tags: ["documentation"] },
  { path: "pages/use-sqlite-for-search.md", tags: ["architecture"] },
  { path: "episodes/example-episode.md", tags: ["episode"] },
];

export const mockGraphEdges: GraphEdge[] = [
  { source: "pages/frontmatter.md", target: "pages/wikilinks.md" },
  { source: "pages/frontmatter.md", target: "pages/use-sqlite-for-search.md" },
  { source: "welcome.md", target: "pages/frontmatter.md" },
  { source: "welcome.md", target: "pages/wikilinks.md" },
  { source: "index.md", target: "welcome.md" },
];
