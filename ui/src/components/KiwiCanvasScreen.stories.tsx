import type { Meta, StoryObj } from "@storybook/react";
import { action } from "@storybook/addon-actions";
import { KiwiCanvasScreen } from "./KiwiCanvasScreen";
import { MockApiProvider } from "./__mocks__/apiMock";

const meta: Meta<typeof KiwiCanvasScreen> = {
  title: "Screens/KiwiCanvasScreen",
  component: KiwiCanvasScreen,
  parameters: { layout: "fullscreen" },
  args: {
    onClose: action("close"),
    onNavigate: action("navigate"),
    onTreeRefresh: action("treeRefresh"),
  },
};

export default meta;
type Story = StoryObj<typeof KiwiCanvasScreen>;

export const Hub: Story = {
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
      <MockApiProvider overrides={{ canvases: [] }}>
        <div className="h-screen bg-background text-foreground">
          <Story />
        </div>
      </MockApiProvider>
    ),
  ],
};

export const OpenCanvas: Story = {
  decorators: [
    (Story) => (
      <MockApiProvider>
        <div className="h-screen bg-background text-foreground">
          <Story />
        </div>
      </MockApiProvider>
    ),
  ],
  args: { initialCanvasPath: "canvases/architecture.canvas.json" },
};
