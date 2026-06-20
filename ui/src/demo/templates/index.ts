import { adrDemo } from "./adr";
import { cmsDemo } from "./cms";
import { dataDemo } from "./data";
import { kbDemo } from "./kb";
import { logDemo } from "./log";
import { memoryDemo } from "./memory";
import { promptDemo } from "./prompt";
import { researchDemo } from "./research";
import { runbookDemo } from "./runbook";
import { tasksDemo } from "./tasks";
import { wikiDemo } from "./wiki";
import type { DemoTemplateConfig } from "../types";

export const demoTemplates: DemoTemplateConfig[] = [
  kbDemo,
  wikiDemo,
  tasksDemo,
  dataDemo,
  cmsDemo,
  memoryDemo,
  runbookDemo,
  adrDemo,
  promptDemo,
  researchDemo,
  logDemo,
];

export const demoTemplateBySlug = Object.fromEntries(
  demoTemplates.map((t) => [t.slug, t]),
) as Record<string, DemoTemplateConfig>;

export const demoSlugs = demoTemplates.map((t) => t.slug);

export function getDemoSlugFromPath(): string | null {
  const segments = window.location.pathname.split("/").filter(Boolean);
  if (segments.length !== 1) return null;
  const slug = segments[0];
  return slug in demoTemplateBySlug ? slug : null;
}

export function demoBasePath(slug: string): string {
  return `/${slug}/`;
}
