import type { Meta, StoryObj } from "@storybook/react";
import { action } from "@storybook/addon-actions";
import { KiwiEmbed } from "./KiwiEmbed";
import { MockApiProvider } from "./__mocks__/apiMock";
import { mockMarkdownExcalidraw } from "./__mocks__/data";

const CANVAS = JSON.stringify({
  nodes: [
    { id: "n1", type: "text", x: 40, y: 40, width: 180, height: 70, text: "Start" },
    { id: "n2", type: "text", x: 280, y: 40, width: 180, height: 70, text: "Finish" },
  ],
  edges: [{ id: "e1", fromNode: "n1", toNode: "n2" }],
});

const meta: Meta<typeof KiwiEmbed> = {
  title: "Content/KiwiEmbed",
  component: KiwiEmbed,
  parameters: { layout: "padded" },
  args: { onNavigate: action("navigate") },
};

export default meta;
type Story = StoryObj<typeof KiwiEmbed>;

export const Excalidraw: Story = {
  decorators: [
    (Story) => (
      <MockApiProvider overrides={{ fileContents: { "diagrams/arch.excalidraw.md": mockMarkdownExcalidraw } }}>
        <div className="max-w-3xl p-4 bg-background text-foreground">
          <Story />
        </div>
      </MockApiProvider>
    ),
  ],
  args: { path: "diagrams/arch.excalidraw.md" },
};

export const Canvas: Story = {
  decorators: [
    (Story) => (
      <MockApiProvider overrides={{ fileContents: { "canvases/flow.canvas.json": CANVAS } }}>
        <div className="max-w-3xl p-4 bg-background text-foreground">
          <Story />
        </div>
      </MockApiProvider>
    ),
  ],
  args: { path: "canvases/flow.canvas.json" },
};

export const ErrorState: Story = {
  decorators: [
    (Story) => (
      <MockApiProvider overrides={{ fileStatus: 404 }}>
        <div className="max-w-3xl p-4 bg-background text-foreground">
          <Story />
        </div>
      </MockApiProvider>
    ),
  ],
  args: { path: "missing.excalidraw.md" },
};
