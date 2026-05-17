import type { Meta, StoryObj } from "@storybook/react";
import { Separator } from "./separator";

const meta: Meta<typeof Separator> = {
  title: "UI/Separator",
  component: Separator,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-md p-4 bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Separator>;

export const Horizontal: Story = {
  render: () => (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-medium">Section One</h4>
        <p className="text-sm text-muted-foreground">Content above the separator.</p>
      </div>
      <Separator />
      <div>
        <h4 className="text-sm font-medium">Section Two</h4>
        <p className="text-sm text-muted-foreground">Content below the separator.</p>
      </div>
    </div>
  ),
};

export const Vertical: Story = {
  render: () => (
    <div className="flex items-center gap-4 h-8">
      <span className="text-sm">Home</span>
      <Separator orientation="vertical" />
      <span className="text-sm">Docs</span>
      <Separator orientation="vertical" />
      <span className="text-sm">Settings</span>
    </div>
  ),
};
