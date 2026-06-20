import { kbMock, kbPages } from "../content/kb";
import { treeFromPages } from "../helpers";
import type { DemoTemplateConfig } from "../types";

export const kbDemo: DemoTemplateConfig = {
  slug: "kb",
  title: "Knowledge Base",
  description: "Governed articles with verification, freshness, and search.",
  useCase: "Internal & external knowledge base",
  themePreset: "Kiwi",
  defaultTheme: "light",
  accentClass: "bg-lime-500",
  initialPath: "recipes/sourdough.md",
  branding: {
    name: "Recipe KB",
    welcomeTitle: "Recipe knowledge base",
    welcomeMessage: "Verified how-tos, troubleshooting, and reference articles.",
  },
  tree: treeFromPages(kbPages),
  fileContents: kbPages,
  mock: kbMock,
};
