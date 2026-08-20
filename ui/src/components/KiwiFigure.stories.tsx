import type { Meta, StoryObj } from "@storybook/react";
import { KiwiFigure } from "./KiwiFigure";

function Placeholder({ label }: { label: string }) {
  return (
    <div className="flex h-40 items-center justify-center rounded-md bg-muted text-sm text-muted-foreground">
      {label}
    </div>
  );
}

const meta: Meta<typeof KiwiFigure> = {
  title: "Content/KiwiFigure",
  component: KiwiFigure,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-3xl p-4 bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof KiwiFigure>;

export const Inline: Story = {
  args: {
    width: "inline",
    caption: "Architecture overview",
    children: <Placeholder label="Figure media" />,
  },
};

export const Wide: Story = {
  args: {
    width: "wide",
    caption: "Full-bleed diagram",
    children: <Placeholder label="Wide figure" />,
  },
};

export const Pinned: Story = {
  args: {
    width: "inline",
    pin: true,
    caption: "Pinned while scrolling",
    children: <Placeholder label="Pinned figure" />,
  },
};
