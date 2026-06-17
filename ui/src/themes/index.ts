import type { KiwiThemeOverrides } from "../lib/kiwiTheme";

import kiwi from "./kiwi.json";
import neutral from "./neutral.json";
import ocean from "./ocean.json";
import sunset from "./sunset.json";
import forest from "./forest.json";

export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  light: Record<string, string>;
  dark: Record<string, string>;
  source?: "builtin" | "workspace";
}

export const BUILTIN_PRESET_SLUGS = ["kiwi", "neutral", "ocean", "sunset", "forest"] as const;

function withBuiltinMeta(
  data: Omit<ThemePreset, "id" | "source">,
  id: string,
): ThemePreset {
  return { ...data, id, source: "builtin" };
}

export const builtinPresets: ThemePreset[] = [
  withBuiltinMeta(kiwi, "kiwi"),
  withBuiltinMeta(neutral, "neutral"),
  withBuiltinMeta(ocean, "ocean"),
  withBuiltinMeta(sunset, "sunset"),
  withBuiltinMeta(forest, "forest"),
];

/** @deprecated use builtinPresets */
export const presets: ThemePreset[] = builtinPresets;

export function normalizePresetSlug(slug: string): string {
  const s = slug.trim().toLowerCase();
  return s === "default" ? "kiwi" : s;
}

export function presetSlug(preset: Pick<ThemePreset, "id" | "name">): string {
  return normalizePresetSlug(preset.id || preset.name);
}

export function presetToOverrides(preset: ThemePreset): KiwiThemeOverrides {
  return { light: preset.light, dark: preset.dark };
}

export function findPreset(
  name: string,
  list: ThemePreset[] = builtinPresets,
): ThemePreset | undefined {
  const slug = normalizePresetSlug(name);
  return list.find(
    (p) =>
      presetSlug(p) === slug ||
      p.name.toLowerCase() === name.trim().toLowerCase(),
  );
}

export type ThemePresetLoadError = { file: string; message: string };

export function mergeThemePresets(
  workspace: Array<{
    id: string;
    name: string;
    description?: string;
    light: Record<string, string>;
    dark: Record<string, string>;
  }>,
  allowedBuiltin?: string[],
): ThemePreset[] {
  const allowed = allowedBuiltin?.map(normalizePresetSlug);
  const builtins = allowed
    ? builtinPresets.filter((p) => allowed.includes(presetSlug(p)))
    : builtinPresets;
  const workspacePresets: ThemePreset[] = workspace.map((p) => ({
    id: normalizePresetSlug(p.id || p.name),
    name: p.name,
    description: p.description || "",
    light: p.light,
    dark: p.dark,
    source: "workspace",
  }));
  return [...builtins, ...workspacePresets];
}
