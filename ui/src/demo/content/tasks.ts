import {
  chart,
  progress,
  colorPalette,
  tabs,
  columns,
  queryTable,
  mermaid,
  kiwiApp,
  playground,
  diff,
  counterApp,
  eventCounterApp,
} from "../blocks";
import { demoBacklinks, demoComments, demoSearch } from "./mockExtras";
import type { MockSavedView } from "@kw/components/__mocks__/data";
import type { WorkflowColumn, WorkflowDef } from "@kw/lib/api";

const tasksWorkflow: WorkflowDef = {
  name: "tasks",
  states: [
    { name: "backlog", color: "#64748b" },
    { name: "todo", color: "#3b82f6", wip_limit: 5 },
    { name: "in_progress", color: "#f59e0b", wip_limit: 3 },
    { name: "review", color: "#8b5cf6", wip_limit: 2 },
    { name: "done", color: "#22c55e" },
  ],
  transitions: [
    { from: "backlog", to: "todo" },
    { from: "todo", to: "in_progress" },
    { from: "in_progress", to: "review" },
    { from: "review", to: "done" },
    { from: "in_progress", to: "backlog" },
    { from: "review", to: "in_progress" },
  ],
};

const now = Date.now();
const iso = (daysAgo: number) => new Date(now - daysAgo * 86400000).toISOString();

export const tasksPages: Record<string, string> = {
  "index.md": `---
title: Sprint 4 — Recipe sharing app
type: sprint
status: active
sprint: 4
goal: Ship MVP recipe CRUD + social sharing loop
kiwi-view: true
---

**Product:** *Pinch* — mobile-first recipe sharing (React Native). This sprint closes the create → photo → share loop before TestFlight beta.

Open the **Kanban** view for live board state (\`tasks\` workflow). WIP limits: Todo 5 · In progress 3 · Review 2.

${progress({
  type: "gauge",
  title: "Sprint 4 progress",
  showPercent: true,
  items: [
    { label: "Story points done", value: 34, max: 55 },
    { label: "Days elapsed", value: 8, max: 10 },
    { label: "Beta readiness", value: 62 },
    { label: "Test coverage", value: 71 },
  ],
})}

${chart({
  type: "bar",
  title: "Burndown (story points remaining)",
  xKey: "day",
  grid: true,
  legend: false,
  series: [{ key: "points", name: "Remaining", color: "#f97316" }],
  data: [
    { day: "Mon", points: 55 },
    { day: "Tue", points: 48 },
    { day: "Wed", points: 41 },
    { day: "Thu", points: 33 },
    { day: "Fri", points: 28 },
    { day: "Mon", points: 21 },
  ],
})}

${queryTable('TABLE title, status, priority, assignee FROM "tasks/" WHERE status != "done" SORT priority ASC')}

${columns("1:1", [
  `### In flight

| Task | Owner | Risk |
|------|-------|------|
| [[tasks/recipe-import]] | maya | Medium — CSV edge cases |
| [[tasks/photo-upload]] | devon | **Blocked** on storage quota |
| [[tasks/push-notifications]] | riley | In review |

### Up next

[[tasks/collections-crud]], [[tasks/recipe-search-filter]], [[tasks/cook-mode-timer]]`,
  `### Sprint notes

- Design sign-off on share sheet: Figma v3 (June 12)
- Backend staging: \`api.pinch-dev.app\`
- QA build: TestFlight **0.4.0-build.42**

${counterApp}

> [!WARNING]
> Photo upload blocked until infra raises S3 presigned URL quota — track in [[tasks/photo-upload]].`,
])}

${eventCounterApp}

${kiwiApp(140, `<div style="font-family:system-ui;padding:8px 12px;display:flex;align-items:center;gap:12px">
  <div style="width:10px;height:10px;border-radius:50%;background:#22c55e"></div>
  <div><strong>Kanban</strong> · 9 cards · 1 blocked</div>
</div>`)}
`,

  "tasks/recipe-import.md": `---
title: Recipe import (CSV + URL)
type: task
status: in_progress
priority: 1
assignee: maya
tags: [core, import, mobile]
sprint: 4
estimate: 8
---

Import recipes from CSV export (Paprika, Mela) and public URL scrape (schema.org \`Recipe\` JSON-LD).

## Acceptance criteria

- [x] CSV parser handles UTF-8 BOM and quoted multiline ingredients
- [x] Duplicate detection by title + ingredient fingerprint (Jaccard > 0.85)
- [ ] Preview screen: edit title, swap hero photo, discard rows
- [ ] URL import: timeout 8s, fallback to manual paste
- [ ] Error toast for unsupported formats with link to help doc
- [ ] Analytics event \`recipe_import_completed\` with source enum

## Technical notes

${tabs([
  {
    label: "Mobile",
    body: `Use \`expo-document-picker\` for CSV. Stream parse with \`papaparse\` — don't load 5MB file into memory at once.

Preview navigates to \`ImportPreviewScreen\` with draft \`Recipe\` in Zustand (not persisted until confirm).`,
  },
  {
    label: "API",
    body: `\`POST /v1/recipes/import\` accepts \`{ source: "csv" | "url", payload }\`.

Server normalizes units (cup → ml optional). Returns \`{ draft_id, warnings[] }\`.`,
  },
  {
    label: "QA",
    body: `Fixtures in \`apps/mobile/__fixtures__/imports/\`. Regression: Paprika export with 200 recipes < 30s on iPhone 12.`,
  },
])}

Depends on [[tasks/onboarding-flow]] (empty state CTA). Blocks [[tasks/share-recipes]] until import ships.

${mermaid(`graph LR
  A[Pick file / paste URL] --> B[Parse]
  B --> C{Duplicate?}
  C -->|Yes| D[Merge dialog]
  C -->|No| E[Preview]
  E --> F[Save to collection]`)}
`,

  "tasks/photo-upload.md": `---
title: Photo upload & compression
type: task
status: in_progress
priority: 1
assignee: devon
blocked: true
block_reason: Waiting on S3 presigned POST quota increase (INF-441)
tags: [media, mobile, infra]
sprint: 4
estimate: 5
---

Hero and step photos for recipes. Client-side resize before upload; progressive JPEG; blurhash placeholder.

## Acceptance criteria

- [x] Image picker (camera + library) with permission flows
- [x] Client resize max 2048px long edge, quality 0.82
- [ ] Presigned POST upload to \`pinch-media-prod\`
- [ ] Retry with exponential backoff (3 attempts)
- [ ] Delete orphaned uploads on recipe discard
- [ ] Accessibility: alt text field required before publish

## Blocker

Infra ticket **INF-441** — current presigned URL rate limit (100/min) insufficient for batch import preview. ETA June 18 per platform team.

${diff({
  title: "Upload hook (blocked branch)",
  language: "typescript",
  before: `const { url } = await api.getUploadUrl(recipeId);
await fetch(url, { method: "PUT", body: blob });`,
  after: `const { url, fields } = await api.getPresignedPost(recipeId);
const form = new FormData();
Object.entries(fields).forEach(([k, v]) => form.append(k, v));
form.append("file", blob);
await fetch(url, { method: "POST", body: form });`,
})}

Unblocks [[tasks/recipe-import]] preview and [[tasks/share-recipes]] OG images.
`,

  "tasks/push-notifications.md": `---
title: Push notifications (follow + comment)
type: task
status: review
priority: 2
assignee: riley
tags: [mobile, social, notifications]
sprint: 4
estimate: 5
---

Notify users when someone they follow publishes a recipe or comments on their recipe.

## Acceptance criteria

- [x] FCM + APNs token registration on login
- [x] Preference toggles in Settings (follows, comments, marketing off by default)
- [x] Deep link opens recipe detail
- [ ] Rate limit: max 3 pushes / user / hour
- [ ] QA on physical devices (not simulator)

## Review notes

PR #892 — pending security review on payload PII (no email in notification body). Related: [[tasks/share-recipes]] activity feed.
`,

  "tasks/onboarding-flow.md": `---
title: Onboarding flow (3 screens)
type: task
status: done
priority: 1
assignee: jordan
tags: [ux, mobile]
sprint: 3
completed: 2026-06-08
---

Skippable onboarding: value prop → dietary prefs → import or blank slate.

## Acceptance criteria

- [x] Three screens, progress dots, skip on screen 1
- [x] Dietary prefs stored in profile (vegan, gluten-free, etc.)
- [x] Final CTA: "Import recipes" or "Browse community"
- [x] Onboarding never shown again after complete (AsyncStorage flag)
- [x] A/B flag \`onboarding_v2\` wired in LaunchDarkly

Shipped in **0.3.9**. Unlocked [[tasks/recipe-import]] empty-state design.
`,

  "tasks/offline-mode.md": `---
title: Offline mode (read-only cache)
type: task
status: backlog
priority: 2
assignee: maya
tags: [mobile, offline, perf]
sprint: 5
estimate: 13
---

Cache saved recipes and images for subway cooking. Read-only in v1 — edits queue for online.

## Acceptance criteria

- [ ] SQLite cache of last 50 viewed recipes
- [ ] Image disk cache with LRU eviction (500 MB cap)
- [ ] Offline banner in header
- [ ] Queued edits sync with conflict dialog (deferred v2)
- [ ] Background prefetch on Wi-Fi for "Saved" collection

Blocked by storage abstraction from [[tasks/photo-upload]]. Target sprint 5.
`,

  "tasks/share-recipes.md": `---
title: Share recipes (link + OG card)
type: task
status: backlog
priority: 3
assignee: riley
tags: [social, growth, web]
sprint: 4
estimate: 5
---

Public share links \`pinch.app/r/{slug}\` with Open Graph preview for iMessage / Instagram stories.

## Acceptance criteria

- [ ] Slug generation (base62, collision retry)
- [ ] Web fallback page (Next.js) with app deep link
- [ ] OG image from hero photo or auto-generated template
- [ ] Share sheet native + copy link
- [ ] UTM params preserved
- [ ] Report recipe flow on public page

Needs [[tasks/photo-upload]] for reliable OG images and [[tasks/recipe-import]] for content volume in beta.
`,

  "tasks/collections-crud.md": `---
title: Collections CRUD
type: task
status: todo
priority: 2
assignee: jordan
tags: [core, mobile]
sprint: 4
estimate: 5
---

User-created collections ("Weeknight", "Holiday baking") — reorder, cover image, private vs public.

## Acceptance criteria

- [ ] Create / rename / delete collection
- [ ] Add/remove recipes via long-press multi-select
- [ ] Drag reorder (persist \`ordinal\`)
- [ ] Cover: pick recipe hero or upload
- [ ] Empty state links to [[tasks/recipe-import]]
- [ ] API: \`GET/POST/PATCH/DELETE /v1/collections\`

In **Todo** — starts after import preview merges.
`,

  "tasks/recipe-search-filter.md": `---
title: Recipe search & filters
type: task
status: todo
priority: 2
assignee: devon
tags: [search, mobile]
sprint: 4
estimate: 8
---

Full-text search across title, ingredients, tags. Filters: time, diet, difficulty.

## Acceptance criteria

- [ ] Debounced search (300ms) with highlight snippets
- [ ] Filters persist in URL state (shareable)
- [ ] Recent searches (max 10, clear all)
- [ ] Zero results → suggest [[tasks/collections-crud|collections]] or import
- [ ] Backend: Postgres \`tsvector\` index on recipes

${playground({
  title: "Filter combinations to test",
  widgets: [
    "vegan + under 30 min",
    "contains 'chickpea' + difficulty easy",
    "empty query + sort by rating",
  ],
})}
`,

  "tasks/cook-mode-timer.md": `---
title: Cook mode & step timers
type: task
status: todo
priority: 3
assignee: jordan
tags: [ux, mobile]
sprint: 4
estimate: 5
---

Fullscreen cook mode: large type, keep-awake, per-step timers with haptics.

## Acceptance criteria

- [ ] Swipe between steps; sticky ingredients drawer
- [ ] Tap duration in step text → start timer (regex parse)
- [ ] Multiple concurrent timers with notifications
- [ ] Screen stays awake (expo-keep-awake)
- [ ] VoiceOver reads step number and timer state

Nice-to-have for beta; can slip to sprint 5 if import runs long.

${colorPalette({
  name: "Cook mode UI",
  showContrast: true,
  colors: [
    { hex: "#1c1917", label: "Background" },
    { hex: "#fafaf9", label: "Step text" },
    { hex: "#ea580c", label: "Timer accent" },
    { hex: "#22c55e", label: "Timer complete" },
  ],
})}
`,
};

export const tasksMock = {
  workflows: [tasksWorkflow],
  workflowBoards: {
    tasks: {
      columns: [
        {
          state: "backlog",
          color: "#64748b",
          pages: [
            {
              path: "tasks/offline-mode.md",
              title: "Offline mode",
              priority: "2",
              tags: ["offline", "perf"],
              author: "maya",
              description: "Read-only cache for saved recipes",
              modified: iso(1),
            },
            {
              path: "tasks/share-recipes.md",
              title: "Share recipes",
              priority: "3",
              tags: ["social", "growth"],
              author: "riley",
              modified: iso(2),
            },
          ],
        },
        {
          state: "todo",
          color: "#3b82f6",
          wip_limit: 5,
          pages: [
            {
              path: "tasks/collections-crud.md",
              title: "Collections CRUD",
              priority: "2",
              tags: ["core"],
              author: "jordan",
              modified: iso(0.5),
            },
            {
              path: "tasks/recipe-search-filter.md",
              title: "Recipe search & filters",
              priority: "2",
              tags: ["search"],
              author: "devon",
              modified: iso(0.5),
            },
            {
              path: "tasks/cook-mode-timer.md",
              title: "Cook mode & timers",
              priority: "3",
              tags: ["ux"],
              author: "jordan",
              modified: iso(1),
            },
          ],
        },
        {
          state: "in_progress",
          color: "#f59e0b",
          wip_limit: 3,
          pages: [
            {
              path: "tasks/recipe-import.md",
              title: "Recipe import",
              priority: "1",
              tags: ["core", "import"],
              author: "maya",
              modified: iso(0),
            },
            {
              path: "tasks/photo-upload.md",
              title: "Photo upload",
              priority: "1",
              tags: ["media"],
              author: "devon",
              blocked: true,
              block_reason: "Waiting on S3 presigned POST quota (INF-441)",
              depends_on: ["tasks/recipe-import.md"],
              modified: iso(0),
            },
          ],
        },
        {
          state: "review",
          color: "#8b5cf6",
          wip_limit: 2,
          pages: [
            {
              path: "tasks/push-notifications.md",
              title: "Push notifications",
              priority: "2",
              tags: ["mobile", "social"],
              author: "riley",
              modified: iso(0.2),
            },
          ],
        },
        {
          state: "done",
          color: "#22c55e",
          pages: [
            {
              path: "tasks/onboarding-flow.md",
              title: "Onboarding flow",
              priority: "1",
              tags: ["ux"],
              author: "jordan",
              modified: iso(12),
            },
          ],
        },
      ] as WorkflowColumn[],
    },
  },
  queryRows: [
    { _path: "tasks/recipe-import.md", title: "Recipe import (CSV + URL)", status: "in_progress", priority: 1, assignee: "maya" },
    { _path: "tasks/photo-upload.md", title: "Photo upload & compression", status: "in_progress", priority: 1, assignee: "devon" },
    { _path: "tasks/push-notifications.md", title: "Push notifications", status: "review", priority: 2, assignee: "riley" },
    { _path: "tasks/collections-crud.md", title: "Collections CRUD", status: "todo", priority: 2, assignee: "jordan" },
    { _path: "tasks/recipe-search-filter.md", title: "Recipe search & filters", status: "todo", priority: 2, assignee: "devon" },
    { _path: "tasks/cook-mode-timer.md", title: "Cook mode & step timers", status: "todo", priority: 3, assignee: "jordan" },
    { _path: "tasks/offline-mode.md", title: "Offline mode", status: "backlog", priority: 2, assignee: "maya" },
    { _path: "tasks/share-recipes.md", title: "Share recipes", status: "backlog", priority: 3, assignee: "riley" },
    { _path: "tasks/onboarding-flow.md", title: "Onboarding flow", status: "done", priority: 1, assignee: "jordan" },
  ],
  views: [
    {
      name: "All tasks",
      query: 'TABLE title, status, priority, assignee, tags FROM "tasks/"',
      layout: "table",
      columns: [
        { key: "title", label: "Title" },
        { key: "status", label: "Status" },
        { key: "priority", label: "Priority", summary: "avg" },
        { key: "assignee", label: "Assignee" },
        { key: "tags", label: "Tags" },
      ],
      filters: [],
      sort: [{ key: "priority", direction: "asc" }],
    },
    {
      name: "Active sprint",
      query: 'TABLE title, status, assignee FROM "tasks/" WHERE status != "done" AND status != "backlog"',
      layout: "table",
      columns: [
        { key: "title", label: "Title" },
        { key: "status", label: "Status" },
        { key: "assignee", label: "Assignee" },
      ],
      filters: [],
      sort: [{ key: "status", direction: "asc" }],
    },
    {
      name: "Blocked",
      query: 'TABLE title, assignee, block_reason FROM "tasks/" WHERE blocked = true',
      layout: "list",
      columns: [
        { key: "title", label: "Title" },
        { key: "assignee", label: "Assignee" },
        { key: "block_reason", label: "Reason" },
      ],
      filters: [],
      sort: [],
    },
    {
      name: "By assignee",
      query: 'TABLE title, status, priority FROM "tasks/"',
      layout: "cards",
      columns: [
        { key: "title", label: "Title" },
        { key: "status", label: "Status" },
        { key: "priority", label: "Priority" },
        { key: "assignee", label: "Assignee" },
      ],
      filters: [],
      sort: [{ key: "assignee", direction: "asc" }],
    },
  ] as MockSavedView[],
  viewResults: {
    "All tasks": [
      { path: "tasks/recipe-import.md", title: "Recipe import (CSV + URL)", status: "in_progress", priority: 1, assignee: "maya", tags: "core, import, mobile" },
      { path: "tasks/photo-upload.md", title: "Photo upload & compression", status: "in_progress", priority: 1, assignee: "devon", tags: "media, mobile, infra" },
      { path: "tasks/push-notifications.md", title: "Push notifications", status: "review", priority: 2, assignee: "riley", tags: "mobile, social" },
      { path: "tasks/collections-crud.md", title: "Collections CRUD", status: "todo", priority: 2, assignee: "jordan", tags: "core, mobile" },
      { path: "tasks/onboarding-flow.md", title: "Onboarding flow", status: "done", priority: 1, assignee: "jordan", tags: "ux, mobile" },
    ],
    "Active sprint": [
      { path: "tasks/recipe-import.md", title: "Recipe import", status: "in_progress", assignee: "maya" },
      { path: "tasks/photo-upload.md", title: "Photo upload", status: "in_progress", assignee: "devon" },
      { path: "tasks/push-notifications.md", title: "Push notifications", status: "review", assignee: "riley" },
      { path: "tasks/collections-crud.md", title: "Collections CRUD", status: "todo", assignee: "jordan" },
    ],
    Blocked: [
      { path: "tasks/photo-upload.md", title: "Photo upload & compression", assignee: "devon", block_reason: "Waiting on S3 presigned POST quota (INF-441)" },
    ],
    "By assignee": [
      { path: "tasks/photo-upload.md", title: "Photo upload", status: "in_progress", priority: 1, assignee: "devon" },
      { path: "tasks/recipe-search-filter.md", title: "Recipe search & filters", status: "todo", priority: 2, assignee: "devon" },
      { path: "tasks/collections-crud.md", title: "Collections CRUD", status: "todo", priority: 2, assignee: "jordan" },
      { path: "tasks/cook-mode-timer.md", title: "Cook mode & timers", status: "todo", priority: 3, assignee: "jordan" },
      { path: "tasks/onboarding-flow.md", title: "Onboarding flow", status: "done", priority: 1, assignee: "jordan" },
      { path: "tasks/recipe-import.md", title: "Recipe import", status: "in_progress", priority: 1, assignee: "maya" },
    ],
  },
  searchResults: demoSearch([
    { path: "tasks/recipe-import.md", score: 0.93, snippet: "...Duplicate detection by title + <mark>ingredient</mark> fingerprint..." },
    { path: "tasks/photo-upload.md", score: 0.88, snippet: "...<mark>blocked</mark> until infra raises S3 presigned URL quota..." },
    { path: "index.md", score: 0.81, snippet: "...Sprint 4 — <mark>recipe</mark> sharing app mobile-first..." },
    { path: "tasks/share-recipes.md", score: 0.76, snippet: "...Public share links <mark>pinch.app</mark>/r/{slug}..." },
  ]),
  backlinks: demoBacklinks([
    { path: "tasks/recipe-import.md", count: 4 },
    { path: "tasks/photo-upload.md", count: 3 },
    { path: "tasks/onboarding-flow.md", count: 2 },
  ]),
  comments: demoComments("tasks/photo-upload.md", [
    {
      id: "tc1",
      anchor: { quote: "INF-441", prefix: "Infra ticket ", suffix: " — current presigned" },
      body: "Platform bumped quota in staging — can we re-test unblock?",
      author: "maya",
      createdAt: iso(0.3),
      resolved: false,
    },
  ]),
  timelineEvents: [
    { type: "write", path: "tasks/recipe-import.md", title: "Recipe import", actor: "maya", timestamp: iso(0), message: "Check off duplicate detection" },
    { type: "write", path: "tasks/photo-upload.md", title: "Photo upload", actor: "devon", timestamp: iso(0.1), message: "Mark blocked INF-441" },
    { type: "write", path: "tasks/onboarding-flow.md", title: "Onboarding flow", actor: "jordan", timestamp: iso(12), message: "Move to done" },
    { type: "write", path: "index.md", title: "Sprint overview", actor: "riley", timestamp: iso(0.5), message: "Update burndown" },
  ],
};
