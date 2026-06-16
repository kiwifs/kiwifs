import type { TreeEntry } from "./api";

export type StartPageMode = "welcome" | "recent" | "dashboard" | "path";

export type ResolvedStartPage =
  | { mode: "welcome" }
  | { mode: "recent" }
  | { mode: "dashboard"; path: string }
  | { mode: "path"; path: string };

/** Map [ui].start_page config to a concrete landing mode. */
export function resolveStartPage(raw: string | undefined | null): ResolvedStartPage {
  const value = (raw ?? "welcome").trim();
  if (!value || value === "welcome") {
    return { mode: "welcome" };
  }
  if (value === "recent") {
    return { mode: "recent" };
  }
  if (value === "dashboard") {
    return { mode: "dashboard", path: "dashboard.md" };
  }
  return { mode: "path", path: value };
}

const DASHBOARD_CANDIDATES = ["dashboard.md", "pages/dashboard.md", "index.md"];

/** Pick the first dashboard candidate that exists in the tree. */
export function resolveDashboardPath(tree: TreeEntry | null): string {
  for (const candidate of DASHBOARD_CANDIDATES) {
    if (pathExistsInTree(tree, candidate)) {
      return candidate;
    }
  }
  return "dashboard.md";
}

function pathExistsInTree(tree: TreeEntry | null, target: string): boolean {
  if (!tree) return false;
  const clean = target.replace(/\/+$/, "");
  for (const entry of walkTree(tree)) {
    if (!entry.isDir && entry.path.replace(/\/+$/, "") === clean) {
      return true;
    }
  }
  return false;
}

function* walkTree(node: TreeEntry): Generator<TreeEntry> {
  yield node;
  for (const child of node.children ?? []) {
    yield* walkTree(child);
  }
}

/** True when the URL encodes an explicit page path (deep link). */
export function hasDeepLinkPath(): boolean {
  if (typeof window === "undefined") return false;
  const pathname = window.location.pathname;
  const hash = window.location.hash.replace(/^#\/?/, "");
  if (pathname.startsWith("/page/")) return true;
  return Boolean(hash);
}

/** Start page applies only on root navigation without a deep link. */
export function shouldApplyStartPage(
  activePath: string | null,
  deepLink: boolean,
): boolean {
  return activePath === null && !deepLink;
}
