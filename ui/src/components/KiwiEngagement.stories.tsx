import type { Meta, StoryObj } from "@storybook/react";
import { action } from "@storybook/addon-actions";
import { KiwiEngagement } from "./KiwiEngagement";
import { MockApiProvider } from "./__mocks__/apiMock";

const meta: Meta<typeof KiwiEngagement> = {
  title: "Analytics/KiwiEngagement",
  component: KiwiEngagement,
  parameters: { layout: "fullscreen" },
  args: {
    onClose: action("close"),
    onNavigate: action("navigate"),
  },
};

export default meta;
type Story = StoryObj<typeof KiwiEngagement>;

export const Loaded: Story = {
  decorators: [
    (Story) => (
      <MockApiProvider>
        <div className="h-screen bg-background text-foreground">
          <Story />
        </div>
      </MockApiProvider>
    ),
  ],
};

export const Empty: Story = {
  decorators: [
    (Story) => (
      <MockApiProvider overrides={{ analyticsEmpty: true }}>
        <div className="h-screen bg-background text-foreground">
          <Story />
        </div>
      </MockApiProvider>
    ),
  ],
};

export const ErrorState: Story = {
  decorators: [
    (Story) => (
      <MockApiProvider overrides={{ analyticsError: true }}>
        <div className="h-screen bg-background text-foreground">
          <Story />
        </div>
      </MockApiProvider>
    ),
  ],
};
