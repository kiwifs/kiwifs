import type { Meta, StoryObj } from "@storybook/react";
import { KiwiCalc } from "./KiwiCalc";

const meta: Meta<typeof KiwiCalc> = {
  title: "Content/KiwiCalc",
  component: KiwiCalc,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-xl p-4 bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof KiwiCalc>;

export const Default: Story = {
  args: {
    source: `dau:        10 million
writes:     100
write_size: 1 KB
---
qps:     dau * writes / day
daily:   dau * writes * write_size
yearly:  daily * year
`,
  },
};

export const ParseError: Story = {
  args: {
    source: `qps: dau * writes / day`,
  },
};
