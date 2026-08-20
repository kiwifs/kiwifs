import type { Meta, StoryObj } from "@storybook/react";
import { action } from "@storybook/addon-actions";
import { KiwiThemeEditor } from "./KiwiThemeEditor";
import { MockApiProvider } from "./__mocks__/apiMock";

const meta: Meta<typeof KiwiThemeEditor> = {
  title: "Screens/KiwiThemeEditor",
  component: KiwiThemeEditor,
  parameters: { layout: "fullscreen" },
  args: {
    onClose: action("close"),
    onPresetReset: action("presetReset"),
  },
  decorators: [
    (Story) => (
      <MockApiProvider>
        <div className="h-screen overflow-auto bg-background text-foreground">
          <Story />
        </div>
      </MockApiProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof KiwiThemeEditor>;

export const Standalone: Story = {};

export const Embedded: Story = {
  args: { embedded: true },
};
