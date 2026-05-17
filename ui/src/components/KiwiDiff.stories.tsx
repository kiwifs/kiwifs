import type { Meta, StoryObj } from "@storybook/react";
import { KiwiDiff } from "./KiwiDiff";

const meta: Meta<typeof KiwiDiff> = {
  title: "Blocks/KiwiDiff",
  component: KiwiDiff,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-4xl p-4 bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof KiwiDiff>;

export const SimpleTwoBlock: Story = {
  name: "Simple (=== separator)",
  args: {
    source: `def greet(name):
    print("Hello " + name)
    return None
===
def greet(name: str) -> None:
    print(f"Hello {name}")`,
    meta: "language=python",
  },
};

export const UnifiedDiff: Story = {
  name: "Unified Diff Format",
  args: {
    source: `title: Auth Token Refresh Refactor
language: typescript
splitView: true
leftTitle: Before
rightTitle: After
---
- function refreshToken(token: string) {
-   return fetch('/api/refresh', {
-     headers: { Authorization: \`Bearer \${token}\` }
-   });
- }
+ async function refreshToken(token: string, retries = 3) {
+   for (let i = 0; i < retries; i++) {
+     try {
+       const res = await fetch('/api/refresh', {
+         headers: { Authorization: \`Bearer \${token}\` },
+         signal: AbortSignal.timeout(5000),
+       });
+       if (res.ok) return res.json();
+     } catch {
+       await new Promise(r => setTimeout(r, 1000 * 2 ** i));
+     }
+   }
+   throw new Error('Token refresh failed after retries');
+ }`,
  },
};

export const WithAnnotations: Story = {
  name: "With Severity Annotations",
  args: {
    source: `title: Database Query Optimization
language: typescript
splitView: true
annotations:
  - line: 2
    side: left
    severity: error
    text: N+1 query problem — fetches users one at a time in a loop
  - line: 3
    side: right
    severity: info
    text: Single batch query with IN clause — much more efficient
  - line: 6
    side: right
    severity: warning
    text: Consider adding a LIMIT clause for very large datasets
---
- async function getActiveUsers(ids: string[]) {
-   const users = [];
-   for (const id of ids) {
-     users.push(await db.query('SELECT * FROM users WHERE id = ?', [id]));
-   }
-   return users;
- }
+ async function getActiveUsers(ids: string[]) {
+   const placeholders = ids.map(() => '?').join(',');
+   const users = await db.query(
+     \`SELECT * FROM users WHERE id IN (\${placeholders}) AND active = true\`,
+     ids
+   );
+   return users;
+ }`,
  },
};

export const UnifiedView: Story = {
  name: "Unified View (not split)",
  args: {
    source: `title: Config Migration
language: yaml
splitView: false
---
- database:
-   host: localhost
-   port: 5432
-   name: myapp_dev
-   pool_size: 5
+ database:
+   host: \${DATABASE_HOST}
+   port: \${DATABASE_PORT}
+   name: \${DATABASE_NAME}
+   pool_size: \${DATABASE_POOL_SIZE:10}
+   ssl: true
+   timeout: 30s`,
  },
};

export const GoRefactor: Story = {
  name: "Go Error Handling",
  args: {
    source: `title: Error Handling Improvement
language: go
splitView: true
annotations:
  - line: 2
    side: left
    severity: error
    text: Silently ignoring the error — caller has no idea it failed
  - line: 2
    side: right
    severity: info
    text: Wrapping with context using fmt.Errorf and %w verb
---
- func loadConfig(path string) *Config {
-   data, _ := os.ReadFile(path)
-   var cfg Config
-   json.Unmarshal(data, &cfg)
-   return &cfg
- }
+ func loadConfig(path string) (*Config, error) {
+   data, err := os.ReadFile(path)
+   if err != nil {
+     return nil, fmt.Errorf("read config %s: %w", path, err)
+   }
+   var cfg Config
+   if err := json.Unmarshal(data, &cfg); err != nil {
+     return nil, fmt.Errorf("parse config %s: %w", path, err)
+   }
+   return &cfg, nil
+ }`,
  },
};

export const LargeDiff: Story = {
  name: "Large Diff",
  args: {
    source: `title: API Response Handler
language: typescript
splitView: true
annotations:
  - line: 1
    side: right
    severity: info
    text: Generic type parameter for type-safe responses
  - line: 5
    side: right
    severity: info
    text: Proper error typing with discriminated union
  - line: 12
    side: right
    severity: warning
    text: AbortSignal timeout is not supported in all browsers — add polyfill
---
- function handleResponse(res: any) {
-   if (res.status === 200) {
-     return res.json();
-   } else {
-     throw new Error("Request failed");
-   }
- }
+ type ApiResult<T> =
+   | { ok: true; data: T }
+   | { ok: false; error: string; status: number };
+
+ async function handleResponse<T>(res: Response): Promise<ApiResult<T>> {
+   if (res.ok) {
+     const data = await res.json() as T;
+     return { ok: true, data };
+   }
+   const errorText = await res.text().catch(() => "Unknown error");
+   return {
+     ok: false,
+     error: errorText,
+     status: res.status,
+   };
+ }`,
  },
};
