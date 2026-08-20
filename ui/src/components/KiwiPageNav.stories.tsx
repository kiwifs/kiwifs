import type { Meta, StoryObj } from "@storybook/react";
import { action } from "@storybook/addon-actions";
import { KiwiPageNav } from "./KiwiPageNav";
import { MockApiProvider } from "./__mocks__/apiMock";

const meta: Meta<typeof KiwiPageNav> = {
  title: "Navigation/KiwiPageNav",
  component: KiwiPageNav,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <MockApiProvider>
        <div className="max-w-3xl p-8 bg-background text-foreground">
          <Story />
        </div>
      </MockApiProvider>
    ),
  ],
  args: { onNavigate: action("navigate") },
};

export default meta;
type Story = StoryObj<typeof KiwiPageNav>;

const current = { path: "pages/kanban.md", title: "Kanban Workflows" };

export const Both: Story = {
  args: {
    nav: {
      current,
      prev: { path: "pages/frontmatter.md", title: "Frontmatter Guide", description: "How pages declare metadata." },
      next: { path: "pages/wikilinks.md", title: "Wiki Links", description: "Link pages with [[wikilinks]]." },
      index: 1,
      total: 3,
    },
  },
};

export const NextOnly: Story = {
  args: {
    nav: {
      current,
      prev: null,
      next: { path: "pages/use-sqlite-for-search.md", title: "SQLite for Search" },
      index: 0,
      total: 2,
    },
  },
};

export const PrevOnly: Story = {
  args: {
    nav: {
      current,
      prev: { path: "pages/frontmatter.md", title: "Frontmatter Guide" },
      next: null,
      index: 1,
      total: 2,
    },
  },
};
