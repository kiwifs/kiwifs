import type { TreeEntry } from "./api";
import { isMarkdown, stripTrailingSlash } from "./paths";

export type OptimisticTreeMoveArgs = {
  dragIds: string[];
  parentId: string | null;
  index: number;
};

type RemoveResult = {
  children: TreeEntry[];
  removed: TreeEntry | null;
};

/**
 * Normalizes a server tree row path into the stable drag-and-drop id.
 *
 * @param entry - Tree row from the API response.
 * @returns Path without a trailing slash.
 */
const entryId = (entry: TreeEntry): string => stripTrailingSlash(entry.path);

/**
 * Deep-copies a tree row so optimistic updates never mutate cached API data.
 *
 * @param entry - Tree row to copy.
 * @returns A new tree row with cloned descendants.
 */
const cloneEntry = (entry: TreeEntry): TreeEntry => {
  if (!entry.children) {
    return { ...entry };
  }
  return { ...entry, children: entry.children.map(cloneEntry) };
};

/**
 * Extracts the display filename from a path that may end with a slash.
 *
 * @param path - File or directory path from the tree API.
 * @returns Last path segment used as the moved row name.
 */
const fileName = (path: string): string => {
  const cleanPath = stripTrailingSlash(path);
  const lastSegment = cleanPath.split("/").pop();
  if (!lastSegment) {
    return cleanPath;
  }
  return lastSegment;
};

/**
 * Joins a parent id and row name while preserving directory trailing slashes.
 *
 * @param parentId - Destination folder id, or null for the root.
 * @param name - File or directory basename.
 * @param isDir - Whether the moved row is a directory.
 * @returns New tree path in API format.
 */
const childPath = (parentId: string | null, name: string, isDir: boolean): string => {
  let cleanParent = "";
  if (parentId != null) {
    cleanParent = stripTrailingSlash(parentId);
  }

  let path = name;
  if (cleanParent !== "") {
    path = `${cleanParent}/${name}`;
  }

  if (isDir) {
    return `${path}/`;
  }
  return path;
};

/**
 * Rewrites a moved subtree so every descendant keeps a path under its new root.
 *
 * @param entry - Removed tree row to place at the destination.
 * @param parentId - Destination folder id, or null for the root.
 * @returns Copied tree row with recalculated paths.
 */
const retargetMovedEntry = (entry: TreeEntry, parentId: string | null): TreeEntry => {
  const name = fileName(entry.path);
  const path = childPath(parentId, name, entry.isDir);
  const cleanPath = stripTrailingSlash(path);
  if (!entry.children) {
    return { ...entry, path, name };
  }
  return {
    ...entry,
    path,
    name,
    children: entry.children.map((child) => retargetMovedEntry(child, cleanPath)),
  };
};

/**
 * Removes the first matching row from a tree while preserving sibling order.
 *
 * @param children - Current children for a tree level.
 * @param id - Drag id to remove.
 * @returns A copied child list and the removed row when found.
 */
const removeEntry = (children: TreeEntry[], id: string): RemoveResult => {
  return children.reduce<RemoveResult>((result, child) => {
    if (result.removed) {
      return { children: [...result.children, child], removed: result.removed };
    }

    if (entryId(child) === id) {
      return { children: result.children, removed: child };
    }

    if (!child.children) {
      return { children: [...result.children, child], removed: null };
    }

    const nested = removeEntry(child.children, id);
    if (!nested.removed) {
      return { children: [...result.children, child], removed: null };
    }

    return {
      children: [...result.children, { ...child, children: nested.children }],
      removed: nested.removed,
    };
  }, { children: [], removed: null });
};

/**
 * Reports whether a row should receive a visual sibling order number.
 *
 * @param child - Tree row in the destination sibling list.
 * @returns True for directories and markdown files.
 */
const isOrderableSibling = (child: TreeEntry): boolean => {
  if (child.isDir) {
    return true;
  }
  return isMarkdown(child.path);
};

/**
 * Reassigns one-based order values to directories and markdown files only.
 *
 * @param children - Destination sibling list after insertion.
 * @returns A copied sibling list with updated order fields where applicable.
 */
const renumberOrderableSiblings = (children: TreeEntry[]): TreeEntry[] => {
  return children.reduce<{ rows: TreeEntry[]; order: number }>((state, child) => {
    if (!isOrderableSibling(child)) {
      return { rows: [...state.rows, child], order: state.order };
    }
    return { rows: [...state.rows, { ...child, order: state.order }], order: state.order + 1 };
  }, { rows: [], order: 1 }).rows;
};

/**
 * Inserts a row into an immutable sibling list at a clamped index.
 *
 * @param children - Destination siblings.
 * @param parentId - Destination folder id, or null for the root.
 * @param index - Requested insertion index from the tree widget.
 * @param entry - Removed row to insert.
 * @returns New sibling list with recalculated order values.
 */
const insertAtIndex = (children: TreeEntry[], parentId: string | null, index: number, entry: TreeEntry): TreeEntry[] => {
  const safeIndex = Math.max(0, Math.min(index, children.length));
  const moved = retargetMovedEntry(entry, parentId);
  return renumberOrderableSiblings([
    ...children.slice(0, safeIndex),
    moved,
    ...children.slice(safeIndex),
  ]);
};

/**
 * Finds the destination folder and inserts the moved row under it.
 *
 * @param children - Current sibling list for this tree level.
 * @param parentId - Destination folder id, or null for the root.
 * @param index - Requested insertion index from the tree widget.
 * @param entry - Removed row to insert.
 * @returns New tree level with the moved row inserted.
 */
const insertEntry = (children: TreeEntry[], parentId: string | null, index: number, entry: TreeEntry): TreeEntry[] => {
  if (parentId == null) {
    return insertAtIndex(children, null, index, entry);
  }

  const cleanParent = stripTrailingSlash(parentId);
  return children.map((child) => {
    if (entryId(child) === cleanParent) {
      return { ...child, children: insertAtIndex(child.children || [], parentId, index, entry) };
    }

    if (!child.children) {
      return child;
    }

    return { ...child, children: insertEntry(child.children, parentId, index, entry) };
  });
};

/**
 * Applies a drag-and-drop move locally before the server persists sibling order.
 *
 * @param root - Current tree API response.
 * @param args - Drag ids, destination parent, and destination index.
 * @returns Optimistically reordered tree, or the original tree when no move applies.
 */
export const applyOptimisticTreeMove = (root: TreeEntry, args: OptimisticTreeMoveArgs): TreeEntry => {
  const dragId = args.dragIds[0];
  if (!dragId) {
    return root;
  }

  const cloned = cloneEntry(root);
  const result = removeEntry(cloned.children || [], stripTrailingSlash(dragId));
  if (!result.removed) {
    return root;
  }

  return {
    ...cloned,
    children: insertEntry(result.children, args.parentId, args.index, result.removed),
  };
};
