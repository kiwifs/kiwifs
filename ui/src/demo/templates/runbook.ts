import { runbookMock, runbookPages } from "../content/runbook";
import { treeFromPages } from "../helpers";
import type { DemoTemplateConfig } from "../types";

export const runbookDemo: DemoTemplateConfig = {
  slug: "runbook",
  title: "Runbooks",
  description: "Procedures, incidents, and postmortems.",
  useCase: "DevOps runbooks",
  themePreset: "Neutral",
  defaultTheme: "dark",
  accentClass: "bg-zinc-400",
  initialPath: "procedures/deploy.md",
  branding: {
    name: "Platform Runbooks",
    welcomeTitle: "Ops procedures",
    welcomeMessage: "Runbooks agents can execute and humans can review.",
  },
  tree: treeFromPages(runbookPages),
  fileContents: runbookPages,
  mock: runbookMock,
};
