import type { Meta, StoryObj } from "@storybook/react";
import { action } from "@storybook/addon-actions";
import { PageActions } from "./PageActions";
import { MockApiProvider } from "./__mocks__/apiMock";

const meta: Meta<typeof PageActions> = {
  title: "Navigation/PageActions",
  component: PageActions,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <MockApiProvider>
        <div className="flex items-center gap-2 p-4 bg-background text-foreground">
          <span className="text-sm text-muted-foreground">pages/frontmatter.md</span>
          <Story />
        </div>
      </MockApiProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof PageActions>;

export const Default: Story = {
  args: {
    path: "pages/frontmatter.md",
    onDeleted: action("deleted"),
    onDuplicated: action("duplicated"),
    onMoved: action("moved"),
  },
};
