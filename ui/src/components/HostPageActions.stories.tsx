import { useEffect } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { HostPageActions } from "./HostPageActions";
import { KIWI_PAGE_ACTION_STATE_EVENT, type KiwiHostConfig } from "../lib/hostConfig";

const HOST_CONFIG: KiwiHostConfig = {
  pageActions: [
    { id: "watch", icon: "Eye", activeIcon: "EyeOff", label: "Watch", activeLabel: "Unwatch" },
    { id: "share", icon: "Share2", label: "Share" },
    { id: "archive", icon: "Archive", label: "Archive", disabled: true },
  ],
};

function withHostConfig(config: KiwiHostConfig, state?: Record<string, { active?: boolean; disabled?: boolean }>) {
  return (Story: () => React.ReactElement) => {
    window.__KIWIFS_CONFIG__ = config;
    useEffect(() => {
      if (state) {
        window.dispatchEvent(new CustomEvent(KIWI_PAGE_ACTION_STATE_EVENT, { detail: state }));
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

const meta: Meta<typeof HostPageActions> = {
  title: "Host/HostPageActions",
  component: HostPageActions,
  parameters: { layout: "padded" },
  args: { path: "pages/frontmatter.md" },
};

export default meta;
type Story = StoryObj<typeof HostPageActions>;

export const Default: Story = {
  decorators: [withHostConfig(HOST_CONFIG)],
};

export const Active: Story = {
  decorators: [withHostConfig(HOST_CONFIG, { watch: { active: true } })],
};

export const Empty: Story = {
  decorators: [withHostConfig({})],
};
