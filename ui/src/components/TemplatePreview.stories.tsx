import type { Meta, StoryObj } from "@storybook/react";
import { TemplatePreview } from "./TemplatePreview";

const meta: Meta<typeof TemplatePreview> = {
  title: "Dialogs/TemplatePreview",
  component: TemplatePreview,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-md border border-border rounded-md overflow-hidden bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof TemplatePreview>;

export const WithContent: Story = {
  args: {
    content: `---
title: {{date "MMMM d, yyyy"}}
tags:
  - daily-note
---

# Daily Note

## Tasks
- [ ] Morning review
- [ ] Check inbox
- [ ] Plan priorities

## Notes

## End of Day Review
`,
    loading: false,
    error: null,
  },
};

export const Loading: Story = {
  args: {
    content: null,
    loading: true,
    error: null,
  },
};

export const Error: Story = {
  args: {
    content: null,
    loading: false,
    error: "Failed to resolve template: network error",
  },
};

export const Empty: Story = {
  args: {
    content: null,
    loading: false,
    error: null,
  },
};
