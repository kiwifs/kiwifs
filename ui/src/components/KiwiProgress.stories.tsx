import type { Meta, StoryObj } from "@storybook/react";
import { KiwiProgress } from "./KiwiProgress";

const meta: Meta<typeof KiwiProgress> = {
  title: "Content/KiwiProgress",
  component: KiwiProgress,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-lg p-4 bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof KiwiProgress>;

export const BarChart: Story = {
  args: {
    source: `type: bar
title: Project Progress
items:
  - label: Backend API
    value: 85
    color: "#22c55e"
  - label: Frontend
    value: 60
    color: "#f59e0b"
  - label: Documentation
    value: 30
    color: "#ef4444"
  - label: Testing
    value: 45
    color: "#3b82f6"`,
  },
};

export const GaugeChart: Story = {
  args: {
    source: `type: gauge
title: Sprint Health
items:
  - label: Velocity
    value: 78
    color: "#22c55e"
  - label: Quality
    value: 92
    color: "#3b82f6"
  - label: Coverage
    value: 55
    color: "#f59e0b"
  - label: Debt
    value: 25
    color: "#ef4444"`,
  },
};

export const CustomMax: Story = {
  args: {
    source: `type: bar
title: Sprint Points
showPercent: true
items:
  - label: Completed
    value: 34
    max: 50
    color: "#22c55e"
  - label: In Progress
    value: 12
    max: 50
    color: "#3b82f6"`,
  },
};

export const NoAnimation: Story = {
  args: {
    source: `type: bar
animated: false
items:
  - label: CPU Usage
    value: 72
  - label: Memory
    value: 45
  - label: Disk
    value: 88`,
  },
};

export const ErrorState: Story = {
  args: {
    source: "invalid yaml {{{}",
  },
};
