import type { Meta, StoryObj } from "@storybook/react";
import { KiwiClaim } from "./KiwiClaim";

const meta: Meta<typeof KiwiClaim> = {
  title: "Content/KiwiClaim",
  component: KiwiClaim,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-2xl space-y-4 p-4 bg-background text-foreground text-sm leading-relaxed">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof KiwiClaim>;

export const Sourced: Story = {
  args: {
    evidence: "stated",
    confidence: "0.9",
    source: "sources/architecture.md",
    children: "A non-linear level-2 stacker wins when the dominant feature is sparse.",
  },
};

export const Inferred: Story = {
  args: {
    evidence: "inferred",
    confidence: "0.6",
    children: "Hill-climbing is worse than a global search on this loss surface.",
  },
};

export const Unsupported: Story = {
  args: {
    children: "This assertion has neither a source nor a confidence score.",
  },
};

export const Inline: Story = {
  render: () => (
    <p>
      The paper claims that{" "}
      <KiwiClaim inline evidence="stated" confidence="0.85" source="papers/x.md">
        hill-climbing is worse
      </KiwiClaim>{" "}
      than a full sweep, but{" "}
      <KiwiClaim inline>that result has not been replicated</KiwiClaim>.
    </p>
  ),
};
