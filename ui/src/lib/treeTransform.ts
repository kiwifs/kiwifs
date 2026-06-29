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
  /** Safe lint summary shown when markdown frontmatter blocks ordering writes. */
  frontmatterError?: string;
  children?: FlatNode[];
};

type TransformOpts = {
  compactFolders: boolean;
  sortMode: TreeSortMode;
  enableFileNesting: boolean;
  excludePatterns: string[];
};

const DEFAULT_EXCLUDE = ["**/.gitkeep", "**/.DS_Store"];

/**
 * Reports whether the row is the internal Kiwi configuration folder.
 *
 * @param name - Entry name from the server tree.
 * @returns True for the `.kiwi` folder.
 */
const isKiwiConfig = (name: string): boolean => name === ".kiwi";

/**
 * Reports whether a path should keep its full folder form in the UI.
 *
 * @param path - Tree path from the server response.
 * @returns True when compacting would hide a protected `.kiwi` segment.
 */
const isProtectedPath = (path: string): boolean => {
  const clean = stripTrailingSlash(path);
  if (clean === ".kiwi") {
    return true;
  }
  return clean.startsWith(".kiwi/");
};

/**
 * Matches a path against the simple glob syntax used by tree exclusions.
 *
 * @param path - Slash-separated path without a trailing slash.
 * @param pattern - Exclusion pattern from user settings.
 * @returns True when the path is excluded by the pattern.
 */
const globMatch = (path: string, pattern: string): boolean => {
  const cleanPattern = pattern.trim();
  if (!cleanPattern) {
    return false;
  }

  if (cleanPattern.startsWith("**/")) {
    const suffix = cleanPattern.slice(3);
    if (path === suffix) {
      return true;
    }
    if (path.endsWith("/" + suffix)) {
      return true;
    }
    return path.split("/").pop() === suffix;
  }

  if (cleanPattern.includes("*")) {
    const escaped = cleanPattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    const regexSource = escaped.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*");
    return new RegExp("^" + regexSource + "$").test(path);
  }

  if (path === cleanPattern) {
    return true;
  }
  return path.endsWith("/" + cleanPattern);
};

/**
 * Reports whether a tree path should be hidden or dimmed by exclude patterns.
 *
 * @param path - Tree path from the server response.
 * @param patterns - User configured exclusion patterns.
 * @returns True when the path or basename matches an exclusion.
 */
export const isTreePathExcluded = (path: string, patterns: string[] = DEFAULT_EXCLUDE): boolean => {
  const clean = stripTrailingSlash(path);
  const name = clean.split("/").pop() || "";
  return patterns.some((pattern) => globMatch(clean, pattern) || globMatch(name, pattern));
};

/**
 * Orders the internal `.kiwi` folder before normal content.
 *
 * @param entry - Tree entry being compared.
 * @returns Numeric sort bucket.
 */
const kiwiSortBucket = (entry: TreeEntry): number => {
  if (isKiwiConfig(entry.name)) {
    return 0;
  }
  return 1;
};

/**
 * Sorts directories ahead of files only when type sorting is active.
 *
 * @param a - Left tree entry.
 * @param b - Right tree entry.
 * @param mode - Current tree sort mode.
 * @returns Comparator result for type grouping.
 */
const compareEntryType = (a: TreeEntry, b: TreeEntry, mode: TreeSortMode): number => {
  if (mode !== "type") {
    return 0;
  }
  if (a.isDir === b.isDir) {
    return 0;
  }
  if (a.isDir) {
    return -1;
  }
  return 1;
};

/**
 * Compares server entries while preserving explicit order metadata first.
 *
 * @param a - Left tree entry.
 * @param b - Right tree entry.
 * @param mode - Current tree sort mode.
 * @returns Comparator result used by stable tree sorting.
 */
const compareEntries = (a: TreeEntry, b: TreeEntry, mode: TreeSortMode): number => {
  const kiwiDelta = kiwiSortBucket(a) - kiwiSortBucket(b);
  if (kiwiDelta !== 0) {
    return kiwiDelta;
  }

  const typeDelta = compareEntryType(a, b, mode);
  if (typeDelta !== 0) {
    return typeDelta;
  }
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
};

/**
 * Converts a file entry into the flat row contract consumed by the tree UI.
 *
 * @param entry - Server tree entry.
 * @param opts - Active tree transformation options.
 * @param extra - Display-only row fields for nested virtual rows.
 * @returns Flat tree row.
 */
const fileToFlat = (entry: TreeEntry, opts: TransformOpts, extra: Partial<FlatNode> = {}): FlatNode => {
  const path = stripTrailingSlash(entry.path);
  return {
    id: path,
    name: entry.name,
    isDir: false,
    excluded: isTreePathExcluded(path, opts.excludePatterns),
    frontmatterError: entry.frontmatterError,
    ...extra,
  };
};

/**
 * Returns a sorted copy of server children without mutating API data.
 *
 * @param children - Server child entries.
 * @param mode - Current tree sort mode.
 * @returns Sorted entry copy.
 */
const sortEntries = (children: TreeEntry[], mode: TreeSortMode): TreeEntry[] => {
  return [...children].sort((a, b) => compareEntries(a, b, mode));
};

/**
 * Compares flat rows after file nesting creates virtual directory rows.
 *
 * @param a - Left flat row.
 * @param b - Right flat row.
 * @returns Comparator result for visible nested rows.
 */
const compareFlatRows = (a: FlatNode, b: FlatNode): number => {
  if (a.excluded !== b.excluded) {
    if (a.excluded) {
      return 1;
    }
    return -1;
  }
  if (a.isDir !== b.isDir) {
    if (a.isDir) {
      return -1;
    }
    return 1;
  }
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
};

/**
 * Reports whether a non-markdown file belongs under a markdown virtual folder.
 *
 * @param file - Candidate asset file.
 * @param markdown - Markdown page that may own the asset.
 * @param used - Paths already claimed by previous virtual folders.
 * @returns True when the file stem matches the markdown stem.
 */
const isNestedAssetForMarkdown = (file: TreeEntry, markdown: TreeEntry, used: Set<string>): boolean => {
  if (file.path === markdown.path) {
    return false;
  }
  if (used.has(file.path)) {
    return false;
  }
  if (file.isDir) {
    return false;
  }
  if (isMarkdown(file.path)) {
    return false;
  }
  const mdStem = stem(markdown.name);
  const base = file.name.replace(/\.[^.]+$/i, "");
  if (base === mdStem) {
    return true;
  }
  return base.startsWith(`${mdStem}.`);
};

/**
 * Creates a normal markdown row or a virtual row with same-stem assets nested.
 *
 * @param markdown - Markdown file being transformed.
 * @param files - All file entries in the same folder.
 * @param opts - Active tree transformation options.
 * @param used - Mutable set scoped to this transform pass for claimed paths.
 * @returns Flat row representing the markdown page.
 */
const markdownToNestedFlat = (markdown: TreeEntry, files: TreeEntry[], opts: TransformOpts, used: Set<string>): FlatNode => {
  const nestedFiles = files.filter((file) => isNestedAssetForMarkdown(file, markdown, used));
  nestedFiles.forEach((file) => used.add(file.path));
  used.add(markdown.path);

  if (nestedFiles.length === 0) {
    return fileToFlat(markdown, opts);
  }

  return {
    id: stripTrailingSlash(markdown.path),
    name: markdown.name,
    isDir: true,
    virtualDir: true,
    excluded: isTreePathExcluded(markdown.path, opts.excludePatterns),
    frontmatterError: markdown.frontmatterError,
    children: nestedFiles.map((file) => fileToFlat(file, opts, { isNested: true })),
  };
};

/**
 * Nests same-stem assets under markdown pages in VS Code file-nesting style.
 *
 * @param entries - Server entries from one directory.
 * @param opts - Active tree transformation options.
 * @returns Flat rows with virtual markdown asset groups.
 */
const applyFileNesting = (entries: TreeEntry[], opts: TransformOpts): FlatNode[] => {
  const sorted = sortEntries(entries, opts.sortMode);
  const files = sorted.filter((entry) => !entry.isDir);
  const dirs = sorted.filter((entry) => entry.isDir);
  const used = new Set<string>();
  const dirRows = dirs.map((dir) => compactEntry(dir, opts));
  const markdownRows = files
    .filter((file) => isMarkdown(file.path))
    .filter((file) => !used.has(file.path))
    .map((file) => markdownToNestedFlat(file, files, opts, used));
  const remainingRows = files
    .filter((file) => !used.has(file.path))
    .map((file) => fileToFlat(file, opts));

  return [...dirRows, ...markdownRows, ...remainingRows].sort(compareFlatRows);
};

/**
 * Compacts single-child directory chains into one display row when safe.
 *
 * @param entry - Directory entry from the server tree.
 * @param opts - Active tree transformation options.
 * @returns Flat directory row.
 */
const compactEntry = (entry: TreeEntry, opts: TransformOpts): FlatNode => {
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

  if (chain.length === 1) {
    return dirToFlat(entry, opts);
  }

  const leafPath = stripTrailingSlash(leaf.path);
  if (!leaf.children) {
    return {
      id: leafPath,
      name: leaf.name,
      displayName: chain.map((item) => item.name).join(" › "),
      isDir: true,
      excluded: isTreePathExcluded(leafPath, opts.excludePatterns),
    };
  }

  return {
    id: leafPath,
    name: leaf.name,
    displayName: chain.map((item) => item.name).join(" › "),
    isDir: true,
    excluded: isTreePathExcluded(leafPath, opts.excludePatterns),
    children: transformChildren(leaf.children, opts),
  };
};

/**
 * Converts a directory entry into a flat tree row.
 *
 * @param entry - Directory entry from the server tree.
 * @param opts - Active tree transformation options.
 * @returns Flat directory row.
 */
const dirToFlat = (entry: TreeEntry, opts: TransformOpts): FlatNode => {
  const path = stripTrailingSlash(entry.path);
  if (!entry.children) {
    return {
      id: path,
      name: entry.name,
      isDir: true,
      excluded: isTreePathExcluded(path, opts.excludePatterns),
    };
  }

  return {
    id: path,
    name: entry.name,
    isDir: true,
    excluded: isTreePathExcluded(path, opts.excludePatterns),
    children: transformChildren(entry.children, opts),
  };
};

/**
 * Chooses the children used for nesting while preserving a fallback for hidden-only folders.
 *
 * @param children - Server child entries.
 * @param opts - Active tree transformation options.
 * @returns Child entries used by the nesting transform.
 */
const nestingSourceChildren = (children: TreeEntry[], opts: TransformOpts): TreeEntry[] => {
  const visible = children.filter((child) => !isTreePathExcluded(stripTrailingSlash(child.path), opts.excludePatterns));
  if (visible.length > 0) {
    return visible;
  }
  return children;
};

/**
 * Converts server children into flat rows according to the active tree options.
 *
 * @param children - Server child entries.
 * @param opts - Active tree transformation options.
 * @returns Flat rows for the UI tree widget.
 */
const transformChildren = (children: TreeEntry[], opts: TransformOpts): FlatNode[] => {
  if (opts.enableFileNesting) {
    return applyFileNesting(nestingSourceChildren(children, opts), opts);
  }
  return sortEntries(children, opts.sortMode).map((child) => {
    if (child.isDir) {
      return compactEntry(child, opts);
    }
    return fileToFlat(child, opts);
  });
};

/**
 * Resolves partial caller options into the complete transform option set.
 *
 * @param opts - Caller-provided tree options.
 * @returns Full option set with defaults filled in.
 */
const resolveTransformOpts = (opts: Partial<TransformOpts>): TransformOpts => ({
  compactFolders: opts.compactFolders ?? true,
  sortMode: opts.sortMode ?? "name",
  enableFileNesting: opts.enableFileNesting ?? true,
  excludePatterns: opts.excludePatterns ?? DEFAULT_EXCLUDE,
});

/**
 * Builds the flat tree consumed by the React tree widget.
 *
 * @param root - Root server tree entry.
 * @param opts - Optional tree display options.
 * @returns Top-level flat rows.
 */
export const buildFlatTree = (root: TreeEntry, opts: Partial<TransformOpts> = {}): FlatNode[] => {
  const full = resolveTransformOpts(opts);
  return sortEntries(root.children || [], full.sortMode).map((child) => {
    if (child.isDir) {
      return compactEntry(child, full);
    }
    return fileToFlat(child, full);
  });
};

/**
 * Collects real folder ids so auto-reveal can expand a path recursively.
 *
 * @param node - Flat row to inspect.
 * @param out - Accumulated folder ids.
 * @returns The same accumulator containing all real descendant folder ids.
 */
export const collectFolderPaths = (node: FlatNode, out: string[] = []): string[] => {
  if (node.isDir && !node.virtualDir) {
    out.push(node.id);
  }
  for (const child of node.children || []) {
    collectFolderPaths(child, out);
  }
  return out;
};

/**
 * Opens every real folder below a target row in the tree widget.
 *
 * @param tree - Tree widget imperative handle.
 * @param node - Flat row to expand recursively.
 * @returns Nothing.
 */
export const openFolderRecursive = (tree: { open: (id: string) => void } | null, node: FlatNode): void => {
  if (!tree) {
    return;
  }
  if (!node.isDir) {
    return;
  }
  tree.open(node.id);
  for (const child of node.children || []) {
    if (child.isDir) {
      openFolderRecursive(tree, child);
    }
  }
};

export { DEFAULT_EXCLUDE as DEFAULT_TREE_EXCLUDE_PATTERNS };
