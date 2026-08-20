import type { Meta, StoryObj } from "@storybook/react";
import { ScrollArea } from "./scroll-area";

const meta: Meta<typeof ScrollArea> = {
  title: "UI/ScrollArea",
  component: ScrollArea,
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof ScrollArea>;

export const Default: Story = {
  render: () => (
    <ScrollArea className="h-48 w-72 rounded-md border border-border bg-background p-3 text-sm text-foreground">
      {Array.from({ length: 24 }, (_, i) => (
        <p key={i} className="py-1">
          Row {i + 1} — pages/example-{i + 1}.md
        </p>
      ))}
    </ScrollArea>
  ),
};
