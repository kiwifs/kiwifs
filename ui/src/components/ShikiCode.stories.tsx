import type { Meta, StoryObj } from "@storybook/react";
import { ShikiCode } from "./ShikiCode";

const meta: Meta<typeof ShikiCode> = {
  title: "Content/ShikiCode",
  component: ShikiCode,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-2xl p-4 bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ShikiCode>;

export const TypeScript: Story = {
  args: {
    code: `interface KiwiConfig {
  dataDir: string;
  port: number;
  search: {
    vector?: { enabled: boolean; embedder: string };
  };
}

export function createServer(config: KiwiConfig) {
  return new KiwiServer(config);
}`,
    lang: "typescript",
  },
};

export const WithTitle: Story = {
  args: {
    code: `import { api } from "@kw/lib/api";

const result = await api.search("hello");
console.log(result.hits);`,
    lang: "typescript",
    title: "api-usage.ts",
  },
};

export const Python: Story = {
  args: {
    code: `def fibonacci(n: int) -> list[int]:
    """Generate the first n Fibonacci numbers."""
    fib = [0, 1]
    for i in range(2, n):
        fib.append(fib[i-1] + fib[i-2])
    return fib[:n]

print(fibonacci(10))`,
    lang: "python",
  },
};

export const Diff: Story = {
  args: {
    code: `- const old = "remove this";
+ const new = "add this";
  const unchanged = "stays the same";
- removed_function();
+ added_function();`,
    lang: "diff",
  },
};

export const WithHighlightedLines: Story = {
  args: {
    code: `function processData(input: string[]) {
  const filtered = input.filter(Boolean);
  const mapped = filtered.map(item => item.trim());
  const sorted = mapped.sort();
  return sorted;
}`,
    lang: "typescript",
    highlightLines: new Set([2, 3, 4]),
  },
};

export const PlainText: Story = {
  args: {
    code: "Just plain text with no syntax highlighting applied.\nMultiple lines of content here.",
  },
};
