import type { Meta, StoryObj } from "@storybook/react";
import { action } from "@storybook/addon-actions";
import { KiwiWhiteboardScreen } from "./KiwiWhiteboardScreen";
import { MockApiProvider } from "./__mocks__/apiMock";
import { mockMarkdownExcalidraw, mockTree } from "./__mocks__/data";

const tree = {
  ...mockTree,
  children: [
    ...(mockTree.children ?? []),
    {
      path: "whiteboards",
      name: "whiteboards",
      isDir: true,
      children: [
        { path: "whiteboards/architecture.excalidraw.md", name: "architecture.excalidraw.md", isDir: false, size: 2400 },
        { path: "whiteboards/onboarding.excalidraw.md", name: "onboarding.excalidraw.md", isDir: false, size: 1800 },
      ],
    },
  ],
};

const fileContents = {
  "whiteboards/architecture.excalidraw.md": mockMarkdownExcalidraw,
  "whiteboards/onboarding.excalidraw.md": mockMarkdownExcalidraw,
};

const meta: Meta<typeof KiwiWhiteboardScreen> = {
  title: "Screens/KiwiWhiteboardScreen",
  component: KiwiWhiteboardScreen,
  parameters: { layout: "fullscreen" },
  args: {
    onClose: action("close"),
    onNavigate: action("navigate"),
    onTreeRefresh: action("treeRefresh"),
  },
};

export default meta;
type Story = StoryObj<typeof KiwiWhiteboardScreen>;

export const Hub: Story = {
  decorators: [
    (Story) => (
      <MockApiProvider overrides={{ tree, fileContents }}>
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
      <MockApiProvider>
        <div className="h-screen bg-background text-foreground">
          <Story />
        </div>
      </MockApiProvider>
    ),
  ],
};

export const OpenBoard: Story = {
  decorators: [
    (Story) => (
      <MockApiProvider overrides={{ tree, fileContents }}>
        <div className="h-screen bg-background text-foreground">
          <Story />
        </div>
      </MockApiProvider>
    ),
  ],
  args: { initialPath: "whiteboards/architecture.excalidraw.md" },
};
