import type { Meta, StoryObj } from "@storybook/react";
import { action } from "@storybook/addon-actions";
import { KiwiQuery } from "./KiwiQuery";
import { MockApiProvider } from "./__mocks__/apiMock";

const meta: Meta<typeof KiwiQuery> = {
  title: "Content/KiwiQuery",
  component: KiwiQuery,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <MockApiProvider>
        <div className="max-w-2xl p-4 bg-background text-foreground">
          <Story />
        </div>
      </MockApiProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof KiwiQuery>;

export const DQLTable: Story = {
  args: {
    source: 'TABLE name, status FROM "students/" WHERE status = "active" SORT name ASC',
    onNavigate: action("navigate"),
  },
};

export const LegacyFormat: Story = {
  args: {
    source: `from: pages/
where: $.status = published
sort: $.priority
order: desc
limit: 10
columns: path, status, priority`,
    onNavigate: action("navigate"),
  },
};

export const ComputedView: Story = {
  args: {
    source: 'TABLE path, status FROM "pages/" LIMIT 5',
    isComputedView: true,
    onNavigate: action("navigate"),
  },
};

export const CalendarQuery: Story = {
  args: {
    source: 'CALENDAR date FROM "pages/"',
    onNavigate: action("navigate"),
  },
};
