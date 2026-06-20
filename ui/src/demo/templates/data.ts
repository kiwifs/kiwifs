import { dataMock, dataPages } from "../content/data";
import { treeFromPages } from "../helpers";
import type { DemoTemplateConfig } from "../types";

export const dataDemo: DemoTemplateConfig = {
  slug: "data",
  title: "Structured Data",
  description: "Records, DQL queries, charts, and map views.",
  useCase: "Structured data & dashboards",
  themePreset: "Neutral",
  defaultTheme: "light",
  accentClass: "bg-zinc-500",
  initialPath: "dashboards/overview.md",
  initialView: "bases",
  startPage: "dashboards/overview.md",
  branding: {
    name: "Coffee Atlas",
    welcomeTitle: "Coffee shop records",
    welcomeMessage: "Structured markdown records with table, cards, list, and map layouts.",
  },
  tree: treeFromPages(dataPages),
  fileContents: dataPages,
  mock: dataMock,
};
