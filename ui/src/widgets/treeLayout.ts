/** Structural tree accepted by the layout. Matches `TreeNode` in TreeView. */
export interface LayoutInput {
  value: string | number;
  id?: string | number;
  badge?: string | number;
  edgeLabel?: string | number;
  left?: LayoutInput | null;
  right?: LayoutInput | null;
  children?: LayoutInput[];
}

export interface LayoutNode {
  value: string | number;
  key: string | number;
  badge?: string | number;
  edgeLabel?: string | number;
  x: number;
  y: number;
  children: LayoutNode[];
  /** Dashed empty slot for a missing binary child when the other side exists. */
  ghost?: boolean;
}

export interface LayoutEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label?: string | number;
  childKey: string | number;
  parentKey: string | number;
  ghost?: boolean;
}

export interface TreeLayoutOptions {
  hGap: number;
  vGap: number;
  nodeSize: number;
  /** Place a ghost on the empty side of a one-child binary node. Default true. */
  showNulls?: boolean;
}

function nodeKey(node: LayoutInput): string | number {
  return node.id ?? node.value;
}

function getTreeBounds(node: LayoutNode): { minX: number; maxX: number } {
  let minX = node.x;
  let maxX = node.x;
  for (const child of node.children) {
    const cb = getTreeBounds(child);
    if (cb.minX < minX) minX = cb.minX;
    if (cb.maxX > maxX) maxX = cb.maxX;
  }
  return { minX, maxX };
}

function shiftTree(node: LayoutNode, dx: number): void {
  node.x += dx;
  for (const child of node.children) shiftTree(child, dx);
}

function makeGhost(
  parentKey: string | number,
  side: "left" | "right",
  depth: number,
  vGap: number,
): LayoutNode {
  return {
    value: "",
    key: `${String(parentKey)}__null_${side}`,
    y: depth * vGap,
    x: 0,
    children: [],
    ghost: true,
  };
}

/**
 * Binary layout keeps left and right in their own slots. A missing child does
 * not collapse the tree into a vertical stick — the surviving child stays on
 * its side of the parent. When `showNulls` is on (default), a one-child node
 * also gets a ghost on the empty side so the hole is visible.
 */
export function layoutTree(
  node: LayoutInput | null | undefined,
  depth: number,
  opts: TreeLayoutOptions,
): LayoutNode | null {
  if (!node) return null;

  const { hGap, vGap, nodeSize, showNulls = true } = opts;
  const key = nodeKey(node);
  const base = {
    value: node.value,
    key,
    badge: node.badge,
    edgeLabel: node.edgeLabel,
    y: depth * vGap,
  };

  const isBinary = node.children === undefined;

  if (!isBinary) {
    const kids = node.children ?? [];
    const childLayouts = kids
      .map((c) => layoutTree(c, depth + 1, opts))
      .filter((c): c is LayoutNode => c !== null);
    if (childLayouts.length === 0) {
      return { ...base, x: 0, children: [] };
    }
    let offset = 0;
    for (const child of childLayouts) {
      const bounds = getTreeBounds(child);
      shiftTree(child, offset - bounds.minX);
      offset = getTreeBounds(child).maxX + hGap + nodeSize;
    }
    const firstX = childLayouts[0]!.x;
    const lastX = childLayouts[childLayouts.length - 1]!.x;
    return { ...base, x: (firstX + lastX) / 2, children: childLayouts };
  }

  const hasLeft = node.left != null;
  const hasRight = node.right != null;
  const leftLayout = hasLeft
    ? layoutTree(node.left, depth + 1, opts)
    : showNulls && hasRight
      ? makeGhost(key, "left", depth + 1, vGap)
      : null;
  const rightLayout = hasRight
    ? layoutTree(node.right, depth + 1, opts)
    : showNulls && hasLeft
      ? makeGhost(key, "right", depth + 1, vGap)
      : null;

  if (!leftLayout && !rightLayout) {
    return { ...base, x: 0, children: [] };
  }

  const sep = hGap + nodeSize;
  if (leftLayout) shiftTree(leftLayout, -sep - leftLayout.x);
  if (rightLayout) shiftTree(rightLayout, sep - rightLayout.x);

  if (leftLayout && rightLayout) {
    const gap = getTreeBounds(rightLayout).minX - getTreeBounds(leftLayout).maxX;
    const need = hGap + nodeSize;
    if (gap < need) {
      const extra = need - gap;
      shiftTree(leftLayout, -extra / 2);
      shiftTree(rightLayout, extra / 2);
    }
  }

  const children = [leftLayout, rightLayout].filter((c): c is LayoutNode => c !== null);
  return { ...base, x: 0, children };
}

type ParentLinks =
  | readonly (string | number | null | undefined)[]
  | Readonly<Record<string, string | number | null | undefined>>;

/**
 * Build a forest from parent pointers: `parents[i]` is the parent of node `i`
 * (array) or `parents[key]` the parent of `key` (object). A node is a root when
 * its parent is itself, missing, `null`, `-1`, or unknown. Roots and children
 * keep key order, so the picture stays stable as links change. A cycle that
 * never reaches a root is broken at its first key, which becomes a root.
 */
export function forestFromParents(parents: ParentLinks): LayoutInput[] {
  const isArray = Array.isArray(parents);
  const keys: (string | number)[] = isArray
    ? (parents as readonly unknown[]).map((_, i) => i)
    : Object.keys(parents);
  const byId = new Map<string, string | number>(keys.map((k) => [String(k), k]));
  const parentOf = (k: string | number): string | number | null => {
    const p = isArray
      ? (parents as readonly (string | number | null | undefined)[])[k as number]
      : (parents as Record<string, string | number | null | undefined>)[String(k)];
    if (p == null || p === -1 || String(p) === String(k)) return null;
    return byId.get(String(p)) ?? null;
  };

  const children = new Map<string, (string | number)[]>();
  for (const k of keys) {
    const p = parentOf(k);
    if (p === null) continue;
    const list = children.get(String(p)) ?? [];
    list.push(k);
    children.set(String(p), list);
  }

  const visited = new Set<string>();
  const build = (k: string | number): LayoutInput => {
    visited.add(String(k));
    const kids = (children.get(String(k)) ?? []).filter((c) => !visited.has(String(c)));
    return { value: k, id: k, children: kids.map(build) };
  };

  const roots: LayoutInput[] = [];
  for (const k of keys) if (parentOf(k) === null) roots.push(build(k));
  for (const k of keys) if (!visited.has(String(k))) roots.push(build(k));
  return roots;
}

/** Lay each tree out independently, then push it clear of the previous one. */
export function layoutForest(
  roots: (LayoutInput | null | undefined)[],
  opts: TreeLayoutOptions,
): LayoutNode[] {
  const layouts: LayoutNode[] = [];
  let offset = 0;
  for (const root of roots) {
    const layout = layoutTree(root, 0, opts);
    if (!layout) continue;
    shiftTree(layout, offset - getTreeBounds(layout).minX);
    offset = getTreeBounds(layout).maxX + opts.nodeSize + opts.hGap * 2;
    layouts.push(layout);
  }
  return layouts;
}

export function flattenTree(node: LayoutNode): LayoutNode[] {
  const result: LayoutNode[] = [node];
  for (const child of node.children) result.push(...flattenTree(child));
  return result;
}

export function collectEdges(node: LayoutNode): LayoutEdge[] {
  const edges: LayoutEdge[] = [];
  for (const child of node.children) {
    edges.push({
      x1: node.x,
      y1: node.y,
      x2: child.x,
      y2: child.y,
      label: child.edgeLabel,
      childKey: child.key,
      parentKey: node.key,
      ghost: child.ghost,
    });
    edges.push(...collectEdges(child));
  }
  return edges;
}

export function positionsByKey(node: LayoutNode): Map<string | number, { x: number; y: number }> {
  const map = new Map<string | number, { x: number; y: number }>();
  for (const n of flattenTree(node)) {
    map.set(n.key, { x: n.x, y: n.y });
  }
  return map;
}
