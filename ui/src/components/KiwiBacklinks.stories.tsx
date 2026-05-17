import type { Meta, StoryObj } from "@storybook/react";
import { action } from "@storybook/addon-actions";
import { KiwiBacklinks } from "./KiwiBacklinks";
import { MockApiProvider } from "./__mocks__/apiMock";
import { mockBacklinks } from "./__mocks__/data";

const meta: Meta<typeof KiwiBacklinks> = {
  title: "Navigation/KiwiBacklinks",
  component: KiwiBacklinks,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-sm p-4 bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof KiwiBacklinks>;

export const WithBacklinks: Story = {
  render: () => (
    <MockApiProvider overrides={{ backlinks: mockBacklinks }}>
      <KiwiBacklinks
        path="pages/frontmatter.md"
        onNavigate={action("navigate")}
      />
    </MockApiProvider>
  ),
};

export const NoBacklinks: Story = {
  render: () => (
    <MockApiProvider overrides={{ backlinks: [] }}>
      <KiwiBacklinks
        path="pages/orphan.md"
        onNavigate={action("navigate")}
      />
    </MockApiProvider>
  ),
};
