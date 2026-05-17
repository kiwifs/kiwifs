import type { Meta, StoryObj } from "@storybook/react";
import { KiwiChart } from "./KiwiChart";

const meta: Meta<typeof KiwiChart> = {
  title: "Content/KiwiChart",
  component: KiwiChart,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-2xl p-4 bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof KiwiChart>;

export const BarChart: Story = {
  args: {
    source: `type: bar
title: Monthly Revenue
grid: true
legend: true
xKey: month
series:
  - key: revenue
    color: "#3b82f6"
    name: Revenue
  - key: expenses
    color: "#ef4444"
    name: Expenses
data:
  - month: Jan
    revenue: 4000
    expenses: 2400
  - month: Feb
    revenue: 3000
    expenses: 1398
  - month: Mar
    revenue: 5000
    expenses: 3800
  - month: Apr
    revenue: 4500
    expenses: 3200
  - month: May
    revenue: 6000
    expenses: 4100
  - month: Jun
    revenue: 5500
    expenses: 3900`,
  },
};

export const LineChart: Story = {
  args: {
    source: `type: line
title: Weekly Active Users
grid: true
legend: true
xKey: week
series:
  - key: users
    color: "#8b5cf6"
    name: Users
data:
  - week: W1
    users: 120
  - week: W2
    users: 180
  - week: W3
    users: 150
  - week: W4
    users: 220
  - week: W5
    users: 310
  - week: W6
    users: 280`,
  },
};

export const AreaChart: Story = {
  args: {
    source: `type: area
title: Memory Usage Over Time
grid: true
xKey: time
series:
  - key: heap
    color: "#06b6d4"
    name: Heap
  - key: rss
    color: "#f59e0b"
    name: RSS
data:
  - time: 0s
    heap: 50
    rss: 80
  - time: 10s
    heap: 65
    rss: 95
  - time: 20s
    heap: 80
    rss: 110
  - time: 30s
    heap: 55
    rss: 88
  - time: 40s
    heap: 70
    rss: 100`,
  },
};

export const PieChart: Story = {
  args: {
    source: `type: pie
title: Traffic Sources
legend: true
xKey: source
series:
  - key: visits
data:
  - source: Organic
    visits: 4500
  - source: Direct
    visits: 2800
  - source: Social
    visits: 1800
  - source: Referral
    visits: 1200
  - source: Email
    visits: 900`,
  },
};

export const RadarChart: Story = {
  args: {
    source: `type: radar
title: Skill Assessment
legend: true
xKey: skill
series:
  - key: score
    color: "#3b82f6"
    name: Current
data:
  - skill: Frontend
    score: 85
  - skill: Backend
    score: 72
  - skill: DevOps
    score: 60
  - skill: Design
    score: 45
  - skill: Testing
    score: 78
  - skill: Docs
    score: 90`,
  },
};

export const ErrorState: Story = {
  args: {
    source: "this is invalid config {{{",
  },
};
