import { cmsMock, cmsPages } from "../content/cms";
import { treeFromPages } from "../helpers";
import type { DemoTemplateConfig } from "../types";

export const cmsDemo: DemoTemplateConfig = {
  slug: "cms",
  title: "Headless CMS",
  description: "Editorial workflow, publishing, and rich content.",
  useCase: "Git-based headless CMS",
  themePreset: "Forest",
  defaultTheme: "light",
  accentClass: "bg-emerald-600",
  initialPath: "blog/kerning.md",
  branding: {
    name: "Type & Ink",
    welcomeTitle: "Design blog",
    welcomeMessage: "Draft → review → publish — all markdown on disk.",
  },
  tree: treeFromPages(cmsPages),
  fileContents: cmsPages,
  mock: cmsMock,
};
