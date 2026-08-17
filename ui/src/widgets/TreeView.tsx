import { useId } from "react";
import { alpha } from "./colors";
import { SvgLabel } from "./WidgetText";
import {
  collectEdges,
  flattenTree,
  layoutForest,
  positionsByKey,
} from "./treeLayout";

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
  /**
   * Child keys (or `"parent->child"` strings) whose incoming edge should light
   * up. Edges whose two ends are both in `highlightNodes` also light, so a
   * highlighted root-to-leaf walk draws as a path without extra bookkeeping.
   */
  highlightEdges?: Set<string | number>;
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

export function TreeView({
  root,
  roots,
  activeNodes,
  highlightNodes,
  dimNodes,
  prunedNodes,
  highlightEdges,
  nextLinks = [],
  pointers = [],
  showEdgeLabels = true,
  showNulls = true,
  activeColor = DEFAULTS.activeColor,
  highlightColor = DEFAULTS.highlightColor,
  hGap = DEFAULTS.hGap,
  vGap = DEFAULTS.vGap,
  nodeSize = DEFAULTS.nodeSize,
}: TreeViewProps) {
  const markerId = `kw-tree-next-${useId().replace(/:/g, "")}`;
  const allRoots = [...(root ? [root] : []), ...(roots ?? [])];
  const layouts = layoutForest(allRoots, { hGap, vGap, nodeSize, showNulls });

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
  const pos = new Map<string | number, { x: number; y: number }>();
  for (const layout of layouts) {
    for (const [k, p] of positionsByKey(layout)) pos.set(k, p);
  }

  function edgeIsLit(e: { childKey: string | number; parentKey: string | number }): boolean {
    if (highlightEdges?.has(e.childKey)) return true;
    if (highlightEdges?.has(`${e.parentKey}->${e.childKey}`)) return true;
    return Boolean(highlightNodes?.has(e.childKey) && highlightNodes?.has(e.parentKey));
  }

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "0.5rem 0", overflow: "auto" }}>
      <svg width={width} height={height} style={{ display: "block" }}>
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
        </defs>
        {edges.map((e, i) => {
          const toPruned = prunedNodes?.has(e.childKey) ?? false;
          const lit = !e.ghost && edgeIsLit(e);
          const hasLabel = showEdgeLabels && e.label != null && e.label !== "";
          return (
            <g key={i} style={{ transition: "all 0.25s ease" }}>
              <line
                x1={e.x1 + ox}
                y1={e.y1 + oy}
                x2={e.x2 + ox}
                y2={e.y2 + oy}
                stroke={lit ? highlightColor : DEFAULTS.border}
                strokeWidth={lit ? 2.5 : 2}
                strokeDasharray={e.ghost || toPruned ? "4 3" : undefined}
                opacity={e.ghost ? 0.4 : toPruned ? 0.5 : 1}
              />
              {hasLabel && (
                // Sit nearer the parent than the child, to stay clear of the
                // pointer labels that hang above each node.
                <SvgLabel
                  x={e.x1 + (e.x2 - e.x1) * 0.38 + ox}
                  y={e.y1 + (e.y2 - e.y1) * 0.38 + oy}
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
          const a = pos.get(link.from);
          const b = pos.get(link.to);
          if (!a || !b) return null;
          const x1 = a.x + ox + (b.x >= a.x ? r : -r);
          const x2 = b.x + ox + (b.x >= a.x ? -r : r);
          const y = a.y + oy;
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
        {nodes.map((n, i) => {
          const isGhost = n.ghost === true;
          const isActive = !isGhost && (activeNodes?.has(n.key) ?? false);
          const isHighlight = !isGhost && (highlightNodes?.has(n.key) ?? false);
          const isDim = dimNodes?.has(n.key) ?? false;
          const isPruned = prunedNodes?.has(n.key) ?? false;
          const ptrs = isGhost ? undefined : pointerMap.get(n.key);

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
          } else if (isDim) {
            stroke = DEFAULTS.dimColor;
            opacity = 0.5;
          }

          const cx = n.x + ox;
          const cy = n.y + oy;
          const hasBadge = !isGhost && n.badge != null && n.badge !== "";
          const radius = isGhost ? r * 0.72 : r;

          return (
            <g key={i} style={{ transition: "all 0.25s ease", opacity }}>
              <circle
                cx={cx}
                cy={cy}
                r={radius}
                fill={fill}
                stroke={stroke}
                strokeWidth={2}
                strokeDasharray={dash}
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
                    stroke={isActive ? activeColor : DEFAULTS.border}
                    strokeWidth={1.5}
                  />
                  <SvgLabel
                    x={cx + r * 0.78}
                    y={cy - r * 0.78}
                    text={n.badge}
                    anchor="middle"
                    dominantBaseline="central"
                    fill={DEFAULTS.text}
                    fontSize={9}
                    fontWeight={700}
                    fontFamily="ui-monospace, SFMono-Regular, monospace"
                  />
                </>
              )}
              {ptrs?.map((p, j) => (
                <SvgLabel
                  key={j}
                  x={cx}
                  y={cy - r - 8 - j * 14}
                  text={p.label}
                  anchor="middle"
                  fill={p.color ?? activeColor}
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
