import type { Meta, StoryObj } from "@storybook/react";
import { action } from "@storybook/addon-actions";
import { SpaceSelector } from "./SpaceSelector";
import { MockApiProvider } from "./__mocks__/apiMock";

const meta: Meta<typeof SpaceSelector> = {
  title: "Navigation/SpaceSelector",
  component: SpaceSelector,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <MockApiProvider>
        <div className="w-64 bg-background text-foreground border border-border rounded-lg">
          <Story />
        </div>
      </MockApiProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof SpaceSelector>;

export const Default: Story = {
  args: {
    onSwitch: action("switch"),
  },
};
