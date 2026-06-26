import type { UIFeatureKey } from "./uiFeatures";

/** Built-in header view buttons (excludes New page + theme toggle). */
export const TOOLBAR_BUILTIN_VIEW_IDS = [
  "graph",
  "bookmarks",
  "bases",
  "canvas",
  "whiteboard",
  "timeline",
  "kanban",
  "data",
] as const;

export type ToolbarBuiltinViewId = (typeof TOOLBAR_BUILTIN_VIEW_IDS)[number];

export const DEFAULT_TOOLBAR_VIEWS: ToolbarBuiltinViewId[] = [
  ...TOOLBAR_BUILTIN_VIEW_IDS,
];

/** Maps toolbar view ids to [ui.features] keys. */
export const TOOLBAR_VIEW_FEATURE: Record<ToolbarBuiltinViewId, UIFeatureKey> = {
  graph: "graph",
  bookmarks: "bookmarks",
  bases: "bases",
  canvas: "canvas",
  whiteboard: "whiteboard",
  timeline: "timeline",
  kanban: "kanban",
  data: "data_sources",
};

const ALLOWED = new Set<string>([
  ...TOOLBAR_BUILTIN_VIEW_IDS,
  "data_sources",
  "bookmarks",
]);

function normalizeToolbarViewId(id: string): ToolbarBuiltinViewId | null {
  if (id === "data_sources") return "data";
  if (ALLOWED.has(id)) return id as ToolbarBuiltinViewId;
  return null;
}

/**
 * Filter and reorder built-in toolbar views.
 * - `null` / `undefined` → default order (all views)
 * - `[]` → hide all built-in view buttons
 */
export function composeToolbarViews(
  configured?: readonly string[] | null,
): ToolbarBuiltinViewId[] {
  if (configured == null) {
    return [...DEFAULT_TOOLBAR_VIEWS];
  }

  const seen = new Set<string>();
  const result: ToolbarBuiltinViewId[] = [];
  for (const raw of configured) {
    const id = normalizeToolbarViewId(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

/** Host embed config overrides server TOML when set. */
export function resolveToolbarViews(
  serverViews?: readonly string[] | null,
  hostViews?: readonly string[] | null,
): ToolbarBuiltinViewId[] {
  if (hostViews != null) {
    return composeToolbarViews(hostViews);
  }
  if (serverViews != null) {
    return composeToolbarViews(serverViews);
  }
  return composeToolbarViews(null);
}

/** Keep only views whose feature flag is enabled. */
export function filterToolbarViewsByFeatures(
  views: readonly ToolbarBuiltinViewId[],
  features: Record<UIFeatureKey, boolean>,
): ToolbarBuiltinViewId[] {
  return views.filter((id) => features[TOOLBAR_VIEW_FEATURE[id]]);
}
