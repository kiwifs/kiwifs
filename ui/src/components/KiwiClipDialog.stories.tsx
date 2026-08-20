import type { Meta, StoryObj } from "@storybook/react";
import { action } from "@storybook/addon-actions";
import { KiwiClipDialog } from "./KiwiClipDialog";
import { MockApiProvider } from "./__mocks__/apiMock";

const meta: Meta<typeof KiwiClipDialog> = {
  title: "Dialogs/KiwiClipDialog",
  component: KiwiClipDialog,
  parameters: { layout: "centered" },
  args: {
    open: true,
    onOpenChange: action("openChange"),
    onClipped: action("clipped"),
  },
};

export default meta;
type Story = StoryObj<typeof KiwiClipDialog>;

export const Open: Story = {
  decorators: [
    (Story) => (
      <MockApiProvider>
        <Story />
      </MockApiProvider>
    ),
  ],
};

export const ClipError: Story = {
  decorators: [
    (Story) => (
      <MockApiProvider overrides={{ clipError: true }}>
        <Story />
      </MockApiProvider>
    ),
  ],
};
