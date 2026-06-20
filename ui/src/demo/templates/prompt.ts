import { promptMock, promptPages } from "../content/prompt";
import { treeFromPages } from "../helpers";
import type { DemoTemplateConfig } from "../types";

export const promptDemo: DemoTemplateConfig = {
  slug: "prompt",
  title: "Prompt Library",
  description: "Versioned prompts, diffs, and evaluation.",
  useCase: "Prompt management",
  themePreset: "Sunset",
  defaultTheme: "dark",
  accentClass: "bg-orange-400",
  initialPath: "system/code-review-v3.md",
  branding: {
    name: "Prompt Registry",
    welcomeTitle: "Versioned prompts",
    welcomeMessage: "Git history for prompts — no separate SaaS.",
  },
  tree: treeFromPages(promptPages),
  fileContents: promptPages,
  mock: promptMock,
};
