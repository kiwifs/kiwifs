import type { Meta, StoryObj } from "@storybook/react";
import { Input } from "./input";
import { Label } from "./label";

const meta: Meta<typeof Label> = {
  title: "UI/Label",
  component: Label,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-sm space-y-2 p-4 bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Label>;

export const Default: Story = {
  args: { children: "Page title" },
};

export const WithInput: Story = {
  render: () => (
    <>
      <Label htmlFor="title">Page title</Label>
      <Input id="title" placeholder="Frontmatter Guide" />
    </>
  ),
};
