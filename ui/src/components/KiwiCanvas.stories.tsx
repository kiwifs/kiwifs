import type { Meta, StoryObj } from "@storybook/react";
import { action } from "@storybook/addon-actions";
import { KiwiCanvas } from "./KiwiCanvas";
import { MockApiProvider } from "./__mocks__/apiMock";

const meta: Meta<typeof KiwiCanvas> = {
  title: "Canvas/KiwiCanvas",
  component: KiwiCanvas,
  parameters: { layout: "fullscreen" },
  args: {
    onNavigate: action("navigate"),
    onClose: action("close"),
  },
};

export default meta;
type Story = StoryObj<typeof KiwiCanvas>;

export const Sample: Story = {
  decorators: [
    (Story) => (
      <MockApiProvider>
        <div className="h-screen bg-background text-foreground">
          <Story />
        </div>
      </MockApiProvider>
    ),
  ],
  args: { path: "canvases/architecture.canvas.json" },
};

export const Embedded: Story = {
  decorators: [
    (Story) => (
      <MockApiProvider>
        <div className="h-screen bg-background text-foreground">
          <Story />
        </div>
      </MockApiProvider>
    ),
  ],
  args: { path: "canvases/architecture.canvas.json", embedded: true },
};

export const NoPath: Story = {
  args: { path: null },
  decorators: [
    (Story) => (
      <div className="h-screen bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
};
