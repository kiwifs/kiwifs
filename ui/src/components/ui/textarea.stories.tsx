import type { Meta, StoryObj } from "@storybook/react";
import { Textarea } from "./textarea";
import { Label } from "./label";

const meta: Meta<typeof Textarea> = {
  title: "UI/Textarea",
  component: Textarea,
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
type Story = StoryObj<typeof Textarea>;

export const Default: Story = {
  args: { placeholder: "Type your message here..." },
};

export const WithLabel: Story = {
  render: () => (
    <div className="grid gap-1.5">
      <Label htmlFor="message">Message</Label>
      <Textarea id="message" placeholder="Write a comment..." />
    </div>
  ),
};

export const Disabled: Story = {
  args: { placeholder: "Disabled textarea", disabled: true },
};

export const WithValue: Story = {
  args: {
    defaultValue: "This textarea has some pre-filled content that the user can edit.",
    rows: 4,
  },
};
