import { adrMock, adrPages } from "../content/adr";
import { treeFromPages } from "../helpers";
import type { DemoTemplateConfig } from "../types";

export const adrDemo: DemoTemplateConfig = {
  slug: "adr",
  title: "Architecture Decisions",
  description: "Numbered ADRs with status lifecycle and supersession.",
  useCase: "Architecture decision records",
  themePreset: "Ocean",
  defaultTheme: "dark",
  accentClass: "bg-cyan-500",
  initialPath: "decisions/ADR-003-nats-streaming.md",
  initialView: "graph",
  branding: {
    name: "Platform ADRs",
    welcomeTitle: "Decision log",
    welcomeMessage: "Accepted, deprecated, and superseded — queryable by agents.",
  },
  tree: treeFromPages(adrPages),
  fileContents: adrPages,
  mock: adrMock,
};
