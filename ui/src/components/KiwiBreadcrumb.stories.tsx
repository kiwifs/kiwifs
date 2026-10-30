import type { Meta, StoryObj } from "@storybook/react-vite";
import { action } from "storybook/actions";
import { KiwiBreadcrumb } from "./KiwiBreadcrumb";

const meta: Meta<typeof KiwiBreadcrumb> = {
  title: "Navigation/KiwiBreadcrumb",
  component: KiwiBreadcrumb,
  parameters: { layout: "padded" },
  args: {
    onNavigate: action("navigate"),
  },
  decorators: [
    (Story) => (
      <div className="bg-background text-foreground p-4">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof KiwiBreadcrumb>;

export const RootLevel: Story = {
  args: { path: "index.md" },
};

export const OneLevelDeep: Story = {
  args: { path: "pages/frontmatter.md" },
};

export const TwoLevelsDeep: Story = {
  args: { path: "projects/kiwi/architecture.md" },
};

export const DeeplyNested: Story = {
  args: { path: "team/engineering/frontend/components/button.md" },
};
