import { tasksMock, tasksPages } from "../content/tasks";
import { treeFromPages } from "../helpers";
import type { DemoTemplateConfig } from "../types";

export const tasksDemo: DemoTemplateConfig = {
  slug: "tasks",
  title: "Tasks",
  description: "Kanban boards, priorities, and sprint tracking.",
  useCase: "Agent task orchestration",
  themePreset: "Sunset",
  defaultTheme: "light",
  accentClass: "bg-orange-500",
  initialPath: "index.md",
  initialView: "kanban",
  startPage: "index.md",
  branding: {
    name: "Pinch — Sprint Board",
    welcomeTitle: "Recipe app sprint",
    welcomeMessage: "Building a recipe-sharing app — tasks as markdown.",
  },
  tree: treeFromPages(tasksPages),
  fileContents: tasksPages,
  mock: tasksMock,
};
