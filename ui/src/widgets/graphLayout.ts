/**
 * Position graph nodes that don't carry explicit coordinates.
 *
 * Every layout here is deterministic: the same graph always produces the same
 * picture, so a widget stepping through an algorithm never has its nodes jump
 * between frames.
 */

import dagre from "@dagrejs/dagre";

/**
 * `"dagre"` is a full layered layout (Sugiyama via dagre): nodes keep their
 * measured size, edges get routed waypoints, edge labels get reserved space,
 * and groups stay together. Use it for architecture and flow diagrams.
 */
export type GraphLayout = "force" | "circular" | "layered" | "grid" | "dagre";

export type GraphDirection = "TB" | "BT" | "LR" | "RL";

export interface DagreNodeInput {
  id: string | number;
  w: number;
  h: number;
}

export interface DagreEdgeInput {
  from: string | number;
  to: string | number;
  labelW?: number;
  labelH?: number;
}

export interface DagreGroupInput {
  id: string;
  nodes: (string | number)[];
  parent?: string;
}

export interface DagreResult {
  nodes: Map<string | number, Positioned>;
  /** Interior waypoints per input edge (endpoints excluded); empty for self-loops. */
  routes: Positioned[][];
  /** Reserved label centre per input edge, when it had a label size. */
  labels: (Positioned | null)[];
  width: number;
  height: number;
}

const GROUP_PREFIX = "\u0000group:";

export function layoutDagre(
  nodes: DagreNodeInput[],
  edges: DagreEdgeInput[],
  {
    direction = "TB",
    groups = [],
    nodeSep = 36,
    rankSep = 52,
    margin = 16,
  }: { direction?: GraphDirection; groups?: DagreGroupInput[]; nodeSep?: number; rankSep?: number; margin?: number } = {},
): DagreResult {
  const compound = groups.length > 0;
  const g = new dagre.graphlib.Graph({ multigraph: true, compound });
  g.setGraph({ rankdir: direction, nodesep: nodeSep, ranksep: rankSep, edgesep: 14, marginx: margin, marginy: margin });
  g.setDefaultEdgeLabel(() => ({}));

  const key = new Map<string, string | number>();
  for (const n of nodes) {
    key.set(String(n.id), n.id);
    g.setNode(String(n.id), { width: n.w, height: n.h });
  }
  if (compound) {
    for (const grp of groups) g.setNode(GROUP_PREFIX + grp.id, {});
    for (const grp of groups) {
      if (grp.parent) g.setParent(GROUP_PREFIX + grp.id, GROUP_PREFIX + grp.parent);
      for (const id of grp.nodes) if (key.has(String(id))) g.setParent(String(id), GROUP_PREFIX + grp.id);
    }
  }
  edges.forEach((e, i) => {
    if (e.from === e.to || !key.has(String(e.from)) || !key.has(String(e.to))) return;
    const label = e.labelW ? { width: e.labelW, height: e.labelH ?? 16, labelpos: "c" } : {};
    g.setEdge(String(e.from), String(e.to), label, String(i));
  });

  dagre.layout(g);

  const out = new Map<string | number, Positioned>();
  for (const n of nodes) {
    const p = g.node(String(n.id));
    out.set(n.id, { x: p?.x ?? 0, y: p?.y ?? 0 });
  }
  const routes: Positioned[][] = [];
  const labels: (Positioned | null)[] = [];
  edges.forEach((e, i) => {
    const data = g.edge({ v: String(e.from), w: String(e.to), name: String(i) }) as
      | { points?: Positioned[]; x?: number; y?: number }
      | undefined;
    const pts = data?.points ?? [];
    routes.push(pts.length > 2 ? pts.slice(1, -1).map((p) => ({ x: p.x, y: p.y })) : []);
    labels.push(e.labelW && data?.x !== undefined && data?.y !== undefined ? { x: data.x, y: data.y } : null);
  });
  const graph = g.graph() as { width?: number; height?: number };
  return { nodes: out, routes, labels, width: graph.width ?? 0, height: graph.height ?? 0 };
}

interface LayoutInput {
  id: string | number;
  x?: number;
  y?: number;
}

interface LayoutEdge {
  from: string | number;
  to: string | number;
}

export interface Positioned {
  x: number;
  y: number;
}

interface Options {
  width: number;
  height: number;
  nodeSize: number;
  layout: GraphLayout;
  /** Layered only: which way edges point down the page. Default "down". */
  flow?: "down" | "up";
}

export function layoutGraph(
  nodes: LayoutInput[],
  edges: LayoutEdge[],
  { width, height, nodeSize, layout, flow = "down" }: Options,
): Map<string | number, Positioned> {
  const pad = nodeSize;
  const placed = new Map<string | number, Positioned>();
  for (const n of nodes) {
    if (n.x !== undefined && n.y !== undefined) placed.set(n.id, { x: n.x, y: n.y });
  }

  const free = nodes.filter((n) => !placed.has(n.id));
  if (free.length === 0) return placed;

  // A partially positioned graph is almost always a mistake in authoring, but
  // laying the rest out relative to the whole node list keeps it readable.
  const positions =
    layout === "circular" ? circular(nodes, width, height, pad)
    : layout === "grid" ? grid(nodes, width, height, pad)
    : layout === "layered" || layout === "dagre" ? layered(nodes, edges, width, height, pad, flow)
    : force(nodes, edges, width, height, pad);

  for (const n of free) {
    const p = positions.get(n.id);
    if (p) placed.set(n.id, p);
  }
  return placed;
}

function circular(
  nodes: LayoutInput[],
  width: number,
  height: number,
  pad: number,
): Map<string | number, Positioned> {
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.max(20, Math.min(width, height) / 2 - pad);
  const out = new Map<string | number, Positioned>();
  nodes.forEach((n, i) => {
    // Start at the top and go clockwise, which reads like a clock face.
    const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
    out.set(n.id, { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  });
  return out;
}

function grid(
  nodes: LayoutInput[],
  width: number,
  height: number,
  pad: number,
): Map<string | number, Positioned> {
  const cols = Math.ceil(Math.sqrt(nodes.length));
  const rows = Math.ceil(nodes.length / cols);
  const stepX = cols > 1 ? (width - pad * 2) / (cols - 1) : 0;
  const stepY = rows > 1 ? (height - pad * 2) / (rows - 1) : 0;
  const out = new Map<string | number, Positioned>();
  nodes.forEach((n, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    out.set(n.id, {
      x: cols > 1 ? pad + c * stepX : width / 2,
      y: rows > 1 ? pad + r * stepY : height / 2,
    });
  });
  return out;
}

/**
 * Reorder each row by the mean position of its neighbours in the row above
 * (then below), a few sweeps each way. Fewer crossings, same determinism:
 * ties keep their current order.
 */
function reduceCrossings(
  rows: (string | number)[][],
  neighbours: Map<string | number, (string | number)[]>,
): void {
  const indexIn = (row: (string | number)[]) =>
    new Map<string | number, number>(row.map((id, i) => [id, i]));
  const reorder = (r: number, ref: number) => {
    const refIndex = indexIn(rows[ref]!);
    const row = rows[r]!;
    const scored = row.map((id, i) => {
      const ns = (neighbours.get(id) ?? []).filter((n) => refIndex.has(n));
      const bary = ns.length ? ns.reduce<number>((s, n) => s + refIndex.get(n)!, 0) / ns.length : i;
      return { id, bary, i };
    });
    scored.sort((a, b) => a.bary - b.bary || a.i - b.i);
    rows[r] = scored.map((s) => s.id);
  };
  for (let sweep = 0; sweep < 4; sweep++) {
    for (let r = 1; r < rows.length; r++) reorder(r, r - 1);
    for (let r = rows.length - 2; r >= 0; r--) reorder(r, r + 1);
  }
}

/**
 * BFS depth from the sources becomes the row. Best for DAGs and trees.
 * `flow: "up"` ranks from edge targets instead, so child → parent pointers
 * draw with the parent on top. Self-loops never affect the ranking.
 */
function layered(
  nodes: LayoutInput[],
  allEdges: LayoutEdge[],
  width: number,
  height: number,
  pad: number,
  flow: "down" | "up",
): Map<string | number, Positioned> {
  const edges = allEdges
    .filter((e) => e.from !== e.to)
    .map((e) => (flow === "up" ? { from: e.to, to: e.from } : e));
  const ids = nodes.map((n) => n.id);
  const adjacency = new Map<string | number, (string | number)[]>();
  const neighbours = new Map<string | number, (string | number)[]>();
  const indegree = new Map<string | number, number>();
  for (const id of ids) {
    adjacency.set(id, []);
    neighbours.set(id, []);
    indegree.set(id, 0);
  }
  for (const e of edges) {
    if (!adjacency.has(e.from) || !adjacency.has(e.to)) continue;
    adjacency.get(e.from)!.push(e.to);
    neighbours.get(e.from)!.push(e.to);
    neighbours.get(e.to)!.push(e.from);
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
  }

  const sources = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
  const level = new Map<string | number, number>();
  const queue = sources.length > 0 ? [...sources] : [ids[0]!];
  for (const id of queue) level.set(id, 0);

  for (let head = 0; head < queue.length; head++) {
    const id = queue[head]!;
    const depth = level.get(id)!;
    for (const next of adjacency.get(id) ?? []) {
      if (level.has(next)) continue;
      level.set(next, depth + 1);
      queue.push(next);
    }
  }
  // Anything unreachable (a second component, or a pure cycle) goes below.
  const maxReached = Math.max(0, ...level.values());
  for (const id of ids) if (!level.has(id)) level.set(id, maxReached + 1);

  const byLevel = new Map<number, (string | number)[]>();
  for (const id of ids) {
    const depth = level.get(id)!;
    const list = byLevel.get(depth) ?? [];
    list.push(id);
    byLevel.set(depth, list);
  }

  const depths = [...byLevel.keys()].sort((a, b) => a - b);
  const rows = depths.map((d) => byLevel.get(d)!);
  reduceCrossings(rows, neighbours);
  const stepY = depths.length > 1 ? (height - pad * 2) / (depths.length - 1) : 0;
  const out = new Map<string | number, Positioned>();
  depths.forEach((_depth, row) => {
    const rowIds = rows[row]!;
    const stepX = rowIds.length > 1 ? (width - pad * 2) / (rowIds.length - 1) : 0;
    rowIds.forEach((id, i) => {
      out.set(id, {
        x: rowIds.length > 1 ? pad + i * stepX : width / 2,
        y: depths.length > 1 ? pad + row * stepY : height / 2,
      });
    });
  });
  return out;
}

/**
 * Fruchterman-Reingold, seeded from a circle so the result is reproducible.
 * On a small cycle this settles back into a regular polygon, which is what you
 * want for a teaching diagram.
 */
function force(
  nodes: LayoutInput[],
  edges: LayoutEdge[],
  width: number,
  height: number,
  pad: number,
): Map<string | number, Positioned> {
  const n = nodes.length;
  if (n === 1) return new Map([[nodes[0]!.id, { x: width / 2, y: height / 2 }]]);

  const pos = circular(nodes, width, height, pad);
  const index = new Map(nodes.map((node, i) => [node.id, i]));
  const px = nodes.map((node) => pos.get(node.id)!.x);
  const py = nodes.map((node) => pos.get(node.id)!.y);

  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const k = Math.sqrt((innerW * innerH) / n);
  const iterations = 300;
  let temperature = Math.min(innerW, innerH) / 6;
  const cooling = temperature / (iterations + 1);

  const links = edges
    .map((e) => [index.get(e.from), index.get(e.to)] as const)
    .filter((pair): pair is readonly [number, number] => pair[0] !== undefined && pair[1] !== undefined);

  const dx = new Array<number>(n);
  const dy = new Array<number>(n);

  for (let step = 0; step < iterations; step++) {
    dx.fill(0);
    dy.fill(0);

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let deltaX = px[i]! - px[j]!;
        let deltaY = py[i]! - py[j]!;
        let dist = Math.hypot(deltaX, deltaY);
        if (dist < 0.01) {
          // Perfectly coincident nodes have no direction to separate along;
          // nudge them apart deterministically by index.
          deltaX = (i - j) * 0.01;
          deltaY = 0.01;
          dist = Math.hypot(deltaX, deltaY);
        }
        const repulsion = (k * k) / dist;
        dx[i]! += (deltaX / dist) * repulsion;
        dy[i]! += (deltaY / dist) * repulsion;
        dx[j]! -= (deltaX / dist) * repulsion;
        dy[j]! -= (deltaY / dist) * repulsion;
      }
    }

    for (const [a, b] of links) {
      if (a === b) continue;
      const deltaX = px[a]! - px[b]!;
      const deltaY = py[a]! - py[b]!;
      const dist = Math.max(0.01, Math.hypot(deltaX, deltaY));
      const attraction = (dist * dist) / k;
      dx[a]! -= (deltaX / dist) * attraction;
      dy[a]! -= (deltaY / dist) * attraction;
      dx[b]! += (deltaX / dist) * attraction;
      dy[b]! += (deltaY / dist) * attraction;
    }

    for (let i = 0; i < n; i++) {
      const disp = Math.max(0.01, Math.hypot(dx[i]!, dy[i]!));
      const limited = Math.min(disp, temperature);
      px[i]! += (dx[i]! / disp) * limited;
      py[i]! += (dy[i]! / disp) * limited;
      px[i] = Math.min(width - pad, Math.max(pad, px[i]!));
      py[i] = Math.min(height - pad, Math.max(pad, py[i]!));
    }
    temperature -= cooling;
  }

  const out = new Map<string | number, Positioned>();
  nodes.forEach((node, i) => out.set(node.id, { x: px[i]!, y: py[i]! }));
  return out;
}
