import type { Meta, StoryObj } from "@storybook/react-vite";
import { PageSkeleton } from "./PageSkeleton";

const meta: Meta<typeof PageSkeleton> = {
  title: "Feedback/PageSkeleton",
  component: PageSkeleton,
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof PageSkeleton>;

export const Default: Story = {};
