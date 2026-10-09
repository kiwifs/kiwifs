import { useId, useMemo } from "react";
import { toSet, type Many } from "./sets";

import { alpha, lookupKeyed, type KeyedValues } from "./colors";
import {
  measureNode,
  parallelBends,
  pointAlong,
  routeEdge,
  textWidth,
  type NodeBox,
  type NodeGeom,
  type NodeShape,
  type Point as GeoPoint,
} from "./graphGeometry";
import { layoutDagre, layoutGraph, type GraphDirection, type GraphLayout } from "./graphLayout";
import { ShapeOutline } from "./ShapeOutline";
import { arrivalOpacity, useFlowProgress } from "./useFlowProgress";
import { useTweenedPositions, type Point } from "./useTweenedPositions";
import { SvgLabel } from "./WidgetText";
import { ZoomPanel } from "./ZoomPanel";

export interface GraphNode {
  id: string | number;
  /** Pixel position. Omit both to have the layout place this node. */
  x?: number;
  y?: number;
  label?: string;
  /** Second, smaller line under the label (e.g. "Postgres · primary"). */
  sublabel?: string;
  /** Outline for this node; overrides the graph-wide `shape`. */
  shape?: NodeShape;
  /** Fixed outer size. Default: sized to fit the label. */
  width?: number;
  height?: number;
  /** Base color, like an entry in `nodeColors`. */
  color?: string;
  /** Group id this node belongs to (same as listing it in `groups[].nodes`). */
  group?: string;
}

export interface GraphEdge {
  from: string | number;
  to: string | number;
  weight?: number;
  label?: string;
  /** Key used by `activeEdges` etc. instead of `"from->to"` (needed for parallel edges). */
  id?: string;
  /** `"dashed"` reads as async / optional, `"dotted"` as weak / derived. */
  style?: "solid" | "dashed" | "dotted";
  color?: string;
  /** Stroke width in px. */
  width?: number;
  /** Marching-dash animation — data continuously flowing along this edge. */
  animated?: boolean;
  /** Arrowheads on both ends. */
  bidirectional?: boolean;
  /** Per-edge override of the graph-wide `directed`. */
  directed?: boolean;
}

export interface GraphGroup {
  id: string;
  label?: string;
  nodes?: (string | number)[];
  /** Enclosing group id, for nested containers (region › VPC › subnet). */
  parent?: string;
  color?: string;
}

export interface GraphPacket {
  /** Edge key: its `id` or `"from->to"`. */
  edge: string;
  /** Fraction along the edge. Omit to animate 0 → 1 whenever packets change. */
  t?: number;
  label?: string;
  color?: string;
  /** Travel to → from (e.g. a response riding the request edge). */
  reverse?: boolean;
}

export interface GraphViewProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Set of node IDs that are currently active. */
  activeNodes?: Many<string | number>;
  /** Set of node IDs that are highlighted (secondary). */
  highlightNodes?: Many<string | number>;
  /** Set of node IDs that are dimmed. */
  dimNodes?: Many<string | number>;
  /** Set of edge keys (`id` or `"from->to"`) for highlighted edges. */
  activeEdges?: Many<string>;
  /** Set of edge keys for secondary-highlighted edges. */
  highlightEdges?: Many<string>;
  /** Set of edge keys for dimmed edges. */
  dimEdges?: Many<string>;
  /** Whether edges are directed (arrows). Default false. */
  directed?: boolean;
  /** Node labels shown next to nodes (e.g. "src", "dst"). */
  pointers?: { id: string | number; label: string; color?: string }[];
  /**
   * How to place nodes that have no `x`/`y`. Every layout is deterministic, so
   * nodes stay put as an animation steps. Default "force", which suits an
   * arbitrary graph; prefer "layered" for DAGs and trees, "circular" for small
   * dense graphs, "grid" for grid-shaped ones, and "dagre" for architecture
   * and flow diagrams with labelled boxes.
   */
  layout?: GraphLayout;
  /**
   * Layered layout only: `"down"` (default) puts edge sources on top; `"up"`
   * puts edge targets on top, so child → parent pointers draw parent-first.
   */
  flow?: "down" | "up";
  /** Dagre layout only: rank direction. Default "TB" ("BT" when `flow="up"`). */
  direction?: GraphDirection;
  /** Dagre layout only: gap between nodes in the same rank, in px. Default 36. */
  nodeSpacing?: number;
  /** Dagre layout only: gap between ranks, in px. Default 52. */
  rankSpacing?: number;
  /** Default outline for every node. Default "circle". */
  shape?: NodeShape;
  /** Labelled containers drawn behind their member nodes. */
  groups?: GraphGroup[];
  /** Dots that travel along edges — requests, messages, tokens. */
  packets?: GraphPacket[];
  /** How long an untimed packet takes to cross its edge, in ms. Default 900. */
  packetDuration?: number;
  /**
   * Base color per node id — e.g. one {@link groupColor} per component.
   * Active and highlight styling still take precedence.
   */
  nodeColors?: KeyedValues<string>;
  /** Base color per edge key, e.g. tree vs back edges in a DFS. */
  edgeColors?: KeyedValues<string>;
  /** Small value per node at its top-right corner (distance, degree, rank). */
  badges?: KeyedValues<string | number>;
  /** Glide nodes to new positions when they move between steps. Default true. */
  animate?: boolean;
  /** Wrap in a zoom / pan viewport for large diagrams. */
  zoomable?: boolean;
  onNodeClick?: (id: string | number) => void;
  activeColor?: string;
  highlightColor?: string;
  nodeSize?: number;
  /**
   * Canvas width. Default 400 (for "dagre": the laid-out width). The diagram
   * scales down to fit narrower containers.
   */
  width?: number;
  /** Canvas height. Default 300 (ignored by "dagre", which sizes itself). */
  height?: number;
}

const DEFAULTS = {
  activeColor: "var(--kw-widget-active, #a78bfa)",
  highlightColor: "var(--kw-widget-highlight, #22c55e)",
  dimColor: "var(--kw-widget-dim, #64748b)",
  border: "var(--kw-widget-border, #3f3f46)",
  text: "var(--kw-widget-text, #e5e7eb)",
  surface: "var(--kw-widget-surface, #18181b)",
  activeText: "var(--kw-widget-active-foreground, #111827)",
  nodeSize: 36,
  width: 400,
  height: 300,
};

const SANS = "ui-sans-serif, system-ui, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, monospace";

type Id = string | number;

export function edgeKey(e: Pick<GraphEdge, "from" | "to" | "id">): string {
  return e.id ?? `${e.from}->${e.to}`;
}

function inSet(set: Set<string> | undefined, e: GraphEdge, undirected: boolean): boolean {
  if (!set || set.size === 0) return false;
  if (set.has(edgeKey(e)) || set.has(`${e.from}->${e.to}`)) return true;
  return undirected && set.has(`${e.to}->${e.from}`);
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function GraphView({
  nodes,
  edges,
  activeNodes: activeNodesIn,
  highlightNodes: highlightNodesIn,
  dimNodes: dimNodesIn,
  activeEdges: activeEdgesIn,
  highlightEdges: highlightEdgesIn,
  dimEdges: dimEdgesIn,
  directed = false,
  pointers = [],
  layout = "force",
  flow = "down",
  direction,
  nodeSpacing,
  rankSpacing,
  shape = "circle",
  groups = [],
  packets = [],
  packetDuration = 900,
  nodeColors,
  edgeColors,
  badges,
  animate = true,
  zoomable = false,
  onNodeClick,
  activeColor = DEFAULTS.activeColor,
  highlightColor = DEFAULTS.highlightColor,
  nodeSize = DEFAULTS.nodeSize,
  width,
  height,
}: GraphViewProps) {
  const activeNodes = toSet(activeNodesIn);
  const highlightNodes = toSet(highlightNodesIn);
  const dimNodes = toSet(dimNodesIn);
  const activeEdges = toSet(activeEdgesIn);
  const highlightEdges = toSet(highlightEdgesIn);
  const dimEdges = toSet(dimEdgesIn);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const canvasW = width ?? DEFAULTS.width;
  const canvasH = height ?? DEFAULTS.height;

  const boxes = new Map<Id, NodeBox & { shape: NodeShape }>();
  for (const n of nodes) {
    const s = n.shape ?? shape;
    boxes.set(n.id, {
      ...measureNode({ label: String(n.label ?? n.id), sublabel: n.sublabel, shape: s, nodeSize, width: n.width, height: n.height }),
      shape: s,
    });
  }

  const allGroups = useMemo(() => {
    const byId = new Map<string, GraphGroup & { nodes: Id[] }>();
    for (const g of groups) byId.set(g.id, { ...g, nodes: [...(g.nodes ?? [])] });
    for (const n of nodes) {
      if (!n.group) continue;
      const g = byId.get(n.group) ?? { id: n.group, nodes: [] };
      if (!g.nodes.includes(n.id)) g.nodes.push(n.id);
      byId.set(n.group, g);
    }
    return [...byId.values()];
  }, [groups, nodes]);

  const edgeLabelText = (e: GraphEdge) => (e.weight !== undefined ? String(e.weight) : e.label);
  const useDagre = layout === "dagre" && !nodes.every((n) => n.x !== undefined && n.y !== undefined);
  const dagreDirection: GraphDirection = direction ?? (flow === "up" ? "BT" : "TB");

  const layoutSignature = useDagre
    ? JSON.stringify([
        nodes.map((n) => [n.id, boxes.get(n.id)!.w, boxes.get(n.id)!.h]),
        edges.map((e) => [e.from, e.to, edgeLabelText(e) ?? ""]),
        allGroups.map((g) => [g.id, g.parent ?? "", g.nodes]),
        dagreDirection,
        nodeSpacing ?? 0,
        rankSpacing ?? 0,
      ])
    : "";
  const dagre = useMemo(() => {
    if (!useDagre) return null;
    return layoutDagre(
      nodes.map((n) => ({ id: n.id, w: boxes.get(n.id)!.w, h: boxes.get(n.id)!.h })),
      edges.map((e) => {
        const text = edgeLabelText(e);
        return text ? { from: e.from, to: e.to, labelW: textWidth(text, 11) + 10, labelH: 16 } : { from: e.from, to: e.to };
      }),
      {
        direction: dagreDirection,
        groups: allGroups.map((g) => ({ id: g.id, nodes: g.nodes, parent: g.parent })),
        nodeSep: nodeSpacing,
        rankSep: rankSpacing,
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutSignature]);

  const positions = dagre
    ? dagre.nodes
    : layoutGraph(nodes, edges, { width: canvasW, height: canvasH, nodeSize, layout, flow });
  const target = new Map<Id, Point>();
  for (const n of nodes) {
    const p = positions.get(n.id);
    target.set(n.id, { x: p?.x ?? canvasW / 2, y: p?.y ?? canvasH / 2 });
  }
  const tweened = useTweenedPositions(target, { enabled: animate });

  const packetSignature = packets.some((p) => p.t === undefined)
    ? JSON.stringify(packets.map((p) => [p.edge, p.reverse ?? false, p.label ?? ""]))
    : "";
  const progress = useFlowProgress(packetSignature, { duration: packetDuration, rest: 0.5 });

  if (nodes.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 16, color: DEFAULTS.dimColor, fontSize: "0.8rem" }}>
        (empty graph)
      </div>
    );
  }

  const geom = new Map<Id, NodeGeom & { box: NodeBox }>();
  const shift = new Map<Id, GeoPoint>();
  for (const n of nodes) {
    const box = boxes.get(n.id)!;
    const now = tweened.get(n.id) ?? target.get(n.id)!;
    const goal = target.get(n.id)!;
    geom.set(n.id, { x: now.x, y: now.y, w: box.w, h: box.h, shape: box.shape, box });
    shift.set(n.id, { x: now.x - goal.x, y: now.y - goal.y });
  }

  // Bounds of everything drawn, so nothing is clipped by the canvas.
  const bounds: Rect = dagre
    ? { x0: 0, y0: 0, x1: dagre.width, y1: dagre.height }
    : { x0: 0, y0: 0, x1: canvasW, y1: canvasH };
  const grow = (r: Rect) => {
    bounds.x0 = Math.min(bounds.x0, r.x0);
    bounds.y0 = Math.min(bounds.y0, r.y0);
    bounds.x1 = Math.max(bounds.x1, r.x1);
    bounds.y1 = Math.max(bounds.y1, r.y1);
  };

  const pointerMap = new Map<Id, typeof pointers>();
  for (const p of pointers) {
    const list = pointerMap.get(p.id) ?? [];
    list.push(p);
    pointerMap.set(p.id, list);
  }

  for (const [id, g] of geom) {
    const above = (pointerMap.get(id)?.length ?? 0) * 14;
    grow({ x0: g.x - g.w / 2 - 6, y0: g.y - g.h / 2 - above - 10, x1: g.x + g.w / 2 + 10, y1: g.y + g.h / 2 + 6 });
  }

  // Groups: innermost first so a parent can wrap its children's boxes.
  const groupById = new Map(allGroups.map((g) => [g.id, g]));
  const depthOf = (g: GraphGroup): number => {
    let d = 0;
    let p = g.parent;
    const seen = new Set<string>();
    while (p && groupById.has(p) && !seen.has(p)) {
      seen.add(p);
      d++;
      p = groupById.get(p)!.parent;
    }
    return d;
  };
  const groupRects = new Map<string, Rect>();
  const byDepth = [...allGroups].sort((a, b) => depthOf(b) - depthOf(a));
  for (const g of byDepth) {
    const r: Rect = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const include = (q: Rect) => {
      r.x0 = Math.min(r.x0, q.x0);
      r.y0 = Math.min(r.y0, q.y0);
      r.x1 = Math.max(r.x1, q.x1);
      r.y1 = Math.max(r.y1, q.y1);
    };
    for (const id of g.nodes) {
      const n = geom.get(id);
      if (n) include({ x0: n.x - n.w / 2, y0: n.y - n.h / 2, x1: n.x + n.w / 2, y1: n.y + n.h / 2 });
    }
    for (const child of allGroups) {
      if (child.parent === g.id && groupRects.has(child.id)) include(groupRects.get(child.id)!);
    }
    if (!Number.isFinite(r.x0)) continue;
    const pad = 12;
    const labelSpace = g.label ? 18 : 0;
    const rect = { x0: r.x0 - pad, y0: r.y0 - pad - labelSpace, x1: r.x1 + pad, y1: r.y1 + pad };
    const labelW = g.label ? textWidth(g.label, 11) + 20 : 0;
    rect.x1 = Math.max(rect.x1, rect.x0 + labelW);
    groupRects.set(g.id, rect);
    grow({ x0: rect.x0 - 2, y0: rect.y0 - 2, x1: rect.x1 + 2, y1: rect.y1 + 2 });
  }

  const bends = parallelBends(edges);
  const undirected = !directed;

  type DrawnEdge = {
    e: GraphEdge;
    key: string;
    d: string;
    samples: GeoPoint[];
    labelAt: GeoPoint | null;
    color: string;
    strokeWidth: number;
    dash?: string;
    animated: boolean;
    opacity: number;
    markerEnd?: string;
    markerStart?: string;
    labelColor: string;
    isActive: boolean;
  };

  const markerColors = new Map<string, string>();
  const markerFor = (color: string) => {
    let id = markerColors.get(color);
    if (!id) {
      id = `kw-graph-${uid}-arrow-${markerColors.size}`;
      markerColors.set(color, id);
    }
    return `url(#${id})`;
  };

  const drawn: DrawnEdge[] = [];
  edges.forEach((e, i) => {
    const from = geom.get(e.from);
    const to = geom.get(e.to);
    if (!from || !to) return;
    const key = edgeKey(e);
    const isActive = inSet(activeEdges, e, undirected);
    const isHighlight = !isActive && inSet(highlightEdges, e, undirected);
    const isDim = !isActive && !isHighlight && inSet(dimEdges, e, undirected);
    const base = e.color ?? lookupKeyed(edgeColors, key) ?? DEFAULTS.border;
    const color = isActive ? activeColor : isHighlight ? highlightColor : base;
    const strokeWidth = (e.width ?? 1.5) + (isActive ? 1 : isHighlight ? 0.5 : 0);
    const isDirected = e.directed ?? directed;
    const dash = e.animated ? "6 5" : e.style === "dashed" ? "6 4" : e.style === "dotted" ? "1.5 4" : undefined;
    const labelColor = isActive ? activeColor : isHighlight ? highlightColor : e.color ?? DEFAULTS.text;
    const text = edgeLabelText(e);

    let d: string;
    let samples: GeoPoint[];
    let labelAt: GeoPoint | null = null;
    if (e.from === e.to) {
      // A self-loop has no direction to draw along — arc it above the node.
      const top = from.shape === "circle" ? from.y - from.h * 0.4 : from.y - from.h / 2;
      const loop = Math.max(10, Math.min(from.w, from.h) * 0.45);
      const ax = from.x - loop * 0.6;
      const bx = from.x + loop * 0.6;
      d = `M ${ax} ${top} A ${loop} ${loop} 0 1 1 ${bx} ${top}`;
      samples = [{ x: ax, y: top }, { x: from.x, y: top - loop * 1.6 }, { x: bx, y: top }];
      if (text) labelAt = { x: from.x, y: top - loop * 1.8 - 6 };
    } else {
      const sf = shift.get(e.from)!;
      const st = shift.get(e.to)!;
      // Parallel edges bow apart from each other; dagre would route the two
      // directions independently and let their labels collide.
      const via = (bends[i] ? [] : dagre?.routes[i] ?? []).map((p, k, all) => {
        const f = (k + 1) / (all.length + 1);
        return { x: p.x + sf.x + (st.x - sf.x) * f, y: p.y + sf.y + (st.y - sf.y) * f };
      });
      const route = routeEdge(from, to, { via, bend: bends[i] ?? 0, startGap: 1, endGap: 1 });
      d = route.d;
      samples = route.samples;
      if (text) {
        const reserved = dagre?.labels[i];
        labelAt = reserved && bends[i] === 0
          ? { x: reserved.x + (sf.x + st.x) / 2, y: reserved.y + (sf.y + st.y) / 2 }
          : pointAlong(samples, 0.5);
      }
    }
    if (labelAt && text) {
      const lw = textWidth(text, 11) + 8;
      grow({ x0: labelAt.x - lw / 2, y0: labelAt.y - 10, x1: labelAt.x + lw / 2, y1: labelAt.y + 10 });
    }

    drawn.push({
      e,
      key: `${key}#${i}`,
      d,
      samples,
      labelAt,
      color,
      strokeWidth,
      dash,
      animated: !!e.animated,
      opacity: isDim ? 0.3 : 1,
      markerEnd: isDirected ? markerFor(color) : undefined,
      markerStart: isDirected && e.bidirectional ? markerFor(color).replace(")", "-start)") : undefined,
      labelColor,
      isActive,
    });
  });

  const routeByKey = new Map<string, DrawnEdge>();
  for (const de of drawn) {
    if (!routeByKey.has(edgeKey(de.e))) routeByKey.set(edgeKey(de.e), de);
    const plain = `${de.e.from}->${de.e.to}`;
    if (!routeByKey.has(plain)) routeByKey.set(plain, de);
  }

  const margin = 4;
  const vbX = bounds.x0 - margin;
  const vbY = bounds.y0 - margin;
  const vbW = bounds.x1 - bounds.x0 + margin * 2;
  const vbH = bounds.y1 - bounds.y0 + margin * 2;
  const displayW = dagre && width !== undefined ? Math.min(width, vbW) : vbW;
  const displayH = (displayW * vbH) / vbW;

  const svg = (
    <svg
      width={Math.round(displayW)}
      height={Math.round(displayH)}
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      style={{ display: "block", maxWidth: "100%", height: "auto" }}
      role="img"
    >
      <defs>
        {[...markerColors].map(([color, id]) => (
          <g key={id}>
            <marker id={id} viewBox="0 0 10 10" refX="10" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
            </marker>
            <marker id={`${id}-start`} viewBox="0 0 10 10" refX="10" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
            </marker>
          </g>
        ))}
        {drawn.some((de) => de.animated) && (
          <style>{`
            @keyframes kw-graph-dash { to { stroke-dashoffset: -22; } }
            .kw-graph-flow { animation: kw-graph-dash 0.9s linear infinite; }
            @media (prefers-reduced-motion: reduce) { .kw-graph-flow { animation: none; } }
          `}</style>
        )}
      </defs>

      {[...allGroups]
        .sort((a, b) => depthOf(a) - depthOf(b))
        .map((g) => {
          const r = groupRects.get(g.id);
          if (!r) return null;
          const c = g.color ?? DEFAULTS.dimColor;
          return (
            <g key={`group-${g.id}`}>
              <rect
                x={r.x0} y={r.y0} width={r.x1 - r.x0} height={r.y1 - r.y0} rx={10}
                fill={alpha(c, 7)}
                stroke={alpha(c, 55)}
                strokeWidth={1.25}
                strokeDasharray={g.color ? undefined : "5 4"}
              />
              {g.label && (
                <SvgLabel
                  x={r.x0 + 10} y={r.y0 + 14}
                  text={g.label}
                  fill={g.color ?? DEFAULTS.text}
                  fontSize={11}
                  fontWeight={700}
                  fontFamily={SANS}
                  style={{ opacity: 0.85, letterSpacing: "0.02em" }}
                  plain
                />
              )}
            </g>
          );
        })}

      {drawn.map((de) => (
        <path
          key={de.key}
          d={de.d}
          fill="none"
          stroke={de.color}
          strokeWidth={de.strokeWidth}
          strokeDasharray={de.dash}
          strokeLinecap={de.e.style === "dotted" ? "round" : undefined}
          markerEnd={de.markerEnd}
          markerStart={de.markerStart}
          className={de.animated ? "kw-graph-flow" : undefined}
          opacity={de.opacity}
          style={{ transition: "stroke 0.25s ease, stroke-width 0.25s ease, opacity 0.25s ease" }}
        />
      ))}

      {drawn.map((de) => {
        const text = edgeLabelText(de.e);
        if (!text || !de.labelAt) return null;
        const isWeight = de.e.weight !== undefined;
        const lw = textWidth(text, isWeight ? 10 : 11, isWeight) + 8;
        return (
          <g key={`label-${de.key}`} opacity={de.opacity}>
            <rect x={de.labelAt.x - lw / 2} y={de.labelAt.y - 8} width={lw} height={16} rx={4} fill={DEFAULTS.surface} opacity={0.92} />
            <SvgLabel
              x={de.labelAt.x} y={de.labelAt.y}
              text={text}
              anchor="middle"
              dominantBaseline="central"
              fill={de.labelColor}
              fontSize={isWeight ? 10 : 11}
              fontWeight={de.isActive ? 700 : 600}
              fontFamily={isWeight ? MONO : SANS}
              plain={!isWeight && shape !== "circle"}
            />
          </g>
        );
      })}

      {nodes.map((n) => {
        const g = geom.get(n.id)!;
        const box = g.box;
        const isActive = activeNodes?.has(n.id) ?? false;
        const isHighlight = highlightNodes?.has(n.id) ?? false;
        const isDim = dimNodes?.has(n.id) ?? false;
        const ptrs = pointerMap.get(n.id);
        const isCircle = g.shape === "circle";

        let fill = isCircle ? "transparent" : DEFAULTS.surface;
        let stroke = DEFAULTS.border;
        let textColor = DEFAULTS.text;
        let opacity = 1;

        if (isActive) {
          fill = activeColor;
          stroke = activeColor;
          textColor = g.shape === "person" ? activeColor : DEFAULTS.activeText;
        } else if (isHighlight) {
          fill = alpha(highlightColor, 18);
          stroke = highlightColor;
        } else {
          const base = n.color ?? lookupKeyed(nodeColors, n.id);
          if (base) {
            fill = alpha(base, 18);
            stroke = base;
          }
          if (isDim) {
            if (!base) stroke = DEFAULTS.dimColor;
            opacity = isCircle ? 0.5 : 0.4;
          }
        }

        const lineH = box.lineHeight;
        const subH = box.subFontSize + 3;
        const blockH = box.lines.length * lineH + box.sublines.length * subH;
        const textDx = g.shape === "queue" ? -10 : 0;
        const firstY = g.y + box.textDy - blockH / 2 + lineH / 2;
        const badge = lookupKeyed(badges, n.id);
        const hasBadge = badge != null && badge !== "";
        const bx = isCircle ? g.x + (g.w / 2) * 0.78 : g.x + g.w / 2 - 2;
        const by = isCircle ? g.y - (g.w / 2) * 0.78 : g.y - g.h / 2 + 2;
        const badgeW = hasBadge ? Math.max(18, textWidth(String(badge), 9, true) + 10) : 0;

        return (
          <g
            key={n.id}
            style={{ transition: "opacity 0.25s ease", opacity, cursor: onNodeClick ? "pointer" : undefined }}
            onClick={onNodeClick ? () => onNodeClick(n.id) : undefined}
          >
            <ShapeOutline shape={g.shape} x={g.x} y={g.y} w={g.w} h={g.h} fill={fill} stroke={stroke} />
            {box.lines.map((line, j) => (
              <SvgLabel
                key={`l${j}`}
                x={g.x + textDx} y={firstY + j * lineH}
                text={line}
                anchor="middle"
                dominantBaseline="central"
                fill={textColor}
                fontSize={box.fontSize}
                fontWeight={isCircle ? 700 : 600}
                fontFamily={isCircle ? MONO : SANS}
                plain={!isCircle}
              />
            ))}
            {box.sublines.map((line, j) => (
              <SvgLabel
                key={`s${j}`}
                x={g.x + textDx} y={firstY + box.lines.length * lineH + j * subH - (lineH - subH) / 2}
                text={line}
                anchor="middle"
                dominantBaseline="central"
                fill={textColor}
                fontSize={box.subFontSize}
                fontWeight={500}
                fontFamily={SANS}
                style={{ opacity: 0.72 }}
                plain
              />
            ))}
            {hasBadge && (
              <>
                <rect
                  x={bx - badgeW / 2} y={by - 9} width={badgeW} height={18} rx={9}
                  fill={DEFAULTS.surface}
                  stroke={isActive ? activeColor : n.color ?? lookupKeyed(nodeColors, n.id) ?? DEFAULTS.border}
                  strokeWidth={1.5}
                />
                <SvgLabel
                  x={bx} y={by}
                  text={badge}
                  anchor="middle"
                  dominantBaseline="central"
                  fill={DEFAULTS.text}
                  fontSize={9}
                  fontWeight={700}
                  fontFamily={MONO}
                />
              </>
            )}
            {ptrs?.map((p, j) => (
              <SvgLabel
                key={`p${j}`}
                x={g.x}
                y={g.y - g.h / 2 - 8 - j * 14}
                text={p.label}
                anchor="middle"
                fill={p.color ?? activeColor}
                fontSize={10}
                fontWeight={600}
                fontFamily={SANS}
              />
            ))}
          </g>
        );
      })}

      {packets.map((p, i) => {
        const de = routeByKey.get(p.edge);
        if (!de) return null;
        const t = p.t ?? progress;
        const at = pointAlong(de.samples, p.reverse ? 1 - t : t);
        const color = p.color ?? activeColor;
        const opacity = p.t === undefined ? arrivalOpacity(t) : 1;
        if (opacity === 0) return null;
        return (
          <g key={`packet-${i}`} style={{ pointerEvents: "none" }} opacity={opacity}>
            <circle cx={at.x} cy={at.y} r={5.5} fill={color} stroke={DEFAULTS.surface} strokeWidth={2} />
            {p.label && (
              <SvgLabel
                x={at.x} y={at.y - 11}
                text={p.label}
                anchor="middle"
                fill={color}
                fontSize={10}
                fontWeight={700}
                fontFamily={SANS}
                halo={DEFAULTS.surface}
                plain
              />
            )}
          </g>
        );
      })}
    </svg>
  );

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "0.5rem 0" }}>
      {zoomable ? <div style={{ width: "100%" }}><ZoomPanel>{svg}</ZoomPanel></div> : svg}
    </div>
  );
}
