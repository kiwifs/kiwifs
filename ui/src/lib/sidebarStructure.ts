import { stripTrailingSlash } from "@kw/lib/paths";
import type { TreeEntry } from "@kw/lib/api";
import { DEFAULT_TREE_EXCLUDE_PATTERNS, isTreePathExcluded } from "@kw/lib/treeTransform";

export type SidebarSectionConfig = {
  label: string;
  paths: string[];
};

export type SidebarConfig = {
  pinned: string[];
  hidden: string[];
  sections: SidebarSectionConfig[];
};

export const DEFAULT_SIDEBAR_CONFIG: SidebarConfig = {
  pinned: [],
  hidden: [],
  sections: [],
};

/**
 * Reports whether a tree path falls under a configured prefix.
 * Prefixes may be files or folders, with or without a trailing slash.
 */
export function pathUnderPrefix(path: string, prefix: string): boolean {
  const clean = stripTrailingSlash(path);
  const cleanPrefix = stripTrailingSlash(prefix);
  if (!cleanPrefix) return true;
  if (clean === cleanPrefix) return true;
  return clean.startsWith(`${cleanPrefix}/`) || cleanPrefix.startsWith(`${clean}/`);
}

/** True when the path matches any configured prefix. */
export function pathUnderAnyPrefix(path: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => pathUnderPrefix(path, prefix));
}

/** Collects all section path prefixes for excluding from the main tree. */
export function collectSectionPrefixes(sections: SidebarSectionConfig[]): string[] {
  const out: string[] = [];
  for (const section of sections) {
    for (const prefix of section.paths) {
      if (prefix.trim()) out.push(prefix);
    }
  }
  return out;
}

/** Merges default tree exclusions with workspace hidden patterns. */
export function mergeSidebarExcludePatterns(hidden: string[]): string[] {
  if (!hidden.length) return [...DEFAULT_TREE_EXCLUDE_PATTERNS];
  return [...DEFAULT_TREE_EXCLUDE_PATTERNS, ...hidden];
}

/** Filters a page list by the sidebar search query (case-insensitive). */
export function filterPathsByQuery(paths: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return paths;
  return paths.filter((path) => path.toLowerCase().includes(q));
}

/**
 * Keeps only subtrees whose paths fall under any include prefix.
 * Once matched, the full subtree is retained.
 */
export function filterTreeForInclude(root: TreeEntry, includePrefixes: string[]): TreeEntry | null {
  if (!includePrefixes.length) return root;

  const path = stripTrailingSlash(root.path);
  if (path !== "" && pathUnderAnyPrefix(path, includePrefixes)) {
    return root;
  }

  if (!root.isDir) return null;

  const children = (root.children || [])
    .map((child) => filterTreeForInclude(child, includePrefixes))
    .filter((child): child is TreeEntry => child !== null);

  if (path === "") {
    return children.length ? { ...root, children } : null;
  }
  return children.length ? { ...root, children } : null;
}

/**
 * Removes paths claimed by pinned files or section prefixes from the main tree.
 */
export function filterTreeForExclude(
  root: TreeEntry,
  excludePrefixes: string[],
  excludePaths: string[],
): TreeEntry | null {
  const path = stripTrailingSlash(root.path);

  if (!root.isDir) {
    if (excludePaths.some((p) => stripTrailingSlash(p) === path)) return null;
    if (pathUnderAnyPrefix(path, excludePrefixes)) return null;
    return root;
  }

  if (path !== "" && pathUnderAnyPrefix(path, excludePrefixes)) {
    return null;
  }

  const children = (root.children || [])
    .map((child) => filterTreeForExclude(child, excludePrefixes, excludePaths))
    .filter((child): child is TreeEntry => child !== null);

  return { ...root, children };
}

/** Applies hidden-pattern exclusions while building the visible tree root. */
export function applySidebarHidden(root: TreeEntry | null, hiddenPatterns: string[]): TreeEntry | null {
  if (!root) return null;
  if (!hiddenPatterns.length) return root;

  const path = stripTrailingSlash(root.path);
  if (path !== "" && isTreePathExcluded(path, hiddenPatterns)) {
    return null;
  }

  if (!root.isDir) return root;

  const children = (root.children || [])
    .map((child) => applySidebarHidden(child, hiddenPatterns))
    .filter((child): child is TreeEntry => child !== null);

  return { ...root, children };
}
