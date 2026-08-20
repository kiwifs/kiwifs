import type { Meta, StoryObj } from "@storybook/react";
import type React from "react";
import { ErrorBoundary } from "./ErrorBoundary";

const meta: Meta<typeof ErrorBoundary> = {
  title: "Feedback/ErrorBoundary",
  component: ErrorBoundary,
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
type Story = StoryObj<typeof ErrorBoundary>;

function Bomb(): React.ReactElement {
  throw new Error("Storybook test error: the claim renderer exploded");
}

export const Caught: Story = {
  render: () => (
    <ErrorBoundary>
      <Bomb />
    </ErrorBoundary>
  ),
};

export const CustomFallback: Story = {
  render: () => (
    <ErrorBoundary fallback={<p className="text-sm text-muted-foreground">Custom fallback UI</p>}>
      <Bomb />
    </ErrorBoundary>
  ),
};

export const Healthy: Story = {
  render: () => (
    <ErrorBoundary>
      <p className="text-sm">Children render normally when nothing throws.</p>
    </ErrorBoundary>
  ),
};
