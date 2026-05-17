import type { Meta, StoryObj } from "@storybook/react";
import { action } from "@storybook/addon-actions";
import { KiwiTags } from "./KiwiTags";
import { MockApiProvider } from "./__mocks__/apiMock";

const meta: Meta<typeof KiwiTags> = {
  title: "Navigation/KiwiTags",
  component: KiwiTags,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-md bg-background text-foreground border border-border rounded-lg">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof KiwiTags>;

export const Default: Story = {
  render: () => (
    <MockApiProvider>
      <KiwiTags
        onTagClick={action("tagClick")}
        onNavigate={action("navigate")}
      />
    </MockApiProvider>
  ),
};
