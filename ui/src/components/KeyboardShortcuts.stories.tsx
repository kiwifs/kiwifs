import type { Meta, StoryObj } from "@storybook/react";
import { action } from "@storybook/addon-actions";
import { KeyboardShortcuts } from "./KeyboardShortcuts";
import { DEFAULT_KEYBINDINGS } from "../lib/kiwiKeybindings";

const meta: Meta<typeof KeyboardShortcuts> = {
  title: "Dialogs/KeyboardShortcuts",
  component: KeyboardShortcuts,
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj<typeof KeyboardShortcuts>;

export const Open: Story = {
  args: {
    open: true,
    onOpenChange: action("openChange"),
    bindings: DEFAULT_KEYBINDINGS,
  },
};

export const WithConflicts: Story = {
  args: {
    open: true,
    onOpenChange: action("openChange"),
    bindings: { ...DEFAULT_KEYBINDINGS, search: "mod+k", new_page: "mod+k" },
    conflicts: [{ chord: "mod+k", actions: ["search", "new_page"] }],
  },
};
