import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { action } from "@storybook/addon-actions";
import { KiwiFavorites } from "./KiwiFavorites";

const RECENT_KEY = "kiwi-recent-pages";
const FAVORITES_KEY = "kiwi-favorite-pages";

/**
 * Wrapper that sets localStorage before mounting the component,
 * using a key to force re-mount after storage is ready.
 */
function FavoritesHarness({
  favorites,
  recents,
}: {
  favorites: string[];
  recents: string[];
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    localStorage.setItem(RECENT_KEY, JSON.stringify(recents));
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return <KiwiFavorites onSelect={action("select")} refreshKey={Date.now()} />;
}

const meta: Meta<typeof KiwiFavorites> = {
  title: "Navigation/KiwiFavorites",
  component: KiwiFavorites,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-64 border border-border rounded-lg bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof KiwiFavorites>;

export const WithFavoritesAndRecents: Story = {
  render: () => (
    <FavoritesHarness
      favorites={["pages/frontmatter.md", "pages/wikilinks.md", "index.md"]}
      recents={["pages/use-sqlite-for-search.md", "episodes/example-episode.md", "welcome.md", "pages/frontmatter.md"]}
    />
  ),
};

export const OnlyFavorites: Story = {
  render: () => (
    <FavoritesHarness
      favorites={["pages/frontmatter.md", "pages/wikilinks.md"]}
      recents={[]}
    />
  ),
};

export const OnlyRecents: Story = {
  render: () => (
    <FavoritesHarness
      favorites={[]}
      recents={["pages/use-sqlite-for-search.md", "episodes/example-episode.md", "welcome.md"]}
    />
  ),
};

export const Empty: Story = {
  render: () => (
    <FavoritesHarness favorites={[]} recents={[]} />
  ),
  parameters: {
    docs: {
      description: {
        story: "When both favorites and recents are empty, the component renders nothing (returns null). This is by design — the sidebar section is simply hidden.",
      },
    },
  },
};
