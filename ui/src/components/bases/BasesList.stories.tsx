import type { Meta, StoryObj } from "@storybook/react";
import { action } from "@storybook/addon-actions";
import { BasesList } from "./BasesList";
import { mockBasesRows, mockBasesViews } from "../__mocks__/data";
import type { ViewColumn, ViewRow } from "./BasesTable";

const meta: Meta<typeof BasesList> = {
  title: "Bases/BasesList",
  component: BasesList,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-2xl bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
  args: {
    columns: mockBasesViews[2]!.columns as ViewColumn[],
    data: mockBasesRows as ViewRow[],
    onNavigate: action("navigate"),
  },
};

export default meta;
type Story = StoryObj<typeof BasesList>;

export const Default: Story = {};

export const Empty: Story = {
  args: { data: [] },
};
