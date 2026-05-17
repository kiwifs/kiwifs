import type { Meta, StoryObj } from "@storybook/react";
import { action } from "@storybook/addon-actions";
import { KiwiTimeline } from "./KiwiTimeline";
import { MockApiProvider } from "./__mocks__/apiMock";

const meta: Meta<typeof KiwiTimeline> = {
  title: "Navigation/KiwiTimeline",
  component: KiwiTimeline,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <MockApiProvider>
        <div className="h-[600px] bg-background text-foreground">
          <Story />
        </div>
      </MockApiProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof KiwiTimeline>;

export const Default: Story = {
  args: {
    onClose: action("close"),
    onNavigate: action("navigate"),
  },
};
