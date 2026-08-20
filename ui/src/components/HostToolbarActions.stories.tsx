import { useEffect } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { HostToolbarActions } from "./HostToolbarActions";
import { KIWI_TOOLBAR_STATE_EVENT, type KiwiHostConfig } from "../lib/hostConfig";

const HOST_CONFIG: KiwiHostConfig = {
  toolbar: {
    actions: [
      { id: "my-tool", icon: "Wand2", label: "My tool" },
      { id: "bot", icon: "BotMessageSquare", label: "Ask agent" },
      { id: "disabled-tool", icon: "Lock", label: "Locked", disabled: true },
    ],
  },
};

function withHostConfig(config: KiwiHostConfig, state?: Record<string, { active?: boolean; disabled?: boolean }>) {
  return (Story: () => React.ReactElement) => {
    window.__KIWIFS_CONFIG__ = config;
    useEffect(() => {
      if (state) {
        window.dispatchEvent(new CustomEvent(KIWI_TOOLBAR_STATE_EVENT, { detail: state }));
      }
      return () => {
        delete window.__KIWIFS_CONFIG__;
      };
    }, []);
    return (
      <div className="flex items-center gap-1 p-4 bg-background text-foreground">
        <Story />
      </div>
    );
  };
}

const meta: Meta<typeof HostToolbarActions> = {
  title: "Host/HostToolbarActions",
  component: HostToolbarActions,
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof HostToolbarActions>;

export const Default: Story = {
  decorators: [withHostConfig(HOST_CONFIG)],
};

export const Active: Story = {
  decorators: [withHostConfig(HOST_CONFIG, { "my-tool": { active: true } })],
};

export const Empty: Story = {
  decorators: [withHostConfig({})],
};
