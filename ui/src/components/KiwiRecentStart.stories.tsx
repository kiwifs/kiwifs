import type { Meta, StoryObj } from "@storybook/react";
import { action } from "@storybook/addon-actions";
import { KiwiRecentStart } from "./KiwiRecentStart";
import { MockApiProvider } from "./__mocks__/apiMock";

const meta: Meta<typeof KiwiRecentStart> = {
  title: "Screens/KiwiRecentStart",
  component: KiwiRecentStart,
  parameters: { layout: "fullscreen" },
  args: {
    onOpen: action("open"),
    onEdit: action("edit"),
  },
};

export default meta;
type Story = StoryObj<typeof KiwiRecentStart>;

export const Populated: Story = {
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
      <MockApiProvider overrides={{ recentPages: [] }}>
        <div className="h-screen bg-background text-foreground">
          <Story />
        </div>
      </MockApiProvider>
    ),
  ],
};

export const Loading: Story = {
  decorators: [
    (Story) => (
      <MockApiProvider overrides={{ delay: 60_000 }}>
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
      <MockApiProvider overrides={{ recentPagesError: true }}>
        <div className="h-screen bg-background text-foreground">
          <Story />
        </div>
      </MockApiProvider>
    ),
  ],
};
