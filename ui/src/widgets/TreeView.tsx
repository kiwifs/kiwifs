export interface TreeNode {
  value: string | number;
  left?: TreeNode | null;
  right?: TreeNode | null;
  children?: TreeNode[];
}

export interface TreeViewProps {
  root: TreeNode | null;
  /** Set of node values that are currently active / highlighted. */
  activeNodes?: Set<string | number>;
  /** Set of node values that are secondary-highlighted. */
  highlightNodes?: Set<string | number>;
  /** Set of node values that are dimmed (already processed). */
  dimNodes?: Set<string | number>;
  /** Labels to show next to specific nodes (e.g. "curr", "parent"). */
  pointers?: { value: string | number; label: string; color?: string }[];
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
  x: number;
  y: number;
  children: LayoutNode[];
  isNull?: boolean;
}

function layoutTree(
  node: TreeNode | null | undefined,
  depth: number,
  hGap: number,
  vGap: number,
  nodeSize: number,
): LayoutNode | null {
  if (!node) return null;

  const isBinary = node.children === undefined;
  const kids: (TreeNode | null)[] = isBinary
    ? [node.left ?? null, node.right ?? null]
    : (node.children ?? []);

  const childLayouts: (LayoutNode | null)[] = kids.map((c) =>
    c ? layoutTree(c, depth + 1, hGap, vGap, nodeSize) : null
  );

  if (isBinary && childLayouts.every((c) => c === null) && (node.left === undefined && node.right === undefined)) {
    return { value: node.value, x: 0, y: depth * vGap, children: [] };
  }

  const nonNull = childLayouts.filter((c): c is LayoutNode => c !== null);

  if (nonNull.length === 0) {
    return { value: node.value, x: 0, y: depth * vGap, children: [] };
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
  const parentX = (firstX + lastX) / 2;

  return {
    value: node.value,
    x: parentX,
    y: depth * vGap,
    children: positioned,
  };
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

function collectEdges(node: LayoutNode): { x1: number; y1: number; x2: number; y2: number }[] {
  const edges: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const child of node.children) {
    edges.push({ x1: node.x, y1: node.y, x2: child.x, y2: child.y });
    edges.push(...collectEdges(child));
  }
  return edges;
}

export function TreeView({
  root,
  activeNodes,
  highlightNodes,
  dimNodes,
  pointers = [],
  activeColor = DEFAULTS.activeColor,
  highlightColor = DEFAULTS.highlightColor,
  hGap = DEFAULTS.hGap,
  vGap = DEFAULTS.vGap,
  nodeSize = DEFAULTS.nodeSize,
}: TreeViewProps) {
  if (!root) {
    return (
      <div style={{ textAlign: "center", padding: 16, color: DEFAULTS.dimColor, fontSize: "0.8rem" }}>
        (empty tree)
      </div>
    );
  }

  const layout = layoutTree(root, 0, hGap, vGap, nodeSize);
  if (!layout) return null;

  const nodes = flattenTree(layout);
  const edges = collectEdges(layout);

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
    const list = pointerMap.get(p.value) ?? [];
    list.push(p);
    pointerMap.set(p.value, list);
  }

  const r = nodeSize / 2;

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "0.5rem 0", overflow: "auto" }}>
      <svg width={width} height={height} style={{ display: "block" }}>
        {edges.map((e, i) => (
          <line
            key={i}
            x1={e.x1 + ox}
            y1={e.y1 + oy}
            x2={e.x2 + ox}
            y2={e.y2 + oy}
            stroke={DEFAULTS.border}
            strokeWidth={2}
            style={{ transition: "all 0.25s ease" }}
          />
        ))}
        {nodes.map((n, i) => {
          const isActive = activeNodes?.has(n.value) ?? false;
          const isHighlight = highlightNodes?.has(n.value) ?? false;
          const isDim = dimNodes?.has(n.value) ?? false;
          const ptrs = pointerMap.get(n.value);

          let fill = "transparent";
          let stroke = DEFAULTS.border;
          let textColor = DEFAULTS.text;
          let opacity = 1;

          if (isActive) {
            fill = activeColor;
            stroke = activeColor;
            textColor = "#111827";
          } else if (isHighlight) {
            fill = highlightColor + "2e";
            stroke = highlightColor;
          } else if (isDim) {
            stroke = DEFAULTS.dimColor;
            opacity = 0.5;
          }

          const cx = n.x + ox;
          const cy = n.y + oy;

          return (
            <g key={i} style={{ transition: "all 0.25s ease", opacity }}>
              <circle
                cx={cx}
                cy={cy}
                r={r}
                fill={fill}
                stroke={stroke}
                strokeWidth={2}
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
              >
                {n.value}
              </text>
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
