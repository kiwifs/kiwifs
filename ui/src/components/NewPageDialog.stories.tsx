import type { Meta, StoryObj } from "@storybook/react";
import { action } from "@storybook/addon-actions";
import { NewPageDialog } from "./NewPageDialog";
import { MockApiProvider } from "./__mocks__/apiMock";

const meta: Meta<typeof NewPageDialog> = {
  title: "Dialogs/NewPageDialog",
  component: NewPageDialog,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <MockApiProvider>
        <Story />
      </MockApiProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof NewPageDialog>;

export const Open: Story = {
  args: {
    open: true,
    onOpenChange: action("openChange"),
    onCreated: action("created"),
  },
};

export const WithDefaultFolder: Story = {
  args: {
    open: true,
    onOpenChange: action("openChange"),
    onCreated: action("created"),
    defaultFolder: "pages/",
  },
};
