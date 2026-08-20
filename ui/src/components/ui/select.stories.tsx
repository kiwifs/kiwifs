import type { Meta, StoryObj } from "@storybook/react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

function Example({ disabled = false }: { disabled?: boolean }) {
  return (
    <Select disabled={disabled}>
      <SelectTrigger className="w-56">
        <SelectValue placeholder="Choose a layout" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="table">Table</SelectItem>
        <SelectItem value="cards">Cards</SelectItem>
        <SelectItem value="list">List</SelectItem>
        <SelectItem value="map">Map</SelectItem>
      </SelectContent>
    </Select>
  );
}

const meta: Meta<typeof Example> = {
  title: "UI/Select",
  component: Example,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="p-4 bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Example>;

export const Default: Story = {};

export const Disabled: Story = {
  args: { disabled: true },
};
