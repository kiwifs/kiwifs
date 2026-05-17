import type { Meta, StoryObj } from "@storybook/react";
import { action } from "@storybook/addon-actions";
import { TemplatePicker } from "./TemplatePicker";
import { MockApiProvider } from "./__mocks__/apiMock";
import { TooltipProvider } from "@kw/components/ui/tooltip";

const meta: Meta<typeof TemplatePicker> = {
  title: "Dialogs/TemplatePicker",
  component: TemplatePicker,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <MockApiProvider>
        <TooltipProvider>
          <Story />
        </TooltipProvider>
      </MockApiProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof TemplatePicker>;

export const Open: Story = {
  args: {
    open: true,
    onOpenChange: action("openChange"),
    onSelect: action("select"),
  },
};
