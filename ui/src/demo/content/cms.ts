import type { WorkflowColumn, WorkflowDef } from "@kw/lib/api";
import * as blk from "../blocks";
import { demoBacklinks, demoComments, demoSearch } from "./mockExtras";

const editorialWorkflow: WorkflowDef = {
  name: "editorial",
  states: [
    { name: "draft", color: "#64748b" },
    { name: "review", color: "#f59e0b" },
    { name: "scheduled", color: "#3b82f6" },
    { name: "published", color: "#22c55e" },
    { name: "archived", color: "#94a3b8" },
  ],
  transitions: [
    { from: "draft", to: "review" },
    { from: "review", to: "scheduled" },
    { from: "review", to: "draft" },
    { from: "scheduled", to: "published" },
    { from: "published", to: "archived" },
  ],
};

export const cmsPages: Record<string, string> = {
  "index.md": `---
title: Editorial home
type: index
---

Type & Ink publishes long-form writing on typography, print history, and the craft of setting type for screens. Every article is markdown on disk — frontmatter drives the public reader, Kanban tracks editorial state.

${blk.progress({
  type: "bar",
  title: "Pipeline snapshot",
  items: [
    { label: "Published", value: 12, color: "#22c55e" },
    { label: "Scheduled", value: 2, color: "#3b82f6" },
    { label: "In review", value: 3, color: "#f59e0b" },
    { label: "Draft", value: 4, color: "#64748b" },
  ],
})}

${blk.queryTable('TABLE title, author, category, published FROM "blog/" SORT published DESC, title ASC')}

${blk.queryTable('TABLE title, role FROM "authors/"')}

> [!NOTE]
> Move cards on the **editorial** Kanban board to advance workflow. Published posts appear at \`/p/*\` with SEO metadata from frontmatter.
`,

  "blog/kerning.md": `---
title: The lost art of kerning
author: elena
category: typography
published: true
published_at: 2026-05-16T09:00:00Z
slug: lost-art-of-kerning
seo_description: Why manual kerning still matters when fonts ship with thousands of pairs — and how to train your eye.
reading_time: 12
featured: true
---

Digital fonts arrive with kerning tables covering common pairs — *To*, *Wa*, *Ly* — yet headlines still look loose or cramped. The gap is context: display sizes, reversed contrast, and letterforms the font engineer never anticipated in your exact word[^1].

${blk.columns("2:1", [
  `### When the table fails

Kerning pairs assume a default size and spacing. At 72 pt on a poster, built-in \`To\` kerning that looked fine at 12 pt may leave a canyon. Conversely, tight display cuts of grotesques can collide at text sizes.

**Signs you need manual kerning:**
- White triangles between diagonal stems (V–A, W–a)
- Optical center drift in all-caps logotypes
- Script or high-contrast faces where table coverage is thin

Tools like Glyphs and FontLab expose kerning classes; InDesign and Figma offer metrics overrides per pair. The skill is knowing *when* to override — not re-kerning every word.`,
  `### Quick reference

| Pair type | Typical fix |
|-----------|-------------|
| Diagonal + flat | Tighten |
| Round + round | Often default OK |
| T + lowercase | Check crossbar overlap |
| L + T | Add space (rare) |

See [[docs/style-guide]] for our house display face — **Söhne Breit** for headlines, **Inter** for body.`,
])}

${blk.chart({
  type: "line",
  title: "Posts published per month (2026)",
  xKey: "month",
  grid: true,
  legend: false,
  series: [{ key: "posts", name: "Posts", color: "#059669" }],
  data: [
    { month: "Jan", posts: 2 },
    { month: "Feb", posts: 1 },
    { month: "Mar", posts: 3 },
    { month: "Apr", posts: 2 },
    { month: "May", posts: 4 },
    { month: "Jun", posts: 1 },
  ],
})}

${blk.tabs([
  {
    label: "Draft notes",
    body: `Internal outline — not shown on public reader.

- Open with highway sign anecdote (already in intro)
- Section on variable font kerning axes — link [[blog/variable-fonts]]
- Pull quote: "Kerning is spacing with judgment"
- TODO: screenshot of Figma pair adjustment`,
  },
  {
    label: "Published",
    body: `This is the live version readers see at \`/p/lost-art-of-kerning\`.

- Footnotes render inline
- \`seo_description\` feeds Open Graph
- Related posts query pulls same \`category\`

Cross-links: [[blog/history-of-helvetica]], [[authors/elena]].`,
  },
  {
    label: "Changelog",
    body: `- 2026-05-16 — Published (elena)
- 2026-05-14 — Copy edit (marcus)
- 2026-05-10 — Moved to scheduled
- 2026-05-02 — Sent to review`,
  },
])}

## The highway sign test

Robert Bringhurst writes that letters exist to be read, not admired in isolation[^2]. A practical corollary: squint at a headline from three metres. If a pair catches your eye before the word does, kern it.

For body text, trust the font. Manual kerning at 16 px wastes time and breaks copy-paste. Reserve intervention for logotypes, book covers, and hero lines — the places [[blog/grid-systems]] alignment can't fix bad spacing.

${blk.mermaid(`flowchart LR
  A[Headline set] --> B{Pair looks off?}
  B -->|No| C[Ship]
  B -->|Yes| D[Check kerning table]
  D --> E{Fixed?}
  E -->|No| F[Manual adjust]
  E -->|Yes| C
  F --> G[Squint test]
  G --> C`)}

> [!QUOTE]
> "We read best what we read most." — The principle applies to spacing conventions too; your audience reads Helvetica metrics even when you set Meta.

[^1]: Hoefler & Co.'s *Taking Your Font to Market* covers class kerning limits.
[^2]: Bringhurst, *The Elements of Typographic Style*, §3.2.

${blk.queryTable('TABLE title, author FROM "blog/" WHERE category = "typography" AND published = true')}
`,

  "blog/variable-fonts.md": `---
title: Variable fonts in 2026
author: elena
category: typography
published: false
status: review
slug: variable-fonts-2026
seo_description: A practical guide to weight, width, and optical size axes — without breaking your layout grid.
scheduled_for: 2026-06-28T09:00:00Z
---

Two years ago, variable fonts were a conference demo. In 2026 they're default in Figma, shipped in every major system UI stack, and still misunderstood in production CSS.

## What actually varies

A variable font packs multiple masters into one file. Common registered axes:

| Axis | CSS | Use |
|------|-----|-----|
| Weight | \`wght\` | 100–900 |
| Width | \`wdth\` | condensed ↔ extended |
| Optical size | \`opsz\` | micro ↔ display |
| Slant | \`slnt\` | upright ↔ italic |

Custom axes — grade, softness, serif height — appear in display families. Always check the fvar table before assuming browser support.

${blk.chart({
  type: "area",
  title: "File size: static vs variable family",
  xKey: "weights",
  grid: true,
  legend: true,
  series: [
    { key: "static", name: "Static files (KB)", color: "#94a3b8" },
    { key: "variable", name: "Single VF (KB)", color: "#059669" },
  ],
  data: [
    { weights: "3", static: 180, variable: 220 },
    { weights: "6", static: 360, variable: 240 },
    { weights: "9", static: 540, variable: 260 },
    { weights: "12", static: 720, variable: 280 },
  ],
})}

## Production checklist

1. **Subset** — Latin only for English blogs; add Cyrillic if i18n
2. **Clamp weight** — \`font-weight: clamp(400, 2vw + 350, 700)\` can look clever and illegible
3. **Match fallbacks** — size-adjust on static fallback prevents CLS
4. **Opsz** — enable for long-form; disable for UI chrome

Scheduled after [[blog/kerning|the kerning piece]] lands — cross-link on optical size section. Reviewer: [[authors/marcus]].

${blk.diff({
  language: "css",
  title: "Static → variable migration",
  before: `@font-face {
  font-family: 'Newsreader';
  src: url('Newsreader-Bold.woff2') format('woff2');
  font-weight: 700;
}`,
  after: `@font-face {
  font-family: 'Newsreader';
  src: url('Newsreader-Variable.woff2') format('woff2');
  font-weight: 200 900;
  font-display: swap;
}`,
})}
`,

  "blog/history-of-helvetica.md": `---
title: Helvetica wasn't born neutral
author: marcus
category: history
published: false
status: review
slug: helvetica-not-neutral
seo_description: How Neue Haas Grotesk became Helvetica — and why "neutral" is a design fiction.
---

Helvetica's reputation as the invisible typeface ignores a specific history: Swiss marketing, Linotype's metal constraints, and American Modernism's appetite for "objective" corporate identity.

## Timeline

- **1957** — Max Miedinger and Eduard Hoffmann release *Neue Haas Grotesk* for Haas Type Foundry
- **1960** — Linotype renames it Helvetica (Latin for Switzerland) for global licensing
- **1984** — Desktop publishing democratises access; Helvetica ships with LaserWriter
- **2007** — Gary Hustwit's *Helvetica* documents the cult
- **2019** — Monotype releases Helvetica Now with optical sizes

${blk.columns("1:1", [
  `### What changed in translation

Metal to phototype to PostScript stripped handwriting warmth from letterforms. Linotype harmonised weights for machine setting — slightly uniformising apertures. The "neutral" look is partly **production compromise**, not pure intent.`,
  `### Reading today

Designers reach for Inter, Söhne, or Geist when they want Helvetica's clarity without the baggage. See our [[docs/style-guide]] — we use Söhne for brand, not Neue Haas revival cosplay.`,
])}

> [!NOTE]
> Pair with [[blog/kerning]] when discussing display vs text metrics in Helvetica Now's three optical masters.

Awaiting final fact-check on Linotype date citations before schedule slot opens.
`,

  "blog/grid-systems.md": `---
title: Grid systems for editorial web
author: marcus
category: layout
published: false
status: draft
slug: editorial-grid-systems
seo_description: From Müller-Brockmann to CSS Grid — building repeatable layout for long-form reading.
---

Print designers learned grids from Josef Müller-Brockmann; web designers inherit Bootstrap then rediscover subgrid. This draft outlines Type & Ink's column logic for articles like [[blog/kerning]].

## Working thesis

1. **Measure** — 60–75 characters for body; wider for sidenotes in \`:::columns\`
2. **Baseline rhythm** — 4 px grid in CSS; line-height multiples of 8
3. **Breakouts** — charts and pull quotes span 8 of 12 columns max
4. **Mobile** — single column first; never shrink type below 16 px

${blk.mermaid(`graph TD
  A[12-col grid] --> B[Body: cols 3-10]
  A --> C[Hero: cols 1-12]
  A --> D[Sidenote: cols 10-12]
  B --> E[Subgrid for figures]
  E --> F[Caption aligns to body measure]`)}

## TODO before review

- [ ] Screenshot Müller-Brockmann plate vs our CSS
- [ ] Code sample for \`grid-template-columns: repeat(12, 1fr)\`
- [ ] Link variable font sizing from [[blog/variable-fonts]]

Internal only — not scheduled until Q3.
`,

  "authors/elena.md": `---
title: Elena Park
role: Editor-in-chief
email: elena@typeandink.example
twitter: @elenatypes
joined: 2022-03-01
---

Elena trained as a letterpress printer before moving to digital product typography. She edits long-form pieces on spacing, font technology, and reading ergonomics.

## Published on Type & Ink

- [[blog/kerning|The lost art of kerning]] — featured
- [[blog/variable-fonts|Variable fonts in 2026]] — in review

## Speaking

ATypI 2025 — "Kerning tables vs judgment"; Typographics 2024 — variable font workshop.

> Editorial standard: every article gets a squint test before publish. See [[docs/style-guide]].
`,

  "authors/marcus.md": `---
title: Marcus Chen
role: Contributing editor
email: marcus@typeandink.example
specialty: type history
joined: 2023-09-15
---

Marcus writes on twentieth-century type marketing, identity systems, and the gap between foundry specimens and in-use reality. PhD coursework at RIT on Linotype adaptation strategies.

## In pipeline

- [[blog/history-of-helvetica|Helvetica wasn't born neutral]] — review
- [[blog/grid-systems|Grid systems for editorial web]] — draft

Copy-edits [[blog/kerning]] and handles citation checks. Collaborates with [[authors/elena]] on editorial calendar.
`,

  "docs/style-guide.md": `---
title: Type & Ink style guide
type: reference
status: published
---

House standards for web and print collateral. Authors reference this before submit; reviewers enforce it in Kanban **review** column.

## Typefaces

| Role | Family | Fallback |
|------|--------|----------|
| Display | Söhne Breit | system-ui |
| Body | Inter | Arial |
| Code | JetBrains Mono | monospace |

License files live in \`/assets/fonts/\` — do not commit vendor ZIPs.

${blk.colorPalette({
  name: "Editorial ink",
  showContrast: true,
  size: "large",
  colors: [
    { hex: "#0f172a", label: "Ink — primary text" },
    { hex: "#334155", label: "Slate — secondary" },
    { hex: "#059669", label: "Forest — links & accent" },
    { hex: "#f8fafc", label: "Paper — background" },
    { hex: "#f59e0b", label: "Amber — review state" },
    { hex: "#dc2626", label: "Red — correction marks" },
  ],
})}

## Spacing scale

Base unit **4 px**. Vertical rhythm: margins and padding in multiples of 8. Headline-to-deck gap: 16 px. Section breaks: 48 px.

## Voice

- Prefer concrete examples over adjectives ("72 pt headline" not "large type")
- Cite sources in footnotes, not inline URLs
- No "Acme Corp" placeholder names — use real foundries and designers

${blk.tabs([
  {
    label: "Headlines",
    body: "Söhne Breit 600, tracking −0.02em, line-height 1.1. Kerning manual pass required above 32 px.",
  },
  {
    label: "Body",
    body: "Inter 400/17 px, line-height 1.6, measure 68 ch max. Enable \`opsz\` on variable cuts.",
  },
  {
    label: "Captions",
    body: "Inter 500/13 px, uppercase labels discouraged. Colour: slate secondary.",
  },
])}

Linked from [[blog/kerning]], [[authors/elena]], [[authors/marcus]].
`,
};

export const cmsMock = {
  workflows: [editorialWorkflow],
  workflowBoards: {
    editorial: {
      columns: [
        {
          state: "draft",
          color: "#64748b",
          pages: [
            { path: "blog/grid-systems.md", title: "Grid systems for editorial web", modified: new Date(Date.now() - 86400000 * 5).toISOString() },
            { path: "blog/draft-typographic-rhythm.md", title: "Typographic rhythm on the web", modified: new Date(Date.now() - 86400000 * 2).toISOString() },
          ],
        },
        {
          state: "review",
          color: "#f59e0b",
          pages: [
            { path: "blog/variable-fonts.md", title: "Variable fonts in 2026", modified: new Date(Date.now() - 86400000).toISOString() },
            { path: "blog/history-of-helvetica.md", title: "Helvetica wasn't born neutral", modified: new Date(Date.now() - 3600000 * 8).toISOString() },
          ],
        },
        {
          state: "scheduled",
          color: "#3b82f6",
          pages: [
            { path: "blog/variable-fonts.md", title: "Variable fonts in 2026", modified: new Date(Date.now() - 3600000 * 2).toISOString() },
            { path: "blog/draft-interview-hoefler.md", title: "Interview: optical sizes in practice", modified: new Date(Date.now() - 86400000 * 3).toISOString() },
          ],
        },
        {
          state: "published",
          color: "#22c55e",
          pages: [
            { path: "blog/kerning.md", title: "The lost art of kerning", modified: new Date(Date.now() - 86400000 * 35).toISOString() },
            { path: "blog/published-legibility.md", title: "Legibility vs readability", modified: new Date(Date.now() - 86400000 * 60).toISOString() },
          ],
        },
        {
          state: "archived",
          color: "#94a3b8",
          pages: [
            { path: "blog/archived-2019-webfonts.md", title: "Web fonts in 2019 (archived)", modified: new Date(Date.now() - 86400000 * 400).toISOString() },
          ],
        },
      ] as WorkflowColumn[],
    },
  },
  timelineEvents: [
    { type: "write", path: "blog/kerning.md", title: "The lost art of kerning", actor: "elena", timestamp: new Date(Date.now() - 3600000).toISOString(), message: "Publish" },
    { type: "write", path: "blog/variable-fonts.md", title: "Variable fonts in 2026", actor: "elena", timestamp: new Date(Date.now() - 86400000).toISOString(), message: "Send to review" },
    { type: "write", path: "blog/history-of-helvetica.md", title: "Helvetica wasn't born neutral", actor: "marcus", timestamp: new Date(Date.now() - 86400000 * 2).toISOString(), message: "First draft complete" },
    { type: "write", path: "blog/grid-systems.md", title: "Grid systems for editorial web", actor: "marcus", timestamp: new Date(Date.now() - 86400000 * 3).toISOString(), message: "Outline started" },
    { type: "write", path: "docs/style-guide.md", title: "Type & Ink style guide", actor: "elena", timestamp: new Date(Date.now() - 86400000 * 7).toISOString(), message: "Add color palette" },
    { type: "write", path: "blog/variable-fonts.md", title: "Variable fonts in 2026", actor: "marcus", timestamp: new Date(Date.now() - 86400000 * 4).toISOString(), message: "Copy edit pass" },
    { type: "write", path: "authors/marcus.md", title: "Marcus Chen", actor: "elena", timestamp: new Date(Date.now() - 86400000 * 10).toISOString(), message: "Author bio update" },
  ],
  queryRows: [
    { _path: "blog/kerning.md", title: "The lost art of kerning", author: "elena", category: "typography", published: true },
    { _path: "blog/variable-fonts.md", title: "Variable fonts in 2026", author: "elena", category: "typography", published: false },
    { _path: "blog/history-of-helvetica.md", title: "Helvetica wasn't born neutral", author: "marcus", category: "history", published: false },
    { _path: "blog/grid-systems.md", title: "Grid systems for editorial web", author: "marcus", category: "layout", published: false },
  ],
  searchResults: demoSearch([
    { path: "blog/kerning.md", score: 0.97, snippet: "...manual <mark>kerning</mark> at 72 pt on a poster..." },
    { path: "blog/variable-fonts.md", score: 0.88, snippet: "...variable <mark>fonts</mark> are default in Figma..." },
    { path: "docs/style-guide.md", score: 0.84, snippet: "...<mark>Söhne Breit</mark> for headlines, Inter for body..." },
    { path: "blog/history-of-helvetica.md", score: 0.79, snippet: "...Neue Haas <mark>Grotesk</mark> became Helvetica..." },
  ]),
  backlinks: demoBacklinks([
    { path: "blog/kerning.md", count: 4 },
    { path: "docs/style-guide.md", count: 3 },
    { path: "authors/elena.md", count: 2 },
  ]),
  comments: demoComments("blog/kerning.md", [
    {
      id: "c1",
      anchor: { quote: "squint test", prefix: "practical corollary: ", suffix: " from three metres" },
      body: "Add photo example from the highway sign anecdote?",
      author: "marcus",
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      resolved: false,
    },
    {
      id: "c2",
      anchor: { quote: "variable font kerning axes", prefix: "Section on ", suffix: " — link" },
      body: "Linked — good to go once VF post publishes.",
      author: "elena",
      createdAt: new Date(Date.now() - 3600000 * 12).toISOString(),
      resolved: true,
    },
  ]),
  metaResults: [
    { path: "blog/kerning.md", frontmatter: { title: "The lost art of kerning", author: "elena", published: true, category: "typography" } },
    { path: "blog/variable-fonts.md", frontmatter: { title: "Variable fonts in 2026", author: "elena", published: false, status: "review" } },
    { path: "docs/style-guide.md", frontmatter: { title: "Type & Ink style guide", type: "reference", status: "published" } },
  ],
};
