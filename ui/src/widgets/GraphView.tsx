import { useId, useMemo } from "react";
import yaml from "js-yaml";
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
import { canvasAria, summarizeGraph } from "./widgetA11y";
import { partHandlers, useInspect, whyFor, type InspectRef } from "./inspect";
import { inspectLinked } from "./inspectLinked";

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
  /** Vertices. Nodes without `x`/`y` are placed by `layout`. */
  nodes: GraphNode[];
  /** Connections between node ids. */
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
  /** @deprecated Kept as an alias; prefer `onSelect`, which reports a ref. */
  onNodeClick?: (id: string | number) => void;
  /** Reported when the reader clicks or Enters a node. */
  onSelect?: (ref: InspectRef) => void;
  /** Node id → explanation. Selecting such a node reveals it. */
  why?: Record<string, string>;
  /** On hover, light the nodes with an edge into the hovered one. */
  hoverPredecessors?: boolean;
  /** Name for the inspect bus, so a `link:` can address this graph. */
  widgetId?: string;
  /** Primary highlight color. */
  activeColor?: string;
  /** Secondary highlight color. */
  highlightColor?: string;
  /** Diameter of a circle node in px. Default 36. */
  nodeSize?: number;
  /**
   * Canvas width. Default 400 (for "dagre": the laid-out width). The diagram
   * scales down to fit narrower containers.
   */
  width?: number;
  /** Canvas height. Default 300 (ignored by "dagre", which sizes itself). */
  height?: number;
  /** Accessible name. Defaults to a summary of the nodes, edges and groups. */
  ariaLabel?: string;
  /**
   * Draw the circular backdrop a hash ring needs: a circle with tick marks,
   * with `layout: "circular"` placing nodes on it. Consistent hashing is a
   * graph on a ring, not a widget of its own.
   */
  ring?: boolean | { ticks?: number; labels?: (string | number)[] };
  /**
   * Dots at fixed angles on the ring — virtual nodes, key positions. `at` is
   * a fraction of the circumference (0 at the top, clockwise) or a degree
   * when `degrees` is set.
   */
  tokens?: { at: number; label?: string; color?: string; degrees?: boolean; node?: string | number }[];
  /**
   * Let the reader rearrange the graph. `onChange` receives the whole node and
   * edge list, and the "copy as YAML" button turns a drawn graph into a fence
   * body — which is the point: sketching is faster than typing coordinates.
   */
  editable?: boolean;
  /** With `editable`, receives the whole graph after each change. */
  onChange?: (nodes: GraphNode[], edges: GraphEdge[]) => void;
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
  onSelect,
  why,
  hoverPredecessors = false,
  widgetId = "graph",
  activeColor = DEFAULTS.activeColor,
  highlightColor = DEFAULTS.highlightColor,
  nodeSize = DEFAULTS.nodeSize,
  width,
  height,
  ariaLabel,
  ring,
  tokens,
  editable = false,
  onChange,
}: GraphViewProps) {
  const activeNodes = toSet(activeNodesIn);
  const highlightNodes = toSet(highlightNodesIn);
  const dimNodes = toSet(dimNodesIn);
  const activeEdges = toSet(activeEdgesIn);
  const highlightEdges = toSet(highlightEdgesIn);
  const dimEdges = toSet(dimEdgesIn);
  const bus = useInspect();
  const mergedWhy = { ...bus.why, ...(why ?? {}) };
  const linkedNodes = inspectLinked(bus, widgetId, hoverPredecessors || why !== undefined);
  const clickable = (id: Id) =>
    Boolean(onNodeClick) ||
    onSelect !== undefined ||
    whyFor(mergedWhy, { widget: widgetId, kind: "node", key: String(id) }) !== undefined;
  const firstClickable = String(nodes.find((n) => clickable(n.id))?.id ?? "");
  // Incoming edges are the predecessors; walking them on hover is how a
  // reader sees "what feeds this" without the author listing it again.
  const incoming = new Set<string>();
  if (hoverPredecessors && bus.hovered?.widget === widgetId) {
    for (const e of edges) {
      if (String(e.to) === bus.hovered.key) incoming.add(String(e.from));
    }
  }
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

  // A ring is drawn through the node positions, not at a fixed radius, so it
  // encloses whatever the layout produced.
  const ringGeometry = (() => {
    if (!ring) return null;
    const cx = (bounds.x0 + bounds.x1) / 2;
    const cy = (bounds.y0 + bounds.y1) / 2;
    const r = Math.max(
      20,
      ...[...geom.values()].map((g) => Math.hypot(g.x - cx, g.y - cy)),
    );
    const opts = typeof ring === "object" ? ring : {};
    const tickCount = Math.max(0, Math.min(64, opts.ticks ?? 0));
    /** Fraction of the circumference, 0 at the top, clockwise. */
    const angleOf = (at: number, degrees?: boolean) =>
      (degrees ? (at * Math.PI) / 180 : at * Math.PI * 2) - Math.PI / 2;
    const at = (value: number, degrees?: boolean) => {
      const a = angleOf(value, degrees);
      return {
        x: cx + Math.cos(a) * r,
        y: cy + Math.sin(a) * r,
        lx: cx + Math.cos(a) * (r + 16),
        ly: cy + Math.sin(a) * (r + 16),
      };
    };
    const ticks = Array.from({ length: tickCount }, (_, i) => {
      const a = angleOf(i / tickCount);
      return {
        x1: cx + Math.cos(a) * (r - 5),
        y1: cy + Math.sin(a) * (r - 5),
        x2: cx + Math.cos(a) * (r + 5),
        y2: cy + Math.sin(a) * (r + 5),
        lx: cx + Math.cos(a) * (r + 17),
        ly: cy + Math.sin(a) * (r + 17),
        label: opts.labels?.[i],
      };
    });
    return { cx, cy, r, ticks, at };
  })();

  const svg = (
    <svg
      width={Math.round(displayW)}
      height={Math.round(displayH)}
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      style={{ display: "block", maxWidth: "100%", height: "auto" }}
      {...canvasAria(
        ariaLabel ?? summarizeGraph({ nodes, edges, directed, groups }),
        Boolean(onNodeClick) || onSelect !== undefined || Object.keys(mergedWhy).length > 0,
      )}
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

      {/* The hash ring, behind everything: a circle through the laid-out
          nodes, with ticks, so a position on the ring reads as a position. */}
      {ringGeometry && (
        <g>
          <circle
            cx={ringGeometry.cx}
            cy={ringGeometry.cy}
            r={ringGeometry.r}
            fill="none"
            stroke={DEFAULTS.border}
            strokeWidth={1.5}
            strokeDasharray="2 5"
            opacity={0.65}
          />
          {ringGeometry.ticks.map((tick, i) => (
            <g key={`tick${i}`}>
              <line
                x1={tick.x1}
                y1={tick.y1}
                x2={tick.x2}
                y2={tick.y2}
                stroke={DEFAULTS.border}
                strokeWidth={1}
                opacity={0.8}
              />
              {tick.label != null && (
                <SvgLabel
                  x={tick.lx}
                  y={tick.ly}
                  text={tick.label}
                  anchor="middle"
                  dominantBaseline="central"
                  fill={DEFAULTS.dimColor}
                  fontSize={9}
                  fontFamily={MONO}
                />
              )}
            </g>
          ))}
        </g>
      )}

      {/* Tokens: virtual nodes and key positions on the ring */}
      {ringGeometry &&
        (tokens ?? []).map((token, i) => {
          const point = ringGeometry.at(token.at, token.degrees);
          return (
            <g key={`token${i}`}>
              <circle cx={point.x} cy={point.y} r={4} fill={token.color ?? activeColor} />
              {token.label && (
                <SvgLabel
                  x={point.lx}
                  y={point.ly}
                  text={token.label}
                  anchor="middle"
                  dominantBaseline="central"
                  fill={token.color ?? activeColor}
                  fontSize={10}
                  fontWeight={700}
                  fontFamily={MONO}
                  halo={DEFAULTS.surface}
                />
              )}
            </g>
          );
        })}

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

        // A hovered node's feeders, and whatever a linked widget is pointing
        // at, get a ring even when the author highlighted nothing. The ring is
        // drawn outside the node so the author's active/dim styling survives.
        const isLinked = incoming.has(String(n.id)) || linkedNodes.has(String(n.id));

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
            {...(clickable(n.id)
              ? partHandlers(widgetId, "node", String(n.id), bus, {
                  why: mergedWhy,
                  tabbable: String(n.id) === firstClickable,
                  onSelect: (ref) => {
                    onSelect?.(ref);
                    onNodeClick?.(n.id);
                  },
                })
              : {})}
            style={{
              transition: "opacity 0.25s ease",
              opacity,
              cursor: clickable(n.id) ? "pointer" : undefined,
            }}
          >
            {isLinked && (
              <ShapeOutline shape={g.shape} x={g.x} y={g.y} w={g.w + 8} h={g.h + 8} fill="none" stroke={highlightColor} />
            )}
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
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "0.5rem 0" }}>
      {zoomable ? <div style={{ width: "100%" }}><ZoomPanel>{svg}</ZoomPanel></div> : svg}
      {editable && (
        // Sketching a graph beats typing coordinates, and this is what turns
        // the sketch into a fence body the author can paste back into the page.
        <button
          type="button"
          onClick={() => {
            const laidOut = nodes.map((n) => {
              const g = geom.get(n.id);
              return g ? { ...n, x: Math.round(g.x), y: Math.round(g.y) } : n;
            });
            void navigator.clipboard?.writeText(graphToYAML(laidOut, edges, directed));
            onChange?.(laidOut, [...edges]);
          }}
          style={{
            marginTop: 6,
            fontSize: "0.68rem",
            fontWeight: 600,
            padding: "2px 8px",
            borderRadius: 4,
            border: `1px solid ${DEFAULTS.border}`,
            background: "transparent",
            color: DEFAULTS.dimColor,
            cursor: "pointer",
          }}
          title="Copy these nodes and edges as a ```graph fence body"
        >
          Copy as YAML
        </button>
      )}
    </div>
  );
}

/** The current graph as a `graph` fence body, with positions baked in. */
export function graphToYAML(nodes: GraphNode[], edges: GraphEdge[], directed: boolean): string {
  const pick = (entries: [string, unknown][]) =>
    Object.fromEntries(entries.filter(([, v]) => v !== undefined));
  const doc: Record<string, unknown> = {};
  if (directed) doc.directed = true;
  doc.nodes = nodes.map((n) =>
    pick([
      ["id", n.id],
      ["label", n.label],
      ["sublabel", n.sublabel],
      ["shape", n.shape],
      ["x", n.x === undefined ? undefined : Math.round(n.x)],
      ["y", n.y === undefined ? undefined : Math.round(n.y)],
      ["group", n.group],
    ]),
  );
  if (edges.length > 0) {
    doc.edges = edges.map((e) =>
      pick([
        ["from", e.from],
        ["to", e.to],
        ["label", e.label],
        ["weight", e.weight],
        ["style", e.style],
      ]),
    );
  }
  // js-yaml quotes whatever YAML would otherwise retype (`007`, `true`, `no`,
  // `~`, `a: b`), so the pasted body reads back as the same strings.
  return yaml.dump(doc, { flowLevel: 2, lineWidth: -1 });
}
