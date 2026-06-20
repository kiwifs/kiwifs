import { memoryMock, memoryPages } from "../content/memory";
import { treeFromPages } from "../helpers";
import type { DemoTemplateConfig } from "../types";

export const memoryDemo: DemoTemplateConfig = {
  slug: "memory",
  title: "Agent Memory",
  description: "Episodic notes, semantic links, and consolidation.",
  useCase: "Persistent agent memory",
  themePreset: "Kiwi",
  defaultTheme: "dark",
  accentClass: "bg-lime-400",
  initialPath: "episodes/auth-refactor.md",
  initialView: "timeline",
  branding: {
    name: "Coding Agent Memory",
    welcomeTitle: "Session memory",
    welcomeMessage: "What the agent learned — stored as markdown you own.",
  },
  tree: treeFromPages(memoryPages),
  fileContents: memoryPages,
  mock: memoryMock,
};
