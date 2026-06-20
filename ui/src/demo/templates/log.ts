import { logMock, logPages } from "../content/log";
import { treeFromPages } from "../helpers";
import type { DemoTemplateConfig } from "../types";

export const logDemo: DemoTemplateConfig = {
  slug: "log",
  title: "Event Log",
  description: "Append-only audit trail with structured entries.",
  useCase: "Compliance & audit logs",
  themePreset: "Neutral",
  defaultTheme: "light",
  accentClass: "bg-stone-500",
  initialPath: "events/2026-06-20.md",
  initialView: "timeline",
  branding: {
    name: "Audit Trail",
    welcomeTitle: "Event log",
    welcomeMessage: "Human-readable, git-versioned audit entries.",
  },
  tree: treeFromPages(logPages),
  fileContents: logPages,
  mock: logMock,
};
