import type { Meta, StoryObj } from "@storybook/react";
import { action } from "@storybook/addon-actions";
import { BasesTable, type ViewColumn, type ViewRow } from "./BasesTable";
import { mockBasesRows, mockBasesViews } from "../__mocks__/data";

const columns = mockBasesViews[0]!.columns as ViewColumn[];
const rows = mockBasesRows as ViewRow[];

const meta: Meta<typeof BasesTable> = {
  title: "Bases/BasesTable",
  component: BasesTable,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="h-[480px] bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
  args: {
    columns,
    data: rows,
    onNavigate: action("navigate"),
  },
};

export default meta;
type Story = StoryObj<typeof BasesTable>;

export const Default: Story = {};

export const Empty: Story = {
  args: { data: [] },
};

export const WithSummaries: Story = {
  args: {
    columns: [
      { key: "title", label: "Title" },
      { key: "priority", label: "Priority", summary: "avg" },
      { key: "status", label: "Status", summary: "count" },
    ],
  },
};
