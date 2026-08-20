import type { Meta, StoryObj } from "@storybook/react";
import { action } from "@storybook/addon-actions";
import { BasesCards } from "./BasesCards";
import { mockBasesRows, mockBasesViews } from "../__mocks__/data";
import type { ViewColumn, ViewRow } from "./BasesTable";

const columns = mockBasesViews[1]!.columns as ViewColumn[];
const rows = mockBasesRows as ViewRow[];

const meta: Meta<typeof BasesCards> = {
  title: "Bases/BasesCards",
  component: BasesCards,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="min-h-[360px] bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
  args: {
    columns,
    data: rows,
    cardSize: "medium",
    onNavigate: action("navigate"),
  },
};

export default meta;
type Story = StoryObj<typeof BasesCards>;

export const Medium: Story = {};

export const Small: Story = {
  args: { cardSize: "small" },
};

export const Large: Story = {
  args: { cardSize: "large" },
};

export const Empty: Story = {
  args: { data: [] },
};
