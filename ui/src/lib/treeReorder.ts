import type { TreeEntry } from "./api";
import { isMarkdown, stripTrailingSlash } from "./paths";

export type OptimisticTreeMoveArgs = {
  dragIds: string[];
  parentId: string | null;
  index: number;
};

function entryId(entry: TreeEntry): string {
  return stripTrailingSlash(entry.path);
}

function cloneEntry(entry: TreeEntry): TreeEntry {
  return {
    ...entry,
    children: entry.children?.map(cloneEntry),
  };
}

function fileName(path: string): string {
  return stripTrailingSlash(path).split("/").pop() || stripTrailingSlash(path);
}

function childPath(parentId: string | null, name: string, isDir: boolean): string {
  const path = parentId ? `${stripTrailingSlash(parentId)}/${name}` : name;
  return isDir ? `${path}/` : path;
}

function retargetMovedEntry(entry: TreeEntry, parentId: string | null): TreeEntry {
  const name = fileName(entry.path);
  const path = childPath(parentId, name, entry.isDir);
  const cleanPath = stripTrailingSlash(path);
  return {
    ...entry,
    path,
    name,
    children: entry.children?.map((child) => retargetMovedEntry(child, cleanPath)),
  };
}

function removeEntry(children: TreeEntry[], id: string): { children: TreeEntry[]; removed: TreeEntry | null } {
  const next: TreeEntry[] = [];
  let removed: TreeEntry | null = null;

  for (const child of children) {
    if (!removed && entryId(child) === id) {
      removed = child;
      continue;
    }

    if (!removed && child.children) {
      const result = removeEntry(child.children, id);
      removed = result.removed;
      next.push({ ...child, children: result.children });
      continue;
    }

    next.push(child);
  }

  return { children: next, removed };
}

function renumberOrderableSiblings(children: TreeEntry[]): TreeEntry[] {
  let order = 1;
  return children.map((child) => {
    if (!child.isDir && !isMarkdown(child.path)) return child;
    return { ...child, order: order++ };
  });
}

function insertEntry(children: TreeEntry[], parentId: string | null, index: number, entry: TreeEntry): TreeEntry[] {
  if (parentId == null) {
    const next = children.slice();
    next.splice(Math.max(0, Math.min(index, next.length)), 0, retargetMovedEntry(entry, null));
    return renumberOrderableSiblings(next);
  }

  return children.map((child) => {
    if (entryId(child) !== stripTrailingSlash(parentId)) {
      if (!child.children) return child;
      return { ...child, children: insertEntry(child.children, parentId, index, entry) };
    }

    const nextChildren = (child.children || []).slice();
    nextChildren.splice(
      Math.max(0, Math.min(index, nextChildren.length)),
      0,
      retargetMovedEntry(entry, parentId),
    );
    return { ...child, children: renumberOrderableSiblings(nextChildren) };
  });
}

export function applyOptimisticTreeMove(root: TreeEntry, args: OptimisticTreeMoveArgs): TreeEntry {
  const dragId = args.dragIds[0];
  if (!dragId) return root;

  const cloned = cloneEntry(root);
  const result = removeEntry(cloned.children || [], stripTrailingSlash(dragId));
  if (!result.removed) return root;

  return {
    ...cloned,
    children: insertEntry(result.children, args.parentId, args.index, result.removed),
  };
}
