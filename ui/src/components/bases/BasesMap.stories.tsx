import type { Meta, StoryObj } from "@storybook/react";
import { action } from "@storybook/addon-actions";
import { BasesMap } from "./BasesMap";
import { mockBasesRows } from "../__mocks__/data";
import type { ViewRow } from "./BasesTable";

const meta: Meta<typeof BasesMap> = {
  title: "Bases/BasesMap",
  component: BasesMap,
  parameters: {
    layout: "padded",
    chromatic: { disableSnapshot: true },
  },
  decorators: [
    (Story) => (
      <div className="h-[480px] bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
  args: {
    data: mockBasesRows as ViewRow[],
    onNavigate: action("navigate"),
  },
};

export default meta;
type Story = StoryObj<typeof BasesMap>;

export const Markers: Story = {};

export const NoGeocodedRows: Story = {
  args: {
    data: mockBasesRows.filter((row) => row.latitude == null) as ViewRow[],
  },
};
