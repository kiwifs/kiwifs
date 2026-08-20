import type { Meta, StoryObj } from "@storybook/react";
import { KiwiDataBlock } from "./KiwiDataBlock";

const meta: Meta<typeof KiwiDataBlock> = {
  title: "Content/KiwiDataBlock",
  component: KiwiDataBlock,
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
type Story = StoryObj<typeof KiwiDataBlock>;

export const Records: Story = {
  args: {
    source: `kind: dataset-schema
records:
  - name: target
    dtype: float
  - name: id
    dtype: int
    nullable: true
  - name: split
    dtype: string
`,
  },
};

export const SingleRecord: Story = {
  args: {
    source: `kind: stats
rows: 750000
ordered: false
`,
  },
};

export const ParseError: Story = {
  args: {
    source: `kind: broken
records:
  - name: [unterminated
`,
  },
};
