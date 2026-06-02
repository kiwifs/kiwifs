import { isMarkdown, stem, stripTrailingSlash } from "@kw/lib/paths";
import type { TreeEntry } from "@kw/lib/api";

export type TreeSortMode = "name" | "type";

export type FlatNode = {
  id: string;
  name: string;
  /** VS Code-style compact label, e.g. `docs › api` */
  displayName?: string;
  isDir: boolean;
  /** Synthetic folder row (markdown grouping attachments) */
  virtualDir?: boolean;
  /** Nested under a markdown page (display only) */
  isNested?: boolean;
  /** Matched by exclude pattern — dimmed in UI */
  excluded?: boolean;
  order?: number;
  frontmatterError?: string;
  children?: FlatNode[];
};

const DEFAULT_EXCLUDE = ["**/.gitkeep", "**/.DS_Store"];

function isKiwiConfig(name: string): boolean {
  return name === ".kiwi";
}

function isProtectedPath(path: string): boolean {
  const clean = stripTrailingSlash(path);
  return clean === ".kiwi" || clean.startsWith(".kiwi/");
}

function globMatch(path: string, pattern: string): boolean {
  const p = pattern.trim();
  if (!p) return false;
  if (p.startsWith("**/")) {
    const suffix = p.slice(3);
    return path === suffix || path.endsWith("/" + suffix) || path.split("/").pop() === suffix;
  }
  if (p.includes("*")) {
    const re = new RegExp("^" + p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$");
    return re.test(path);
  }
  return path === p || path.endsWith("/" + p);
}

export function isTreePathExcluded(path: string, patterns: string[] = DEFAULT_EXCLUDE): boolean {
  const clean = stripTrailingSlash(path);
  return patterns.some((pat) => globMatch(clean, pat) || globMatch(clean.split("/").pop() || "", pat));
}

function compareEntries(a: TreeEntry, b: TreeEntry, mode: TreeSortMode): number {
  const aKiwi = isKiwiConfig(a.name) ? 0 : 1;
  const bKiwi = isKiwiConfig(b.name) ? 0 : 1;
  if (aKiwi !== bKiwi) return aKiwi - bKiwi;

  if (a.order != null && b.order != null && a.order !== b.order) return a.order - b.order;
  if (a.order != null && b.order == null) return -1;
  if (a.order == null && b.order != null) return 1;

  if (mode === "type") {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
  }
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

function fileToFlat(entry: TreeEntry, opts: TransformOpts, extra?: Partial<FlatNode>): FlatNode {
  const path = stripTrailingSlash(entry.path);
  return {
    id: path,
    name: entry.name,
    isDir: false,
    excluded: isTreePathExcluded(path, opts.excludePatterns),
    order: entry.order,
    frontmatterError: entry.frontmatterError,
    ...extra,
  };
}

type TransformOpts = {
  compactFolders: boolean;
  sortMode: TreeSortMode;
  enableFileNesting: boolean;
  excludePatterns: string[];
};

function sortEntries(children: TreeEntry[], mode: TreeSortMode): TreeEntry[] {
  return [...children].sort((a, b) => compareEntries(a, b, mode));
}

/** Nest same-stem assets under markdown pages (VS Code file-nesting style). */
function applyFileNesting(entries: TreeEntry[], opts: TransformOpts): FlatNode[] {
  const sorted = sortEntries(entries, opts.sortMode);
  const files = sorted.filter((e) => !e.isDir);
  const dirs = sorted.filter((e) => e.isDir);

  const used = new Set<string>();
  const out: FlatNode[] = dirs.map((d) => compactEntry(d, opts));

  for (const md of files) {
    if (!isMarkdown(md.path) || used.has(md.path)) continue;
    const mdStem = stem(md.name);
    const nestedFiles = files.filter((f) => {
      if (f.path === md.path || used.has(f.path) || f.isDir) return false;
      if (isMarkdown(f.path)) return false;
      const base = f.name.replace(/\.[^.]+$/i, "");
      return base === mdStem || base.startsWith(`${mdStem}.`);
    });

    nestedFiles.forEach((f) => used.add(f.path));
    used.add(md.path);

    if (nestedFiles.length === 0) {
      out.push(fileToFlat(md, opts));
      continue;
    }

    out.push({
      id: stripTrailingSlash(md.path),
      name: md.name,
      isDir: true,
      virtualDir: true,
      excluded: isTreePathExcluded(md.path, opts.excludePatterns),
      order: md.order,
      frontmatterError: md.frontmatterError,
      children: nestedFiles.map((f) =>
        fileToFlat(f, opts, { isNested: true }),
      ),
    });
  }

  for (const f of files) {
    if (used.has(f.path)) continue;
    out.push(fileToFlat(f, opts));
  }

  return out.sort((a, b) => {
    if (a.excluded !== b.excluded) return a.excluded ? 1 : -1;
    if (a.order != null && b.order != null && a.order !== b.order) return a.order - b.order;
    if (a.order != null && b.order == null) return -1;
    if (a.order == null && b.order != null) return 1;
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

function compactEntry(entry: TreeEntry, opts: TransformOpts): FlatNode {
  const path = stripTrailingSlash(entry.path);
  if (isKiwiConfig(entry.name) || isProtectedPath(path) || !opts.compactFolders) {
    return dirToFlat(entry, opts);
  }

  const chain: TreeEntry[] = [entry];
  let leaf = entry;
  while (
    leaf.children?.length === 1 &&
    leaf.children[0].isDir &&
    !isKiwiConfig(leaf.children[0].name) &&
    !isProtectedPath(stripTrailingSlash(leaf.children[0].path))
  ) {
    leaf = leaf.children[0];
    chain.push(leaf);
  }

  if (chain.length === 1) return dirToFlat(entry, opts);

  const leafPath = stripTrailingSlash(leaf.path);
  const children = leaf.children
    ? transformChildren(leaf.children, opts)
    : undefined;

  return {
    id: leafPath,
    name: leaf.name,
    displayName: chain.map((c) => c.name).join(" › "),
    isDir: true,
    excluded: isTreePathExcluded(leafPath, opts.excludePatterns),
    children,
  };
}

function dirToFlat(entry: TreeEntry, opts: TransformOpts): FlatNode {
  const path = stripTrailingSlash(entry.path);
  return {
    id: path,
    name: entry.name,
    isDir: true,
    excluded: isTreePathExcluded(path, opts.excludePatterns),
    order: entry.order,
    children: entry.children ? transformChildren(entry.children, opts) : undefined,
  };
}

function transformChildren(children: TreeEntry[], opts: TransformOpts): FlatNode[] {
  const visible = children.filter((c) => !isTreePathExcluded(stripTrailingSlash(c.path), opts.excludePatterns));
  if (opts.enableFileNesting) {
    return applyFileNesting(visible.length ? visible : children, opts);
  }
  return sortEntries(children, opts.sortMode).map((c) =>
    c.isDir ? compactEntry(c, opts) : fileToFlat(c, opts),
  );
}

export function buildFlatTree(
  root: TreeEntry,
  opts: Partial<TransformOpts> = {},
): FlatNode[] {
  const full: TransformOpts = {
    compactFolders: opts.compactFolders ?? true,
    sortMode: opts.sortMode ?? "name",
    enableFileNesting: opts.enableFileNesting ?? true,
    excludePatterns: opts.excludePatterns ?? DEFAULT_EXCLUDE,
  };
  return sortEntries(root.children || [], full.sortMode).map((c) =>
    c.isDir ? compactEntry(c, full) : fileToFlat(c, full),
  );
}

export function collectFolderPaths(node: FlatNode, out: string[] = []): string[] {
  if (node.isDir && !node.virtualDir) out.push(node.id);
  for (const c of node.children || []) collectFolderPaths(c, out);
  return out;
}

export function openFolderRecursive(
  tree: { open: (id: string) => void } | null,
  node: FlatNode,
): void {
  if (!tree || !node.isDir) return;
  tree.open(node.id);
  for (const c of node.children || []) {
    if (c.isDir) openFolderRecursive(tree, c);
  }
}

export { DEFAULT_EXCLUDE as DEFAULT_TREE_EXCLUDE_PATTERNS };
