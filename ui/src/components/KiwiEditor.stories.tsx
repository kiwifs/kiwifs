import type { Meta, StoryObj } from "@storybook/react-vite";
import { action } from "storybook/actions";
import { expect, waitFor } from "storybook/test";
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
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Accessibility: verify keyboard-only navigation, visible focus indicators, named visual/source editor regions, save-status live announcements, and axe results for the editor modes.",
      },
    },
  },
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
  parameters: {
    docs: {
      description: {
        story:
          "Use this story for visual editor accessibility checks: Tab reaches breadcrumbs, title, mode switch, actions, frontmatter toggle, and the named Markdown visual editor region. Save-status text is exposed as a polite live region.",
      },
    },
  },
  decorators: [
    (Story) => (
      <MockApiProvider overrides={{ fileContent: mockMarkdownRich }}>
        <main className="h-screen bg-background text-foreground">
          <Story />
        </main>
      </MockApiProvider>
    ),
  ],
};

export const ExcalidrawEditor: Story = {
  parameters: {
    docs: {
      description: {
        story:
          "Use this story for Excalidraw editor accessibility checks, including named KiwiFS action buttons and patched labels for third-party Excalidraw menu controls.",
      },
    },
  },
  args: {
    path: "diagrams/architecture.excalidraw.md",
  },
  decorators: [
    (Story) => (
      <MockApiProvider overrides={{ fileContent: mockMarkdownExcalidraw }}>
        <main className="h-screen bg-background text-foreground">
          <Story />
        </main>
      </MockApiProvider>
    ),
  ],
};

export const NewPage: Story = {
  parameters: {
    docs: {
      description: {
        story:
          "Use this story to verify empty-page editor focus order, visible focus indicators, and save-status announcements before content exists.",
      },
    },
  },
  args: {
    path: "new-page.md",
  },
  decorators: [
    (Story) => (
      <MockApiProvider overrides={{ fileContent: "" }}>
        <main className="h-screen bg-background text-foreground">
          <Story />
        </main>
      </MockApiProvider>
    ),
  ],
};

/** Open editor with Source mode preference (set localStorage before mount). */
export const SourceModePreferred: Story = {
  ...MarkdownEditor,
  parameters: {
    docs: {
      description: {
        story:
          "Use this story for source editor accessibility checks: the CodeMirror content region has a Markdown source editor name and supports keyboard save shortcuts.",
      },
    },
  },
  decorators: [
    (Story) => {
      try {
        localStorage.setItem("kiwifs-editor-mode", "source");
      } catch {
        /* ignore */
      }
      return (
        <MockApiProvider overrides={{ fileContent: mockMarkdownRich }}>
          <main className="h-screen bg-background text-foreground">
            <Story />
          </main>
        </MockApiProvider>
      );
    },
  ],
};

/** Open editor in Live mode: the CodeMirror text with live preview decorations. */
export const LivePreviewPreferred: Story = {
  ...MarkdownEditor,
  parameters: {
    docs: {
      description: {
        story:
          "Use this story for live preview checks: the content region is named Markdown live preview editor, the mode switch offers Visual, Live and Source, and the Vim toggle is a pressed/unpressed button.",
      },
    },
  },
  decorators: [
    (Story) => {
      try {
        localStorage.setItem("kiwifs-editor-mode", "live");
      } catch {
        /* ignore */
      }
      return (
        <MockApiProvider overrides={{ fileContent: mockMarkdownRich }}>
          <main className="h-screen bg-background text-foreground">
            <Story />
          </main>
        </MockApiProvider>
      );
    },
  ],
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('[aria-label="Markdown live preview editor"]')).not.toBeNull());
    const modes = canvasElement.querySelectorAll('[aria-label="Editor mode"] button');
    await expect([...modes].map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
    await expect(canvasElement.querySelector('[aria-label="Vim keybindings"]')).toHaveAttribute("aria-pressed", "false");
  },
};
