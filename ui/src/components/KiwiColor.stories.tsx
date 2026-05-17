import type { Meta, StoryObj } from "@storybook/react";
import { KiwiColor } from "./KiwiColor";

const meta: Meta<typeof KiwiColor> = {
  title: "Content/KiwiColor",
  component: KiwiColor,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-xl p-4 bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof KiwiColor>;

export const SimpleMode: Story = {
  args: {
    source: `#3b82f6 Primary
#ef4444 Danger
#22c55e Success
#f59e0b Warning
#8b5cf6 Violet
#06b6d4 Cyan`,
  },
};

export const YAMLMode: Story = {
  args: {
    source: `palette: Design System Colors
showContrast: true
swatchSize: medium
colors:
  - label: Primary
    value: "#3b82f6"
  - label: Secondary
    value: "#64748b"
  - label: Accent
    value: "#f59e0b"
  - label: Destructive
    value: "#ef4444"
  - label: Success
    value: "#22c55e"`,
  },
};

export const LargeSwatches: Story = {
  args: {
    source: `palette: Brand Colors
swatchSize: large
colors:
  - label: Brand Blue
    value: "#1d4ed8"
  - label: Brand Purple
    value: "#7c3aed"
  - label: Brand Pink
    value: "#db2777"`,
  },
};

export const SmallSwatches: Story = {
  args: {
    source: `palette: Grayscale
swatchSize: small
colors:
  - label: "50"
    value: "#fafafa"
  - label: "100"
    value: "#f4f4f5"
  - label: "200"
    value: "#e4e4e7"
  - label: "300"
    value: "#d4d4d8"
  - label: "500"
    value: "#71717a"
  - label: "700"
    value: "#3f3f46"
  - label: "900"
    value: "#18181b"`,
  },
};

export const Empty: Story = {
  args: {
    source: "",
  },
};
