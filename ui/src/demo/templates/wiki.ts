import { wikiMock, wikiPages } from "../content/wiki";
import { treeFromPages } from "../helpers";
import type { DemoTemplateConfig } from "../types";

export const wikiDemo: DemoTemplateConfig = {
  slug: "wiki",
  title: "Team Wiki",
  description: "Self-hosted wiki with links, graph, and block editor.",
  useCase: "Confluence / Notion replacement",
  themePreset: "Ocean",
  defaultTheme: "light",
  accentClass: "bg-sky-500",
  initialPath: "engineering/architecture.md",
  initialView: "graph",
  branding: {
    name: "KiwiFS Wiki",
    welcomeTitle: "Engineering wiki",
    welcomeMessage: "How we build, ship, and document KiwiFS.",
  },
  tree: treeFromPages(wikiPages),
  fileContents: wikiPages,
  mock: wikiMock,
};
