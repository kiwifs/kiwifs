import type { Meta, StoryObj } from "@storybook/react";
import { action } from "@storybook/addon-actions";
import { KiwiAnalytics } from "./KiwiAnalytics";
import { MockApiProvider } from "./__mocks__/apiMock";

const meta: Meta<typeof KiwiAnalytics> = {
  title: "Analytics/KiwiAnalytics",
  component: KiwiAnalytics,
  parameters: { layout: "fullscreen" },
  args: {
    onClose: action("close"),
    onNavigate: action("navigate"),
  },
};

export default meta;
type Story = StoryObj<typeof KiwiAnalytics>;

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
