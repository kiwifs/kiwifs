import type { Meta, StoryObj } from "@storybook/react";
import { action } from "@storybook/addon-actions";
import { BasesViewDialog } from "./BasesViewDialog";
import { mockBasesViews } from "../__mocks__/data";

const meta: Meta<typeof BasesViewDialog> = {
  title: "Bases/BasesViewDialog",
  component: BasesViewDialog,
  parameters: { layout: "centered" },
  args: {
    open: true,
    onOpenChange: action("openChange"),
    onSave: action("save"),
  },
};

export default meta;
type Story = StoryObj<typeof BasesViewDialog>;

export const Create: Story = {};

export const Edit: Story = {
  args: {
    initial: {
      ...mockBasesViews[0]!,
      group_by: undefined,
    },
  },
};
