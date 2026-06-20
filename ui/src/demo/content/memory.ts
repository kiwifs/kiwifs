import * as blk from "../blocks";
import { daysAgo } from "../helpers";
import { demoBacklinks, demoComments, demoSearch } from "./mockExtras";

export const memoryPages: Record<string, string> = {
  "episodes/auth-refactor.md": `---
title: Auth refactor session
type: episode
created_at: 2026-06-18T14:22:00Z
session_id: sess_8f3a2c
tags: [auth, fastify, express, migration]
confidence: high
consolidated: false
---

Pair-programming session migrating \`packages/api\` from Express middleware chains to Fastify plugins. User rejected implicit \`throw new Error("unauthorized")\` patterns — wants typed \`AuthError\` hierarchy surfaced to clients as structured JSON.

${blk.tabs([
  {
    label: "Context",
    body: `**Repo:** \`acme/platform\` monorepo · branch \`feat/fastify-auth\`

**Starting state**
- Express \`passport-jwt\` + custom \`requireRole()\` middleware
- Session cookies for admin UI; bearer tokens for public API
- 14 route files still importing \`express.Request\`

**Constraints stated by user**
1. No breaking changes to \`/v1/*\` response shapes during migration
2. Keep Redis session store — do not swap to in-memory for dev
3. Feature-flag dual stack until load test passes

**Files touched:** \`apps/api/src/auth/*\`, \`apps/api/src/routes/users.ts\`, \`packages/errors/src/auth.ts\``,
  },
  {
    label: "Learnings",
    body: `- Prefer **explicit error types** over string throws — map \`AuthError\` → HTTP 401/403 with \`{ code, message, details? }\`
- Fastify \`preHandler\` hooks compose cleaner than Express \`router.use\` for scoped auth
- User wants **integration tests** hitting real Redis (see [[episodes/test-style]])
- JWT refresh rotation deferred — note open loop in [[pages/user-preferences#auth]]
- Counter demo below tracks migration checklist items completed this session`,
  },
])}

${blk.progress({
  type: "bar",
  title: "Memory pipeline",
  items: [
    { label: "Episodes", value: 68, color: "#84cc16" },
    { label: "Consolidated", value: 41, color: "#22c55e" },
    { label: "Open loops", value: 9, color: "#eab308" },
  ],
})}

${blk.progress({
  type: "gauge",
  title: "Auth migration readiness",
  items: [
    { label: "Routes migrated", value: 72 },
    { label: "Test coverage", value: 81 },
    { label: "Load test pass", value: 45 },
    { label: "Docs updated", value: 30 },
  ],
})}

${blk.counterApp}

## Snippets the user approved

Typed guard replacing string throws:

\`\`\`typescript
export class AuthError extends Error {
  constructor(
    readonly code: "invalid_token" | "expired" | "forbidden",
    message: string,
    readonly status = code === "forbidden" ? 403 : 401,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export function assertSession(req: FastifyRequest): Session {
  const session = req.session;
  if (!session?.userId) throw new AuthError("invalid_token", "Not authenticated");
  return session;
}
\`\`\`

Fastify plugin registration order matters — auth before rate-limit:

\`\`\`typescript
await app.register(sessionPlugin);
await app.register(authPlugin);      // attaches req.auth
await app.register(rateLimitPlugin); // reads req.auth for per-user keys
\`\`\`

## Links

- Semantic concept: [[pages/concepts#error-handling|structured errors]]
- Related episode: [[episodes/api-error-handling]]
- User preference: [[pages/user-preferences#auth]]

> [!NOTE]
> Session not yet consolidated — run nightly job or manually promote learnings to [[pages/concepts]].
`,

  "episodes/orm-preference.md": `---
title: ORM preference — Drizzle over Prisma
type: episode
created_at: 2026-06-15T09:40:00Z
session_id: sess_2b91e0
tags: [database, drizzle, prisma, migrations]
confidence: high
consolidated: true
---

User chose **Drizzle** for greenfield services after comparing migration diffs on a schema with 40+ tables.

## Why Drizzle won

| Criterion | Drizzle | Prisma |
|-----------|---------|--------|
| Migration SQL readability | Raw SQL in repo, reviewable in PR | Generated, harder to hand-edit |
| Cold start / bundle | ~45 KB driver path | Heavier client |
| Type inference on joins | \`sql\` tagged templates + inferred rows | Good, but magic around relations |

## Direct quotes (paraphrased)

> "I want to see the SQL in the PR. Prisma's migration folder is a black box when something goes sideways at 2am."

> "New microservices only — don't rewrite the billing service yet."

## Consolidated to

- [[pages/concepts#data-access|Data access preference]]
- [[pages/codebase-map#packages-db|packages/db layout]]

## Code pattern to reuse

\`\`\`typescript
import { db } from "@acme/db";
import { users, sessions } from "@acme/db/schema";
import { eq } from "drizzle-orm";

export async function findActiveSession(token: string) {
  return db
    .select({ userId: sessions.userId, email: users.email })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.token, token))
    .limit(1);
}
\`\`\`

Cross-ref: [[episodes/test-style]] — user wants DB integration tests with Testcontainers, not mocked drivers.
`,

  "episodes/test-style.md": `---
title: Test style preferences
type: episode
created_at: 2026-06-13T16:05:00Z
session_id: sess_7c44af
tags: [testing, vitest, integration]
confidence: high
consolidated: true
---

Captured after user rejected a PR full of \`vi.mock()\` on database and Redis clients.

## Preferences

1. **Integration over unit** for anything touching I/O — real Postgres via Testcontainers in CI
2. **No snapshot tests** for API JSON — assert explicit fields instead
3. **Colocate tests** next to source (\`users.test.ts\` beside \`users.ts\`), not a separate \`__tests__\` tree
4. **One assertion theme per test** — name tests \`it("returns 403 when role missing")\`

## Anti-patterns flagged

\`\`\`typescript
// ❌ User explicitly called this out
vi.mock("../db", () => ({ query: vi.fn().mockResolvedValue([{ id: 1 }]) }));

// ✅ Preferred — spin container once per file
const pg = await Testcontainers.postgres("16");
beforeAll(() => migrate(pg.connectionString));
\`\`\`

## Playwright scope

- E2E only for checkout + auth flows — not every CRUD screen
- Run smoke suite on PR; full suite nightly

Consolidated → [[pages/concepts#testing|Testing philosophy]], [[pages/user-preferences#quality-bar]].
`,

  "episodes/api-error-handling.md": `---
title: API error handling conventions
type: episode
created_at: 2026-06-17T11:30:00Z
session_id: sess_9d01bc
tags: [api, errors, fastify]
confidence: medium
consolidated: false
---

Follow-up to [[episodes/auth-refactor]] — standardized error envelope across REST handlers.

## Envelope shape (locked in)

\`\`\`json
{
  "error": {
    "code": "validation_failed",
    "message": "Human-readable summary",
    "details": [{ "field": "email", "issue": "invalid_format" }]
  },
  "request_id": "req_abc123"
}
\`\`\`

## Rules

- Never leak stack traces in production responses
- \`request_id\` from Fastify genReqId — also in logs
- Map Zod failures → 422 with \`details\` array
- Unknown errors → 500 with generic message; full trace in Sentry only

${blk.mermaid(`flowchart TD
  A[Handler throws] --> B{Known AppError?}
  B -->|Yes| C[Map status + code]
  B -->|No| D[Log + Sentry]
  D --> E[500 generic body]
  C --> F[Reply with envelope]
  E --> F`)}

## Open loop

- GraphQL errors still use old format — user wants parity in Q3

See [[pages/concepts#error-handling]] for consolidated rules.
`,

  "episodes/monorepo-layout.md": `---
title: Monorepo layout decisions
type: episode
created_at: 2026-06-10T08:15:00Z
session_id: sess_1a88de
tags: [monorepo, turborepo, pnpm]
confidence: high
consolidated: true
---

User reorganized \`acme/platform\` after copy-paste drift between \`apps/\` and \`services/\`.

## Final layout

\`\`\`
apps/          # deployable binaries (api, web, worker)
packages/      # shared libs (db, errors, config)
tooling/       # eslint, tsconfig bases
infra/         # terraform, k8s manifests — not imported by apps
\`\`\`

## Naming rules

- Package scope \`@acme/*\` only — no deep relative imports across apps
- \`packages/config\` owns env schema (Zod) — apps import, never duplicate \`.env.example\`
- Feature flags live in \`packages/flags\`, not scattered in app code

${blk.columns("1:1", [
  `### Turbo pipeline

\`\`\`json
{
  "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
  "test": { "dependsOn": ["^build"], "cache": true }
}
\`\`\``,
  `### User quote

> "If two apps need the same helper, it goes in packages/ the same day — no 'we'll extract later'."

Mapped in [[pages/codebase-map]].`,
])}

Related: [[episodes/orm-preference]] (\`packages/db\`), [[episodes/test-style]] (shared vitest config in \`tooling/\`).
`,

  "pages/concepts.md": `---
title: Semantic concepts
type: semantic
updated_at: 2026-06-19T06:00:00Z
tags: [consolidated, knowledge-graph]
---

Facts extracted from episodic memory — **source of truth** for agent behavior. Each bullet links back to originating episodes.

## Error handling {#error-handling}

- Use typed \`AppError\` hierarchy; never throw raw strings ([[episodes/auth-refactor]], [[episodes/api-error-handling]])
- REST responses use \`{ error: { code, message, details? }, request_id }\`
- Production: no stack traces in JSON bodies

## Data access {#data-access}

- **Greenfield:** Drizzle + SQL-visible migrations ([[episodes/orm-preference]])
- **Legacy billing:** Prisma stays until Q4 rewrite — do not suggest migration unprompted
- Integration tests with Testcontainers — not mocked DB ([[episodes/test-style]])

## Testing {#testing}

- Integration > heavy mocking; explicit assertions > snapshots ([[episodes/test-style]])
- E2E smoke on PR; full Playwright nightly
- Colocated \`*.test.ts\` files

## Architecture {#architecture}

- Turborepo + pnpm; \`apps/\` vs \`packages/\` boundary ([[episodes/monorepo-layout]])
- Shared env schema in \`@acme/config\`

${blk.mermaid(`graph LR
  subgraph Episodes
    E1[[episodes/auth-refactor]]
    E2[[episodes/orm-preference]]
    E3[[episodes/test-style]]
    E4[[episodes/api-error-handling]]
    E5[[episodes/monorepo-layout]]
  end
  subgraph Concepts
    C[[pages/concepts]]
  end
  E1 --> C
  E2 --> C
  E3 --> C
  E4 --> C
  E5 --> C
  C --> P[[pages/user-preferences]]
  C --> M[[pages/codebase-map]]`)}

${blk.queryTable('TABLE title, consolidated, confidence FROM "episodes/" SORT created_at DESC')}

> [!TIP]
> When a new episode contradicts a concept here, **update this page first**, then mark the episode \`consolidated: true\`.
`,

  "pages/user-preferences.md": `---
title: User preferences
type: semantic
updated_at: 2026-06-19T06:00:00Z
tags: [preferences, agent-directives]
---

Stable preferences — lower churn than episodic notes. Agent should treat these as hard constraints unless user overrides in-session.

## Communication

- Lead with **concrete diffs**, not prose summaries
- Ask before running destructive git commands (\`reset --hard\`, force push)
- Prefer \`pnpm\` over \`npm\`; \`rg\` over \`grep\`

## Auth {#auth}

- Explicit \`AuthError\` types; structured 401/403 JSON ([[episodes/auth-refactor]])
- Keep Redis session store in all environments
- JWT refresh rotation: **deferred** — do not implement without explicit ask

## Quality bar {#quality-bar}

- No snapshot tests for API responses ([[episodes/test-style]])
- PRs need passing integration suite, not just unit mocks
- TypeScript \`strict: true\` — no \`@ts-ignore\` without comment ticket

## Database

- Drizzle for new services ([[episodes/orm-preference]])
- Show SQL in migration PRs — user reviews migrations manually

${blk.progress({
  type: "gauge",
  title: "Preference stability (30d)",
  items: [
    { label: "Unchanged", value: 88 },
    { label: "Refined", value: 10 },
    { label: "Contradicted", value: 2 },
  ],
})}

## Tooling

| Tool | Preference |
|------|------------|
| Formatter | Biome (not Prettier) |
| Test runner | Vitest |
| CI | GitHub Actions + Turbo cache |
| Container local dev | Docker Compose v2 |

Linked from [[pages/concepts]], [[episodes/auth-refactor]].
`,

  "pages/codebase-map.md": `---
title: Codebase map
type: semantic
updated_at: 2026-06-18T22:00:00Z
tags: [monorepo, navigation]
---

High-level map for agent navigation — paths relative to repo root \`acme/platform\`.

## Apps

| Path | Purpose | Stack |
|------|---------|-------|
| \`apps/api\` | Public REST + admin API | Fastify (migrating from Express) |
| \`apps/web\` | Customer dashboard | Next.js 15 App Router |
| \`apps/worker\` | Async jobs, webhooks | BullMQ + Redis |

## Packages {#packages-db}

| Path | Purpose |
|------|---------|
| \`packages/db\` | Drizzle schema + migrations ([[episodes/orm-preference]]) |
| \`packages/errors\` | \`AppError\`, \`AuthError\`, mappers |
| \`packages/config\` | Zod env validation |
| \`packages/flags\` | LaunchDarkly wrapper |

## Infra (read-only for agents)

- \`infra/terraform/aws\` — VPC, RDS, ElastiCache
- \`infra/k8s/overlays/prod\` — Kustomize prod patches

${blk.chart({
  type: "bar",
  title: "Package dependency fan-in (dependents count)",
  xKey: "package",
  grid: true,
  series: [{ key: "dependents", name: "Apps/packages importing", color: "#84cc16" }],
  data: [
    { package: "config", dependents: 12 },
    { package: "errors", dependents: 9 },
    { package: "db", dependents: 7 },
    { package: "flags", dependents: 4 },
  ],
})}

## Hot paths

- Auth flow: \`apps/api/src/plugins/auth.ts\` → \`packages/errors\`
- DB access: always via \`@acme/db\`, never raw \`pg\` in apps

See [[episodes/monorepo-layout]] for rationale.
`,

  "log.md": `---
title: Consolidation log
type: log
append_only: true
---

Automated and manual promotions from episodic → semantic memory.

${blk.eventCounterApp}

## Recent consolidations

| Timestamp (UTC) | Action | Source | Target |
|-----------------|--------|--------|--------|
| 2026-06-19 06:00 | merge | 3 episodes | [[pages/concepts]] |
| 2026-06-18 22:00 | map update | [[episodes/monorepo-layout]] | [[pages/codebase-map]] |
| 2026-06-17 08:00 | preference sync | [[episodes/test-style]] | [[pages/user-preferences]] |
| 2026-06-15 10:15 | promote | [[episodes/orm-preference]] | [[pages/concepts#data-access]] |

## Episodes pending review

${blk.queryTable('TABLE title, created_at, consolidated, confidence FROM "episodes/" WHERE consolidated = false SORT created_at DESC')}

## All episodes (newest first)

${blk.queryTable('TABLE title, tags, session_id FROM "episodes/" SORT created_at DESC LIMIT 10')}

> [!WARNING]
> 2 episodes have \`confidence: medium\` — agent should confirm with user before treating as long-term memory.
`,
};

export const memoryMock = {
  graphNodes: [
    { path: "episodes/auth-refactor.md", tags: ["auth", "fastify"] },
    { path: "episodes/orm-preference.md", tags: ["database", "drizzle"] },
    { path: "episodes/test-style.md", tags: ["testing"] },
    { path: "episodes/api-error-handling.md", tags: ["api", "errors"] },
    { path: "episodes/monorepo-layout.md", tags: ["monorepo"] },
    { path: "pages/concepts.md", tags: ["semantic", "consolidated"] },
    { path: "pages/user-preferences.md", tags: ["preferences"] },
    { path: "pages/codebase-map.md", tags: ["navigation"] },
    { path: "log.md", tags: ["log"] },
  ],
  graphEdges: [
    { source: "episodes/auth-refactor.md", target: "pages/concepts.md" },
    { source: "episodes/auth-refactor.md", target: "pages/user-preferences.md" },
    { source: "episodes/auth-refactor.md", target: "episodes/api-error-handling.md" },
    { source: "episodes/orm-preference.md", target: "pages/concepts.md" },
    { source: "episodes/orm-preference.md", target: "pages/codebase-map.md" },
    { source: "episodes/test-style.md", target: "pages/concepts.md" },
    { source: "episodes/test-style.md", target: "pages/user-preferences.md" },
    { source: "episodes/api-error-handling.md", target: "pages/concepts.md" },
    { source: "episodes/monorepo-layout.md", target: "pages/codebase-map.md" },
    { source: "episodes/monorepo-layout.md", target: "pages/concepts.md" },
    { source: "pages/concepts.md", target: "pages/user-preferences.md" },
    { source: "pages/concepts.md", target: "pages/codebase-map.md" },
    { source: "log.md", target: "episodes/auth-refactor.md" },
    { source: "log.md", target: "pages/concepts.md" },
  ],
  searchResults: demoSearch([
    { path: "episodes/orm-preference.md", score: 0.94, snippet: "...prefers <mark>Drizzle</mark> over Prisma for new services — lighter migrations..." },
    { path: "pages/concepts.md", score: 0.91, snippet: "...<mark>Drizzle</mark> + SQL-visible migrations; legacy billing stays on Prisma..." },
    { path: "episodes/auth-refactor.md", score: 0.88, snippet: "...explicit <mark>AuthError</mark> hierarchy surfaced to clients as structured JSON..." },
    { path: "episodes/test-style.md", score: 0.85, snippet: "...<mark>integration tests</mark> over heavy mocking; snapshot tests discouraged..." },
    { path: "pages/user-preferences.md", score: 0.79, snippet: "...No <mark>snapshot tests</mark> for API responses; explicit field assertions..." },
    { path: "episodes/api-error-handling.md", score: 0.76, snippet: "...<mark>request_id</mark> from Fastify genReqId — also in logs..." },
  ]),
  backlinks: demoBacklinks([
    { path: "pages/concepts.md", count: 8 },
    { path: "episodes/auth-refactor.md", count: 4 },
    { path: "pages/user-preferences.md", count: 3 },
    { path: "episodes/orm-preference.md", count: 2 },
  ]),
  comments: demoComments("episodes/auth-refactor.md", [
    {
      id: "m1",
      anchor: { quote: "JWT refresh rotation deferred", prefix: "", suffix: "" },
      body: "User confirmed refresh rotation is Q3 — keep flag off in prod.",
      author: "agent",
      createdAt: daysAgo(1),
      resolved: true,
    },
    {
      id: "m2",
      anchor: { quote: "AuthError", prefix: "typed ", suffix: " hierarchy" },
      body: "Should ForbiddenError extend AuthError or sit beside it?",
      author: "reviewer",
      createdAt: daysAgo(2),
      resolved: false,
    },
  ]),
  queryRows: [
    { _path: "episodes/auth-refactor.md", title: "Auth refactor session", created_at: "2026-06-18", consolidated: false, confidence: "high" },
    { _path: "episodes/api-error-handling.md", title: "API error handling conventions", created_at: "2026-06-17", consolidated: false, confidence: "medium" },
    { _path: "episodes/orm-preference.md", title: "ORM preference — Drizzle over Prisma", created_at: "2026-06-15", consolidated: true, confidence: "high" },
    { _path: "episodes/test-style.md", title: "Test style preferences", created_at: "2026-06-13", consolidated: true, confidence: "high" },
    { _path: "episodes/monorepo-layout.md", title: "Monorepo layout decisions", created_at: "2026-06-10", consolidated: true, confidence: "high" },
  ],
  timelineEvents: [
    { type: "write", path: "episodes/auth-refactor.md", title: "Auth refactor session", actor: "agent", timestamp: daysAgo(1), message: "Session saved — 14 routes in scope" },
    { type: "write", path: "episodes/api-error-handling.md", title: "API error handling conventions", actor: "agent", timestamp: daysAgo(2), message: "Error envelope locked in" },
    { type: "write", path: "pages/codebase-map.md", title: "Codebase map", actor: "agent", timestamp: daysAgo(2), message: "Updated packages/db section" },
    { type: "write", path: "pages/concepts.md", title: "Semantic concepts", actor: "consolidator", timestamp: daysAgo(3), message: "Merged 3 episodes into concepts" },
    { type: "write", path: "episodes/orm-preference.md", title: "ORM preference", actor: "agent", timestamp: daysAgo(4), message: "Consolidated to concepts" },
    { type: "write", path: "pages/user-preferences.md", title: "User preferences", actor: "consolidator", timestamp: daysAgo(4), message: "Synced test-style preferences" },
    { type: "write", path: "episodes/test-style.md", title: "Test style", actor: "agent", timestamp: daysAgo(6), message: "Noted anti-mock preference" },
    { type: "write", path: "episodes/monorepo-layout.md", title: "Monorepo layout", actor: "agent", timestamp: daysAgo(9), message: "Turbo pipeline documented" },
    { type: "write", path: "log.md", title: "Consolidation log", actor: "system", timestamp: daysAgo(0), message: "Nightly consolidation run completed" },
  ],
  metaResults: [
    { path: "episodes/auth-refactor.md", frontmatter: { title: "Auth refactor session", type: "episode", tags: ["auth", "fastify"], consolidated: false } },
    { path: "pages/concepts.md", frontmatter: { title: "Semantic concepts", type: "semantic", tags: ["consolidated"] } },
    { path: "pages/user-preferences.md", frontmatter: { title: "User preferences", type: "semantic", tags: ["preferences"] } },
  ],
};
