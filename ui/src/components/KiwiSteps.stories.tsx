import type { Meta, StoryObj } from "@storybook/react";
import { action } from "@storybook/addon-actions";
import { KiwiSteps } from "./KiwiSteps";

const meta: Meta<typeof KiwiSteps> = {
  title: "Content/KiwiSteps",
  component: KiwiSteps,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-3xl p-4 bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
  args: { onNavigate: action("navigate") },
};

export default meta;
type Story = StoryObj<typeof KiwiSteps>;

export const Flowchart: Story = {
  args: {
    source: `diagram: |
  graph LR
    C[Client] --> A[API]
    A --> DB[(Postgres)]
steps:
  - focus: [C, A]
    note: write lands on the API
  - focus: [A, DB]
    dim: [C]
    note: then it commits
`,
  },
};

export const Sequence: Story = {
  args: {
    source: `diagram: |
  sequenceDiagram
    Client->>API: write
    API->>DB: commit
    API->>Q: enqueue
steps:
  - note: first hop
  - note: commit
    messages: 2
  - note: enqueue
    messages: 3
`,
  },
};

export const ParseError: Story = {
  args: {
    source: `steps:
  - note: missing diagram
`,
  },
};
