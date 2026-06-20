import { researchMock, researchPages } from "../content/research";
import { treeFromPages } from "../helpers";
import type { DemoTemplateConfig } from "../types";

export const researchDemo: DemoTemplateConfig = {
  slug: "research",
  title: "Research Library",
  description: "Papers, citations, reading workflow, and synthesis.",
  useCase: "Research & literature reviews",
  themePreset: "Forest",
  defaultTheme: "dark",
  accentClass: "bg-green-600",
  initialPath: "papers/attention-is-all-you-need.md",
  initialView: "graph",
  branding: {
    name: "ML Paper Shelf",
    welcomeTitle: "Research library",
    welcomeMessage: "Citations, contradictions, and semantic search in one workspace.",
  },
  tree: treeFromPages(researchPages),
  fileContents: researchPages,
  mock: researchMock,
};
