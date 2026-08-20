import type { Meta, StoryObj } from "@storybook/react";
import { action } from "@storybook/addon-actions";
import { PublishButton } from "./PublishButton";
import { MockApiProvider } from "./__mocks__/apiMock";

const meta: Meta<typeof PublishButton> = {
  title: "Navigation/PublishButton",
  component: PublishButton,
  parameters: { layout: "padded" },
  args: {
    path: "pages/frontmatter.md",
    onPublishedChanged: action("publishedChanged"),
  },
};

export default meta;
type Story = StoryObj<typeof PublishButton>;

export const Unpublished: Story = {
  decorators: [
    (Story) => (
      <MockApiProvider overrides={{ publishPublished: false }}>
        <div className="p-4 bg-background text-foreground">
          <Story />
        </div>
      </MockApiProvider>
    ),
  ],
};

export const Published: Story = {
  decorators: [
    (Story) => (
      <MockApiProvider overrides={{ publishPublished: true }}>
        <div className="p-4 bg-background text-foreground">
          <Story />
        </div>
      </MockApiProvider>
    ),
  ],
};
