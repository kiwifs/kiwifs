export type UIFeatureKey =
  | "graph"
  | "bookmarks"
  | "kanban"
  | "canvas"
  | "whiteboard"
  | "timeline"
  | "bases"
  | "data_sources";

export const DEFAULT_UI_FEATURES: Record<UIFeatureKey, boolean> = {
  graph: true,
  bookmarks: true,
  kanban: true,
  canvas: true,
  whiteboard: true,
  timeline: true,
  bases: true,
  data_sources: true,
};

/** Maps /view/{name} path segments to feature keys. */
export const VIEW_ROUTE_ALIASES: Record<string, UIFeatureKey> = {
  graph: "graph",
  kanban: "kanban",
  canvas: "canvas",
  whiteboard: "whiteboard",
  timeline: "timeline",
  bases: "bases",
  data: "data_sources",
  data_sources: "data_sources",
};

export function resolveUIFeatures(
  features?: Partial<Record<UIFeatureKey, boolean>> | Record<string, boolean>,
): Record<UIFeatureKey, boolean> {
  return { ...DEFAULT_UI_FEATURES, ...(features as Partial<Record<UIFeatureKey, boolean>>) };
}

export function viewFeatureFromPathname(pathname: string): UIFeatureKey | null {
  if (!pathname.startsWith("/view/")) return null;
  const segment = pathname.slice("/view/".length).split("/")[0]?.toLowerCase();
  if (!segment) return null;
  return VIEW_ROUTE_ALIASES[segment] ?? null;
}

export function isViewRouteAllowed(
  pathname: string,
  features: Record<UIFeatureKey, boolean>,
): boolean {
  const feature = viewFeatureFromPathname(pathname);
  if (!feature) return true;
  return features[feature];
}
