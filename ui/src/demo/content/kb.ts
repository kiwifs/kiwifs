import * as blk from "../blocks";
import { demoBacklinks, demoComments, demoSearch } from "./mockExtras";

export const kbPages: Record<string, string> = {
  "index.md": `---
title: Recipe knowledge base
type: index
status: published
---

Governed articles for home bakers and support staff. Articles carry \`status\`, \`owner\`, and \`review_interval\` so stale content surfaces automatically.

${blk.progress({
  type: "bar",
  title: "Article health",
  items: [
    { label: "Verified", value: 92, color: "#22c55e" },
    { label: "Needs review", value: 18, color: "#eab308" },
    { label: "Draft", value: 6, color: "#64748b" },
  ],
})}

${blk.queryTable('TABLE title, type, status, owner FROM "recipes/" SORT status ASC')}

${blk.queryTable('TABLE title, status FROM "troubleshooting/" WHERE status = "verified"')}

> [!NOTE]
> External readers can browse published articles; internal editors see full governance metadata in frontmatter.
`,

  "recipes/sourdough.md": `---
title: Sourdough from active starter
type: how-to
status: verified
owner: kitchen-team
tags: [bread, fermentation, sourdough]
review_interval: 90
last_reviewed: 2026-05-02
---

A weekend loaf for home bakers — assumes you already maintain a starter (see [[starter/maintenance]]). If the crumb is dense, jump to [[troubleshooting/dense-loaf]] before changing hydration.

${blk.progress({
  type: "gauge",
  title: "Recipe at a glance",
  items: [
    { label: "Difficulty", value: 70 },
    { label: "Hands-on", value: 45 },
    { label: "Total time", value: 85 },
    { label: "Hydration", value: 76 },
  ],
})}

${blk.tabs([
  {
    label: "Stand mixer",
    body: `1. Mix flour, water, starter until shaggy (2 min low).
2. Rest **autolyse** 30 min — see [[techniques/autolyse]].
3. Add salt; mix 4 min medium.
4. Bulk ferment 4–5 h with [[techniques/stretch-fold|stretch-and-folds]] every 45 min.
5. Shape, proof 12–14 h cold, bake 450°F covered 20 min then open lid 25 min.`,
  },
  {
    label: "By hand",
    body: `Same timeline — skip the mixer. Use wet hands for folds; dough should pass the **windowpane test** before shaping (see [[techniques/windowpane]]).`,
  },
  {
    label: "Troubleshooting",
    body: `- Gummy crumb → bake longer, check internal temp 206°F
- Too sour → shorten cold proof or use younger starter
- Spread flat → tighten shaping, review [[troubleshooting/flat-loaf]]`,
  },
])}

${blk.columns("2:1", [
  `### Ingredients (1 loaf)

| Ingredient | Weight |
|------------|--------|
| Bread flour | 450 g |
| Water | 340 g (76%) |
| Starter (100% hydration) | 90 g |
| Salt | 10 g |

Linked techniques: [[techniques/scoring]], [[starter/feeding-schedule]].`,
  `### Equipment

- Dutch oven or combo cooker
- Bench scraper
- Rice flour for banneton
- Probe thermometer

**Owner:** kitchen-team · **Next review:** August 2026`,
])}

${blk.chart({
  type: "bar",
  title: "Bulk ferment time vs kitchen temp",
  xKey: "temp",
  grid: true,
  legend: true,
  series: [{ key: "hours", name: "Hours to 50% rise", color: "#84cc16" }],
  data: [
    { temp: "65°F", hours: 6.5 },
    { temp: "70°F", hours: 5 },
    { temp: "75°F", hours: 4 },
    { temp: "80°F", hours: 3 },
  ],
})}

${blk.mermaid(`graph TD
  A[Mix & autolyse] --> B{Starter active?}
  B -->|No| C[[starter/maintenance]]
  B -->|Yes| D[Bulk ferment]
  D --> E[Shape & cold proof]
  E --> F[Score & bake]
  F --> G{Crumb dense?}
  G -->|Yes| H[[troubleshooting/dense-loaf]]
  G -->|No| I[Done]`)}

${blk.colorPalette({
  name: "Crust & crumb",
  showContrast: true,
  colors: [
    { hex: "#c4a574", label: "Crust" },
    { hex: "#f5efe6", label: "Crumb" },
    { hex: "#8b6914", label: "Maillard deep" },
    { hex: "#84cc16", label: "Verified badge" },
  ],
})}

${blk.queryTable('TABLE title, status, tags FROM "recipes/" WHERE status = "verified" SORT title ASC')}

> [!TIP] Verification
> This article was last reviewed against 12 production bakes in May 2026. Report drift in comments.
`,

  "recipes/rye-crisp.md": `---
title: Scandinavian rye crispbread
type: how-to
status: verified
owner: kitchen-team
tags: [bread, rye, crisp]
review_interval: 120
---

Thin, snappy crackers — roll almost translucent. Uses the same [[starter/maintenance|starter]] as [[recipes/sourdough]] but higher rye ratio (40%).

## Formula

- Rye flour 200 g, bread flour 300 g, starter 80 g, water 280 g, salt 8 g, caraway 1 tbsp optional

Bake at 475°F on perforated pan 12–14 min until edges curl. Store in tin 2 weeks.

See also [[recipes/focaccia]] for a soft contrast.`,
  "recipes/focaccia.md": `---
title: Same-day focaccia
type: how-to
status: verified
owner: kitchen-team
tags: [bread, italian, yeasted]
---

Olive-oil rich, dimpled top — **no starter required**. High hydration dough; handle with oiled hands only.

${blk.chart({
  type: "line",
  title: "Oven spring (internal temp)",
  xKey: "minute",
  series: [{ key: "temp", name: "°F", color: "#f97316" }],
  data: [
    { minute: "0", temp: 70 },
    { minute: "10", temp: 140 },
    { minute: "20", temp: 195 },
    { minute: "25", temp: 205 },
  ],
})}`,
  "recipes/pizza-dough.md": `---
title: 48-hour pizza dough
type: how-to
status: draft
owner: kitchen-team
tags: [bread, pizza]
---

Cold ferment in fridge — link to [[techniques/autolyse]] optional. Pending verification bake-off vs existing FAQ.`,
  "techniques/autolyse.md": `---
title: Autolyse
type: reference
status: verified
owner: kitchen-team
tags: [technique, fundamentals]
---

Rest flour and water **before** salt and preferment. Relaxes gluten, reduces mix time.

Used in [[recipes/sourdough]], optional in [[recipes/pizza-dough]]. Typically 20–60 minutes covered at room temp.

${blk.mermaid(`sequenceDiagram
  participant Baker
  participant Dough
  Baker->>Dough: Combine flour + water
  Note over Dough: Autolyse 30-60 min
  Baker->>Dough: Add salt + starter
  Dough-->>Baker: Ready for bulk`)}
`,
  "techniques/stretch-fold.md": `---
title: Stretch and fold
type: reference
status: verified
tags: [technique, fermentation]
---

During bulk fermentation: wet hand under dough, stretch north, fold south. Rotate 90°, repeat. 4 folds per session, 3–4 sessions typical for [[recipes/sourdough]].`,
  "techniques/scoring.md": `---
title: Scoring loaves
type: reference
status: verified
tags: [technique, baking]
---

Single confident slash for oven spring on boules; ear forms when blade meets taut skin at 30° angle. Practice on [[recipes/sourdough]] before [[recipes/rye-crisp]].`,
  "techniques/windowpane.md": `---
title: Windowpane test
type: reference
status: verified
tags: [technique, gluten]
---

Stretch a small piece until light passes through without tearing. Indicates adequate gluten development before shaping.`,
  "starter/maintenance.md": `---
title: Starter maintenance
type: reference
status: verified
owner: kitchen-team
tags: [starter, fermentation]
review_interval: 60
---

## Daily rhythm

Feed 1:5:5 (starter : flour : water by weight) if baking weekly. Smell should be fruity-yeasty, not nail polish.

${blk.tabs([
  {
    label: "Room temp",
    body: "Feed every 12–24 h. Use peak activity (domed, just starting to fall) for [[recipes/sourdough]].",
  },
  {
    label: "Fridge",
    body: "Feed weekly. Take out 2 days before bake; 2–3 feeds to reactivate.",
  },
  {
    label: "Revive neglected",
    body: "Discard all but 10 g · feed · repeat 3 days · see [[troubleshooting/starter-slow]]",
  },
])}

Linked from [[recipes/sourdough]], [[recipes/rye-crisp]], [[faq/discarding-starter]].`,
  "starter/feeding-schedule.md": `---
title: Feeding schedule cheat sheet
type: reference
status: verified
tags: [starter]
---

| Scenario | Ratio | When |
|----------|-------|------|
| Maintenance | 1:5:5 | Daily or weekly (fridge) |
| Pre-bake boost | 1:2:2 | 4–6 h before mix |
| Discard bake | 1:1:1 | Same day crackers |`,
  "troubleshooting/dense-loaf.md": `---
title: Why is my loaf dense?
type: troubleshooting
status: verified
owner: kitchen-team
tags: [troubleshooting, sourdough]
---

${blk.mermaid(`graph TD
  A[Dense crumb] --> B{Starter weak?}
  B -->|Yes| C[[starter/maintenance]]
  B -->|No| D{Under proofed?}
  D -->|Yes| E[Extend bulk or proof]
  D -->|No| F{Under baked?}
  F -->|Yes| G[Probe 206°F]
  F -->|No| H[Check hydration vs flour]`)}

Most common fix for [[recipes/sourdough]] bakers: **under-proofed** cold retard — poke should slow spring back, not snap back instantly.`,
  "troubleshooting/flat-loaf.md": `---
title: Loaf spreads instead of rising
type: troubleshooting
status: verified
tags: [troubleshooting, shaping]
---

Usually shaping tension or over-proofing. Review [[techniques/scoring]] entry angle and bench rest. Cross-link [[techniques/windowpane]] for gluten strength.`,
  "troubleshooting/starter-slow.md": `---
title: Starter takes 24h to peak
type: troubleshooting
status: verified
tags: [starter, troubleshooting]
---

Temperature, flour type, or contamination. Switch to unbleached bread flour; keep 75°F; discard aggressively per [[starter/feeding-schedule]].`,
  "faq/discarding-starter.md": `---
title: Do I have to throw discard away?
type: faq
status: verified
tags: [starter, faq]
---

No — use in [[recipes/rye-crisp]] or pancakes same day. Never keep unfed discard more than 24 h room temp.`,
  "reference/hydration-chart.md": `---
title: Hydration reference
type: reference
status: verified
tags: [reference, baking]
---

| Style | Hydration | Example |
|-------|-----------|---------|
| Sandwich | 65–68% | — |
| Sourdough | 75–80% | [[recipes/sourdough]] |
| Focaccia | 80–85% | [[recipes/focaccia]] |
| Ciabatta | 85%+ | — |`,
};

export const kbMock = {
  graphNodes: [
    { path: "recipes/sourdough.md", tags: ["bread", "verified"] },
    { path: "recipes/rye-crisp.md", tags: ["bread"] },
    { path: "recipes/focaccia.md", tags: ["bread"] },
    { path: "recipes/pizza-dough.md", tags: ["draft"] },
    { path: "techniques/autolyse.md", tags: ["technique"] },
    { path: "techniques/stretch-fold.md", tags: ["technique"] },
    { path: "techniques/scoring.md", tags: ["technique"] },
    { path: "techniques/windowpane.md", tags: ["technique"] },
    { path: "starter/maintenance.md", tags: ["starter"] },
    { path: "starter/feeding-schedule.md", tags: ["starter"] },
    { path: "troubleshooting/dense-loaf.md", tags: ["troubleshooting"] },
    { path: "troubleshooting/flat-loaf.md", tags: ["troubleshooting"] },
    { path: "faq/discarding-starter.md", tags: ["faq"] },
  ],
  graphEdges: [
    { source: "recipes/sourdough.md", target: "techniques/autolyse.md" },
    { source: "recipes/sourdough.md", target: "techniques/stretch-fold.md" },
    { source: "recipes/sourdough.md", target: "techniques/scoring.md" },
    { source: "recipes/sourdough.md", target: "starter/maintenance.md" },
    { source: "recipes/sourdough.md", target: "troubleshooting/dense-loaf.md" },
    { source: "recipes/rye-crisp.md", target: "starter/maintenance.md" },
    { source: "recipes/focaccia.md", target: "techniques/autolyse.md" },
    { source: "troubleshooting/dense-loaf.md", target: "starter/maintenance.md" },
    { source: "troubleshooting/flat-loaf.md", target: "techniques/scoring.md" },
    { source: "starter/maintenance.md", target: "starter/feeding-schedule.md" },
    { source: "faq/discarding-starter.md", target: "recipes/rye-crisp.md" },
    { source: "index.md", target: "recipes/sourdough.md" },
  ],
  searchResults: demoSearch([
    { path: "recipes/sourdough.md", score: 0.96, snippet: "...bulk <mark>fermentation</mark> 4–5 h with stretch-and-folds..." },
    { path: "troubleshooting/dense-loaf.md", score: 0.89, snippet: "...<mark>fermentation</mark> — poke should slow spring back..." },
    { path: "starter/maintenance.md", score: 0.84, snippet: "...Feed every 12–24 h at room <mark>temp</mark>..." },
    { path: "techniques/autolyse.md", score: 0.78, snippet: "...Rest flour and water before salt and <mark>preferment</mark>..." },
  ]),
  backlinks: demoBacklinks([
    { path: "starter/maintenance.md", count: 5 },
    { path: "techniques/autolyse.md", count: 3 },
    { path: "recipes/sourdough.md", count: 2 },
  ]),
  comments: demoComments("recipes/sourdough.md", [
    {
      id: "c1",
      anchor: { quote: "76%", prefix: "Water ", suffix: " starter" },
      body: "Should we add a 78% variant for humid climates?",
      author: "jamie",
      createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
      resolved: false,
    },
  ]),
  queryRows: [
    { _path: "recipes/sourdough.md", title: "Sourdough from active starter", type: "how-to", status: "verified", owner: "kitchen-team" },
    { _path: "recipes/rye-crisp.md", title: "Scandinavian rye crispbread", type: "how-to", status: "verified", owner: "kitchen-team" },
    { _path: "recipes/focaccia.md", title: "Same-day focaccia", type: "how-to", status: "verified", owner: "kitchen-team" },
    { _path: "recipes/pizza-dough.md", title: "48-hour pizza dough", type: "how-to", status: "draft", owner: "kitchen-team" },
    { _path: "troubleshooting/dense-loaf.md", title: "Why is my loaf dense?", type: "troubleshooting", status: "verified", owner: "kitchen-team" },
  ],
  metaResults: [
    { path: "recipes/sourdough.md", frontmatter: { title: "Sourdough from active starter", status: "verified", tags: ["bread", "fermentation"] } },
    { path: "starter/maintenance.md", frontmatter: { title: "Starter maintenance", status: "verified", tags: ["starter"] } },
  ],
};
