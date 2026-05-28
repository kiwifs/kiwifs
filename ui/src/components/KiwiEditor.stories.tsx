import type { Meta, StoryObj } from "@storybook/react";
import { action } from "@storybook/addon-actions";
import { KiwiEditor } from "./KiwiEditor";
import { MockApiProvider } from "./__mocks__/apiMock";
import {
  mockTree,
  mockMarkdownRich,
  mockMarkdownExcalidraw,
} from "./__mocks__/data";

const meta: Meta<typeof KiwiEditor> = {
  title: "Editing/KiwiEditor",
  component: KiwiEditor,
  parameters: { layout: "fullscreen" },
  args: {
    path: "pages/frontmatter.md",
    tree: mockTree,
    onClose: action("close"),
    onSaved: action("saved"),
    onNavigate: action("navigate"),
  },
};

export default meta;
type Story = StoryObj<typeof KiwiEditor>;

export const MarkdownEditor: Story = {
  decorators: [
    (Story) => (
      <MockApiProvider overrides={{ fileContent: mockMarkdownRich }}>
        <div className="h-screen bg-background text-foreground">
          <Story />
        </div>
      </MockApiProvider>
    ),
  ],
};

export const ExcalidrawEditor: Story = {
  args: {
    path: "diagrams/architecture.excalidraw.md",
  },
  decorators: [
    (Story) => (
      <MockApiProvider overrides={{ fileContent: mockMarkdownExcalidraw }}>
        <div className="h-screen bg-background text-foreground">
          <Story />
        </div>
      </MockApiProvider>
    ),
  ],
};

export const NewPage: Story = {
  args: {
    path: "new-page.md",
  },
  decorators: [
    (Story) => (
      <MockApiProvider overrides={{ fileContent: "" }}>
        <div className="h-screen bg-background text-foreground">
          <Story />
        </div>
      </MockApiProvider>
    ),
  ],
};

/** Open editor with Source mode preference (set localStorage before mount). */
export const SourceModePreferred: Story = {
  ...MarkdownEditor,
  decorators: [
    (Story) => {
      try {
        localStorage.setItem("kiwifs-editor-mode", "source");
      } catch {
        /* ignore */
      }
      return (
        <MockApiProvider overrides={{ fileContent: mockMarkdownRich }}>
          <div className="h-screen bg-background text-foreground">
            <Story />
          </div>
        </MockApiProvider>
      );
    },
  ],
};
