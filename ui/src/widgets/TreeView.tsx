import { alpha } from "./colors";

export interface TreeNode {
  value: string | number;
  /**
   * Stable identity for highlighting. Highlight sets and pointers match on
   * `id` when a node has one and on `value` otherwise, so trees with repeated
   * values (tries, recursion trees, heaps with equal keys) can style one node
   * without styling its twins.
   */
  id?: string | number;
  /** Small label in the node's top-right corner: a trie terminal marker, a
   *  subtree size, the range a segment-tree node covers. */
  badge?: string | number;
  /** Label drawn on the edge coming down from this node's parent. */
  edgeLabel?: string | number;
  left?: TreeNode | null;
  right?: TreeNode | null;
  children?: TreeNode[];
}

export interface TreeViewProps {
  root?: TreeNode | null;
  /** Several trees side by side — disjoint-set forests, or a trie split per
   *  starting letter. Rendered after `root` if both are given. */
  roots?: (TreeNode | null | undefined)[];
  /** Node keys that are currently active / highlighted. */
  activeNodes?: Set<string | number>;
  /** Node keys that are secondary-highlighted. */
  highlightNodes?: Set<string | number>;
  /** Node keys that are dimmed (already processed). */
  dimNodes?: Set<string | number>;
  /** Node keys the search abandoned — drawn dashed and faded, with a dashed
   *  edge from the parent. */
  prunedNodes?: Set<string | number>;
  /** Labels to show next to specific nodes (e.g. "curr", "parent"). */
  pointers?: { value?: string | number; id?: string | number; label: string; color?: string }[];
  /** Show the label on each edge, when nodes carry `edgeLabel`. Default true. */
  showEdgeLabels?: boolean;
  activeColor?: string;
  highlightColor?: string;
  /** Horizontal gap between sibling subtrees in px. */
  hGap?: number;
  /** Vertical gap between levels in px. */
  vGap?: number;
  nodeSize?: number;
}

const DEFAULTS = {
  activeColor: "var(--kw-widget-active, #a78bfa)",
  highlightColor: "var(--kw-widget-highlight, #22c55e)",
  dimColor: "var(--kw-widget-dim, #64748b)",
  border: "var(--kw-widget-border, #3f3f46)",
  text: "var(--kw-widget-text, #e5e7eb)",
  hGap: 24,
  vGap: 56,
  nodeSize: 40,
};

interface LayoutNode {
  value: string | number;
  key: string | number;
  badge?: string | number;
  edgeLabel?: string | number;
  x: number;
  y: number;
  children: LayoutNode[];
}

interface LayoutEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label?: string | number;
  childKey: string | number;
}

function nodeKey(node: TreeNode): string | number {
  return node.id ?? node.value;
}

function layoutTree(
  node: TreeNode | null | undefined,
  depth: number,
  hGap: number,
  vGap: number,
  nodeSize: number,
): LayoutNode | null {
  if (!node) return null;

  const base = {
    value: node.value,
    key: nodeKey(node),
    badge: node.badge,
    edgeLabel: node.edgeLabel,
    y: depth * vGap,
  };

  const isBinary = node.children === undefined;
  const kids: (TreeNode | null)[] = isBinary
    ? [node.left ?? null, node.right ?? null]
    : (node.children ?? []);

  const childLayouts: (LayoutNode | null)[] = kids.map((c) =>
    c ? layoutTree(c, depth + 1, hGap, vGap, nodeSize) : null
  );

  if (isBinary && childLayouts.every((c) => c === null) && (node.left === undefined && node.right === undefined)) {
    return { ...base, x: 0, children: [] };
  }

  const nonNull = childLayouts.filter((c): c is LayoutNode => c !== null);

  if (nonNull.length === 0) {
    return { ...base, x: 0, children: [] };
  }

  let offset = 0;
  const positioned: LayoutNode[] = [];
  for (const child of nonNull) {
    const bounds = getTreeBounds(child);
    const shift = offset - bounds.minX;
    shiftTree(child, shift);
    offset = getTreeBounds(child).maxX + hGap + nodeSize;
    positioned.push(child);
  }

  const firstX = positioned[0]!.x;
  const lastX = positioned[positioned.length - 1]!.x;

  return { ...base, x: (firstX + lastX) / 2, children: positioned };
}

/** Lay each tree out independently, then push it clear of the previous one. */
function layoutForest(
  roots: (TreeNode | null | undefined)[],
  hGap: number,
  vGap: number,
  nodeSize: number,
): LayoutNode[] {
  const layouts: LayoutNode[] = [];
  let offset = 0;
  for (const root of roots) {
    const layout = layoutTree(root, 0, hGap, vGap, nodeSize);
    if (!layout) continue;
    shiftTree(layout, offset - getTreeBounds(layout).minX);
    offset = getTreeBounds(layout).maxX + nodeSize + hGap * 2;
    layouts.push(layout);
  }
  return layouts;
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

function flattenTree(node: LayoutNode): LayoutNode[] {
  const result: LayoutNode[] = [node];
  for (const child of node.children) result.push(...flattenTree(child));
  return result;
}

function collectEdges(node: LayoutNode): LayoutEdge[] {
  const edges: LayoutEdge[] = [];
  for (const child of node.children) {
    edges.push({
      x1: node.x,
      y1: node.y,
      x2: child.x,
      y2: child.y,
      label: child.edgeLabel,
      childKey: child.key,
    });
    edges.push(...collectEdges(child));
  }
  return edges;
}

export function TreeView({
  root,
  roots,
  activeNodes,
  highlightNodes,
  dimNodes,
  prunedNodes,
  pointers = [],
  showEdgeLabels = true,
  activeColor = DEFAULTS.activeColor,
  highlightColor = DEFAULTS.highlightColor,
  hGap = DEFAULTS.hGap,
  vGap = DEFAULTS.vGap,
  nodeSize = DEFAULTS.nodeSize,
}: TreeViewProps) {
  const allRoots = [...(root ? [root] : []), ...(roots ?? [])];
  const layouts = layoutForest(allRoots, hGap, vGap, nodeSize);

  if (layouts.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 16, color: DEFAULTS.dimColor, fontSize: "0.8rem" }}>
        (empty tree)
      </div>
    );
  }

  const nodes = layouts.flatMap(flattenTree);
  const edges = layouts.flatMap(collectEdges);

  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const n of nodes) {
    if (n.x < bounds.minX) bounds.minX = n.x;
    if (n.x > bounds.maxX) bounds.maxX = n.x;
    if (n.y < bounds.minY) bounds.minY = n.y;
    if (n.y > bounds.maxY) bounds.maxY = n.y;
  }

  const pad = nodeSize + 20;
  const width = bounds.maxX - bounds.minX + pad * 2;
  const height = bounds.maxY - bounds.minY + pad * 2;
  const ox = -bounds.minX + pad / 2 + nodeSize / 2;
  const oy = -bounds.minY + pad / 2 + nodeSize / 2;

  const pointerMap = new Map<string | number, typeof pointers>();
  for (const p of pointers) {
    const key = p.id ?? p.value;
    if (key === undefined) continue;
    const list = pointerMap.get(key) ?? [];
    list.push(p);
    pointerMap.set(key, list);
  }

  const r = nodeSize / 2;

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "0.5rem 0", overflow: "auto" }}>
      <svg width={width} height={height} style={{ display: "block" }}>
        {edges.map((e, i) => {
          const toPruned = prunedNodes?.has(e.childKey) ?? false;
          const hasLabel = showEdgeLabels && e.label != null && e.label !== "";
          return (
            <g key={i} style={{ transition: "all 0.25s ease" }}>
              <line
                x1={e.x1 + ox}
                y1={e.y1 + oy}
                x2={e.x2 + ox}
                y2={e.y2 + oy}
                stroke={DEFAULTS.border}
                strokeWidth={2}
                strokeDasharray={toPruned ? "4 3" : undefined}
                opacity={toPruned ? 0.5 : 1}
              />
              {hasLabel && (
                // Sit nearer the parent than the child, to stay clear of the
                // pointer labels that hang above each node.
                <text
                  x={e.x1 + (e.x2 - e.x1) * 0.38 + ox}
                  y={e.y1 + (e.y2 - e.y1) * 0.38 + oy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={DEFAULTS.dimColor}
                  fontSize={10}
                  fontWeight={600}
                  fontFamily="ui-monospace, SFMono-Regular, monospace"
                  style={{ paintOrder: "stroke", stroke: "var(--kw-widget-surface, #18181b)", strokeWidth: 4 }}
                >
                  {e.label}
                </text>
              )}
            </g>
          );
        })}
        {nodes.map((n, i) => {
          const isActive = activeNodes?.has(n.key) ?? false;
          const isHighlight = highlightNodes?.has(n.key) ?? false;
          const isDim = dimNodes?.has(n.key) ?? false;
          const isPruned = prunedNodes?.has(n.key) ?? false;
          const ptrs = pointerMap.get(n.key);

          let fill = "transparent";
          let stroke = DEFAULTS.border;
          let textColor = DEFAULTS.text;
          let opacity = 1;
          let dash: string | undefined;

          if (isPruned) {
            stroke = DEFAULTS.dimColor;
            textColor = DEFAULTS.dimColor;
            opacity = 0.45;
            dash = "4 3";
          } else if (isActive) {
            fill = activeColor;
            stroke = activeColor;
            textColor = "var(--kw-widget-active-foreground, #111827)";
          } else if (isHighlight) {
            fill = alpha(highlightColor, 18);
            stroke = highlightColor;
          } else if (isDim) {
            stroke = DEFAULTS.dimColor;
            opacity = 0.5;
          }

          const cx = n.x + ox;
          const cy = n.y + oy;
          const hasBadge = n.badge != null && n.badge !== "";

          return (
            <g key={i} style={{ transition: "all 0.25s ease", opacity }}>
              <circle
                cx={cx}
                cy={cy}
                r={r}
                fill={fill}
                stroke={stroke}
                strokeWidth={2}
                strokeDasharray={dash}
              />
              <text
                x={cx}
                y={cy}
                textAnchor="middle"
                dominantBaseline="central"
                fill={textColor}
                fontSize={nodeSize > 36 ? 14 : 12}
                fontWeight={700}
                fontFamily="ui-monospace, SFMono-Regular, monospace"
                style={isPruned ? { textDecoration: "line-through" } : undefined}
              >
                {n.value}
              </text>
              {hasBadge && (
                <>
                  <circle
                    cx={cx + r * 0.78}
                    cy={cy - r * 0.78}
                    r={9}
                    fill="var(--kw-widget-surface, #18181b)"
                    stroke={isActive ? activeColor : DEFAULTS.border}
                    strokeWidth={1.5}
                  />
                  <text
                    x={cx + r * 0.78}
                    y={cy - r * 0.78}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={DEFAULTS.text}
                    fontSize={9}
                    fontWeight={700}
                    fontFamily="ui-monospace, SFMono-Regular, monospace"
                  >
                    {n.badge}
                  </text>
                </>
              )}
              {ptrs?.map((p, j) => (
                <text
                  key={j}
                  x={cx}
                  y={cy - r - 8 - j * 14}
                  textAnchor="middle"
                  fill={p.color ?? activeColor}
                  fontSize={10}
                  fontWeight={600}
                  fontFamily="system-ui, sans-serif"
                >
                  {p.label}
                </text>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
