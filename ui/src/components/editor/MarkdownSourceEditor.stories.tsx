import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import { useState } from "react";
import { MarkdownSourceEditor } from "./MarkdownSourceEditor";
import { markdownSamples } from "./markdownSamples";

const meta = {
  title: "Editor/MarkdownSourceEditor",
  component: MarkdownSourceEditor,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background p-6 text-foreground">
        <div className="mx-auto max-w-4xl">
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof MarkdownSourceEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SimpleMarkdown: Story = {
  args: {
    value: markdownSamples.simpleMarkdown,
    onChange: () => undefined,
    minHeight: "50vh",
  },
};

export const FrontmatterAndTable: Story = {
  args: {
    value: markdownSamples.frontmatterAndTable,
    onChange: () => undefined,
    minHeight: "70vh",
  },
};

export const DarkModeFrontmatterAndTable: Story = {
  args: {
    value: markdownSamples.frontmatterAndTable,
    onChange: () => undefined,
    dark: true,
    minHeight: "70vh",
  },
  decorators: [
    (Story) => (
      <div className="dark min-h-screen bg-background p-6 text-foreground">
        <div className="mx-auto max-w-4xl">
          <Story />
        </div>
      </div>
    ),
  ],
};

export const ReadOnlyPreview: Story = {
  args: {
    value: markdownSamples.frontmatterAndTable,
    onChange: () => undefined,
    readOnly: true,
    minHeight: "60vh",
  },
};

export const LongDocument: Story = {
  args: {
    value: markdownSamples.longNote,
    onChange: () => undefined,
    minHeight: "80vh",
  },
};

export const DirtyStateHarness: Story = {
  args: {
    value: markdownSamples.simpleMarkdown,
    onChange: () => undefined,
  },
  render: () => {
    const [value, setValue] = useState<string>(markdownSamples.simpleMarkdown);
    const [dirty, setDirty] = useState(false);
    return (
      <div className="space-y-2">
        <div data-testid="dirty-state" className="rounded border px-2 py-1 text-xs">
          {dirty ? "Dirty" : "Clean"}
        </div>
        <MarkdownSourceEditor
          value={value}
          onChange={(next) => {
            setValue(next);
            setDirty(true);
          }}
        />
      </div>
    );
  },
};

export const SlashCommandHints: Story = {
  args: {
    value: "# Slash commands\n\nTry typing `/table`, `/todo`, `/code`, `/quote`, or `/frontmatter` on a new line.\n\n/",
    onChange: () => undefined,
    minHeight: "55vh",
  },
  render: (args) => {
    const [value, setValue] = useState<string>(args.value);
    return (
      <div className="space-y-3">
        <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
          Source-safe Markdown commands: <code>/table</code>, <code>/todo</code>, <code>/code</code>, <code>/quote</code>, <code>/frontmatter</code>.
          Commands insert Markdown text directly, so frontmatter and table syntax stay source-preserving.
        </div>
        <MarkdownSourceEditor {...args} value={value} onChange={setValue} />
      </div>
    );
  },
};

export const SaveShortcutHarness: Story = {
  args: {
    value: markdownSamples.simpleMarkdown,
    onChange: () => undefined,
  },
  render: () => {
    const [value, setValue] = useState<string>(markdownSamples.simpleMarkdown);
    const [saves, setSaves] = useState(0);
    return (
      <div className="space-y-2">
        <div data-testid="save-count" className="rounded border px-2 py-1 text-xs">
          Saves: {saves}
        </div>
        <MarkdownSourceEditor value={value} onChange={setValue} onSaveShortcut={() => setSaves((n) => n + 1)} />
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Wait for CodeMirror to mount
    await new Promise((r) => setTimeout(r, 500));
    const editor = canvasElement.querySelector(".cm-content");
    if (!(editor instanceof HTMLElement)) {
      throw new Error("CodeMirror content element not found — editor may not have mounted yet");
    }
    await userEvent.click(editor);
    await userEvent.keyboard("{Control>}s{/Control}");
    await expect(canvas.getByTestId("save-count")).toHaveTextContent("Saves: 1");
  },
};
