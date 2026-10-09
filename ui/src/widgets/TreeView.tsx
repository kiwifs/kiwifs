import { useId } from "react";
import { alpha, lookupKeyed, type KeyedValues } from "./colors";
import { SvgLabel } from "./WidgetText";
import {
  flattenTree,
  forestFromParents,
  layoutForest,
  type LayoutNode,
} from "./treeLayout";
import { useTweenedPositions, type Point } from "./useTweenedPositions";

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
  /**
   * Parent pointers instead of nested nodes: `parents[i]` is the parent of
   * node `i` (array) or `parents[key]` the parent of `key` (object). A node
   * whose parent is itself, `null`, or `-1` is a root. Node keys are the
   * indices / object keys. Rendered after `root` and `roots`.
   */
  parents?: (string | number | null | undefined)[] | Record<string, string | number | null | undefined>;
  /** Badge per node key, overriding any `badge` on the node itself. */
  badges?: KeyedValues<string | number>;
  /**
   * Base color per node key — e.g. one {@link groupColor} per component.
   * Active and highlight styling still take precedence.
   */
  nodeColors?: KeyedValues<string>;
  /** Node keys that are currently active / highlighted. */
  activeNodes?: Set<string | number>;
  /** Node keys that are secondary-highlighted. */
  highlightNodes?: Set<string | number>;
  /** Node keys that are dimmed (already processed). */
  dimNodes?: Set<string | number>;
  /** Node keys the search abandoned — drawn dashed and faded, with a dashed
   *  edge from the parent. */
  prunedNodes?: Set<string | number>;
  /**
   * Child keys (or `"parent->child"` strings) whose incoming edge should light
   * up. Edges whose two ends are both in `highlightNodes` also light, so a
   * highlighted root-to-leaf walk draws as a path without extra bookkeeping.
   */
  highlightEdges?: Set<string | number>;
  /**
   * Edges that no longer exist, drawn dashed and faded between the two nodes'
   * current positions — the old parent link after a rotation, re-parenting,
   * or path compression. `from` is the old parent, `to` the child.
   */
  ghostEdges?: { from: string | number; to: string | number; label?: string | number }[];
  /**
   * Arrowheads on parent–child edges: `"down"` points parent → child, `"up"`
   * points child → parent (parent pointers, union-find). Default `"none"`.
   */
  edgeDirection?: "none" | "down" | "up";
  /**
   * Same-level links — next-right pointers, threaded nodes. Drawn as a
   * horizontal arrow from `from` to `to` (node keys).
   */
  nextLinks?: { from: string | number; to: string | number }[];
  /** Labels to show next to specific nodes (e.g. "curr", "parent"). */
  pointers?: { value?: string | number; id?: string | number; label: string; color?: string }[];
  /** Show the label on each edge, when nodes carry `edgeLabel`. Default true. */
  showEdgeLabels?: boolean;
  /**
   * For a binary node with exactly one child, draw a dashed empty slot on the
   * missing side so a right-only stick cannot be mistaken for a straight line.
   * Leaves (both children missing) stay clean. N-ary `children` trees ignore
   * this. Default true.
   */
  showNulls?: boolean;
  /** Glide nodes to their new positions when the tree changes. Default true. */
  animate?: boolean;
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

/** Endpoints of a segment between two circles, trimmed to their rims. */
function trim(a: Point, b: Point, ra: number, rb: number) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  return {
    x1: a.x + (dx / d) * ra,
    y1: a.y + (dy / d) * ra,
    x2: b.x - (dx / d) * rb,
    y2: b.y - (dy / d) * rb,
  };
}

export function TreeView({
  root,
  roots,
  parents,
  badges,
  nodeColors,
  activeNodes,
  highlightNodes,
  dimNodes,
  prunedNodes,
  highlightEdges,
  ghostEdges = [],
  edgeDirection = "none",
  nextLinks = [],
  pointers = [],
  showEdgeLabels = true,
  showNulls = true,
  animate = true,
  activeColor = DEFAULTS.activeColor,
  highlightColor = DEFAULTS.highlightColor,
  hGap = DEFAULTS.hGap,
  vGap = DEFAULTS.vGap,
  nodeSize = DEFAULTS.nodeSize,
}: TreeViewProps) {
  const uid = useId().replace(/:/g, "");
  const markerId = `kw-tree-next-${uid}`;
  const arrowId = `kw-tree-arrow-${uid}`;
  const arrowLitId = `kw-tree-arrow-lit-${uid}`;
  const allRoots = [
    ...(root ? [root] : []),
    ...(roots ?? []),
    ...(parents ? forestFromParents(parents) : []),
  ];
  const layouts = layoutForest(allRoots, { hGap, vGap, nodeSize, showNulls });
  const nodes = layouts.flatMap(flattenTree);

  // Keys repeat when values repeat without ids; suffix later twins so each
  // drawn node keeps its own identity (and its own animation track).
  const renderKey = new Map<LayoutNode, string>();
  const firstByKey = new Map<string, string>();
  const seen = new Map<string, number>();
  for (const n of nodes) {
    const base = String(n.key);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const rk = count === 0 ? base : `${base}#${count}`;
    renderKey.set(n, rk);
    if (!firstByKey.has(base)) firstByKey.set(base, rk);
  }
  const edges: { parent: LayoutNode; child: LayoutNode }[] = [];
  const walk = (n: LayoutNode) => {
    for (const c of n.children) {
      edges.push({ parent: n, child: c });
      walk(c);
    }
  };
  layouts.forEach(walk);

  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const n of nodes) {
    if (n.x < bounds.minX) bounds.minX = n.x;
    if (n.x > bounds.maxX) bounds.maxX = n.x;
    if (n.y < bounds.minY) bounds.minY = n.y;
    if (n.y > bounds.maxY) bounds.maxY = n.y;
  }

  const pad = nodeSize + 20;
  const width = nodes.length ? bounds.maxX - bounds.minX + pad * 2 : 0;
  const height = nodes.length ? bounds.maxY - bounds.minY + pad * 2 : 0;
  const ox = -bounds.minX + pad / 2 + nodeSize / 2;
  const oy = -bounds.minY + pad / 2 + nodeSize / 2;

  const target = new Map<string, Point>();
  for (const n of nodes) target.set(renderKey.get(n)!, { x: n.x + ox, y: n.y + oy });
  const tweened = useTweenedPositions(target, { enabled: animate });
  const posOf = (n: LayoutNode) => tweened.get(renderKey.get(n)!);
  const posByKey = (k: string | number) => {
    const rk = firstByKey.get(String(k));
    return rk === undefined ? undefined : tweened.get(rk);
  };

  if (nodes.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 16, color: DEFAULTS.dimColor, fontSize: "0.8rem" }}>
        (empty tree)
      </div>
    );
  }

  const pointerMap = new Map<string | number, typeof pointers>();
  for (const p of pointers) {
    const key = p.id ?? p.value;
    if (key === undefined) continue;
    const list = pointerMap.get(key) ?? [];
    list.push(p);
    pointerMap.set(key, list);
  }

  const r = nodeSize / 2;
  const ghostR = r * 0.72;
  const radiusOf = (n: LayoutNode) => (n.ghost ? ghostR : r);

  function edgeIsLit(e: { childKey: string | number; parentKey: string | number }): boolean {
    if (highlightEdges?.has(e.childKey)) return true;
    if (highlightEdges?.has(`${e.parentKey}->${e.childKey}`)) return true;
    return Boolean(highlightNodes?.has(e.childKey) && highlightNodes?.has(e.parentKey));
  }

  function arrows(lit: boolean) {
    const m = `url(#${lit ? arrowLitId : arrowId})`;
    return edgeDirection === "down" ? { markerEnd: m } : edgeDirection === "up" ? { markerStart: m } : {};
  }

  const arrowMarker = (id: string, fill: string, start: boolean) => (
    <marker
      id={id}
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="6"
      markerHeight="6"
      orient={start ? "auto-start-reverse" : "auto"}
    >
      <path d="M 0 0 L 10 5 L 0 10 z" fill={fill} />
    </marker>
  );

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "0.5rem 0", overflow: "auto" }}>
      <svg width={width} height={height} style={{ display: "block", overflow: "visible" }}>
        <defs>
          <marker
            id={markerId}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--kw-widget-accent-amber, #f59e0b)" />
          </marker>
          {arrowMarker(arrowId, DEFAULTS.border, edgeDirection === "up")}
          {arrowMarker(arrowLitId, highlightColor, edgeDirection === "up")}
        </defs>
        {ghostEdges.map((g) => {
          const a = posByKey(g.from);
          const b = posByKey(g.to);
          if (!a || !b) return null;
          // Bow below the chord: a rewired link usually joins neighbours, where
          // a straight segment would be a stub hidden between two circles.
          const bow = Math.max(r * 1.4, Math.hypot(b.x - a.x, b.y - a.y) * 0.3);
          const ctrl = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + bow };
          const { x1, y1 } = trim(a, ctrl, r, 0);
          const { x2, y2 } = trim(ctrl, b, 0, r);
          const midX = (x1 + 2 * ctrl.x + x2) / 4;
          const midY = (y1 + 2 * ctrl.y + y2) / 4;
          return (
            <g key={`ghost-${String(g.from)}->${String(g.to)}`} opacity={0.65}>
              <path
                d={`M ${x1} ${y1} Q ${ctrl.x} ${ctrl.y} ${x2} ${y2}`}
                fill="none"
                stroke={DEFAULTS.dimColor}
                strokeWidth={1.75}
                strokeDasharray="4 4"
                {...arrows(false)}
              />
              {g.label != null && g.label !== "" && (
                <SvgLabel
                  x={midX}
                  y={midY + 8}
                  text={g.label}
                  anchor="middle"
                  dominantBaseline="central"
                  fill={DEFAULTS.dimColor}
                  fontSize={10}
                  fontWeight={600}
                  fontFamily="ui-monospace, SFMono-Regular, monospace"
                  halo="var(--kw-widget-surface, #18181b)"
                />
              )}
            </g>
          );
        })}
        {edges.map(({ parent, child }) => {
          const a = posOf(parent);
          const b = posOf(child);
          if (!a || !b) return null;
          const s = trim(a, b, radiusOf(parent), radiusOf(child));
          const e = { parentKey: parent.key, childKey: child.key, ghost: child.ghost, label: child.edgeLabel };
          const toPruned = prunedNodes?.has(e.childKey) ?? false;
          const lit = !e.ghost && edgeIsLit(e);
          const hasLabel = showEdgeLabels && e.label != null && e.label !== "";
          return (
            <g key={`${renderKey.get(parent)}->${renderKey.get(child)}`}>
              <line
                {...s}
                stroke={lit ? highlightColor : DEFAULTS.border}
                strokeWidth={lit ? 2.5 : 2}
                strokeDasharray={e.ghost || toPruned ? "4 3" : undefined}
                opacity={e.ghost ? 0.4 : toPruned ? 0.5 : 1}
                style={{ transition: "stroke 0.25s ease, opacity 0.25s ease" }}
                {...(e.ghost ? {} : arrows(lit))}
              />
              {hasLabel && (
                // Sit nearer the parent than the child, to stay clear of the
                // pointer labels that hang above each node.
                <SvgLabel
                  x={a.x + (b.x - a.x) * 0.38}
                  y={a.y + (b.y - a.y) * 0.38}
                  text={e.label}
                  anchor="middle"
                  dominantBaseline="central"
                  fill={DEFAULTS.dimColor}
                  fontSize={10}
                  fontWeight={600}
                  fontFamily="ui-monospace, SFMono-Regular, monospace"
                  halo="var(--kw-widget-surface, #18181b)"
                />
              )}
            </g>
          );
        })}
        {nextLinks.map((link, i) => {
          const a = posByKey(link.from);
          const b = posByKey(link.to);
          if (!a || !b) return null;
          const x1 = a.x + (b.x >= a.x ? r : -r);
          const x2 = b.x + (b.x >= a.x ? -r : r);
          const y = a.y;
          const lift = Math.min(18, Math.abs(x2 - x1) * 0.2);
          const mid = (x1 + x2) / 2;
          return (
            <path
              key={`next-${i}`}
              d={`M ${x1} ${y} Q ${mid} ${y - lift} ${x2} ${y}`}
              fill="none"
              stroke="var(--kw-widget-accent-amber, #f59e0b)"
              strokeWidth={1.75}
              markerEnd={`url(#${markerId})`}
            />
          );
        })}
        {nodes.map((n) => {
          const p = posOf(n);
          if (!p) return null;
          const isGhost = n.ghost === true;
          const isActive = !isGhost && (activeNodes?.has(n.key) ?? false);
          const isHighlight = !isGhost && (highlightNodes?.has(n.key) ?? false);
          const isDim = dimNodes?.has(n.key) ?? false;
          const isPruned = prunedNodes?.has(n.key) ?? false;
          const groupColor = isGhost ? undefined : lookupKeyed(nodeColors, n.key);
          const ptrs = isGhost ? undefined : pointerMap.get(n.key);
          const badge = isGhost ? undefined : lookupKeyed(badges, n.key) ?? n.badge;

          let fill = "transparent";
          let stroke = DEFAULTS.border;
          let textColor = DEFAULTS.text;
          let opacity = 1;
          let dash: string | undefined;

          if (isGhost) {
            stroke = DEFAULTS.dimColor;
            textColor = DEFAULTS.dimColor;
            opacity = 0.45;
            dash = "4 3";
          } else if (isPruned) {
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
          } else {
            if (groupColor) {
              fill = alpha(groupColor, 18);
              stroke = groupColor;
            }
            if (isDim) {
              if (!groupColor) stroke = DEFAULTS.dimColor;
              opacity = 0.5;
            }
          }

          const cx = p.x;
          const cy = p.y;
          const hasBadge = badge != null && badge !== "";
          const radius = isGhost ? ghostR : r;

          return (
            <g key={renderKey.get(n)} style={{ opacity, transition: "opacity 0.25s ease" }}>
              <circle
                cx={cx}
                cy={cy}
                r={radius}
                fill={fill}
                stroke={stroke}
                strokeWidth={2}
                strokeDasharray={dash}
                style={{ transition: "fill 0.25s ease, stroke 0.25s ease" }}
              />
              <SvgLabel
                x={cx}
                y={cy}
                text={isGhost ? "∅" : n.value}
                anchor="middle"
                dominantBaseline="central"
                fill={textColor}
                fontSize={isGhost ? 11 : nodeSize > 36 ? 14 : 12}
                fontWeight={700}
                fontFamily="ui-monospace, SFMono-Regular, monospace"
                style={isPruned ? { textDecoration: "line-through" } : undefined}
              />
              {hasBadge && (
                <>
                  <circle
                    cx={cx + r * 0.78}
                    cy={cy - r * 0.78}
                    r={9}
                    fill="var(--kw-widget-surface, #18181b)"
                    stroke={isActive ? activeColor : groupColor ?? DEFAULTS.border}
                    strokeWidth={1.5}
                  />
                  <SvgLabel
                    x={cx + r * 0.78}
                    y={cy - r * 0.78}
                    text={badge}
                    anchor="middle"
                    dominantBaseline="central"
                    fill={DEFAULTS.text}
                    fontSize={9}
                    fontWeight={700}
                    fontFamily="ui-monospace, SFMono-Regular, monospace"
                  />
                </>
              )}
              {ptrs?.map((ptr, j) => (
                <SvgLabel
                  key={j}
                  x={cx}
                  y={cy - r - 8 - j * 14}
                  text={ptr.label}
                  anchor="middle"
                  fill={ptr.color ?? activeColor}
                  fontSize={10}
                  fontWeight={600}
                  fontFamily="system-ui, sans-serif"
                />
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
