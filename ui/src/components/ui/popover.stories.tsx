import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./button";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

const meta: Meta<typeof Popover> = {
  title: "UI/Popover",
  component: Popover,
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj<typeof Popover>;

export const Default: Story = {
  render: () => (
    <Popover defaultOpen>
      <PopoverTrigger asChild>
        <Button variant="outline">Published</Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 space-y-2">
        <p className="text-sm font-medium">Public page</p>
        <p className="text-xs text-muted-foreground">42 views · copied link</p>
        <Button size="sm" variant="outline" className="w-full">
          Unpublish
        </Button>
      </PopoverContent>
    </Popover>
  ),
};
