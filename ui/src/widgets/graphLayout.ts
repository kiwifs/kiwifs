/**
 * Position graph nodes that don't carry explicit coordinates.
 *
 * Every layout here is deterministic: the same graph always produces the same
 * picture, so a widget stepping through an algorithm never has its nodes jump
 * between frames.
 */

export type GraphLayout = "force" | "circular" | "layered" | "grid";

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
}

export function layoutGraph(
  nodes: LayoutInput[],
  edges: LayoutEdge[],
  { width, height, nodeSize, layout }: Options,
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
    : layout === "layered" ? layered(nodes, edges, width, height, pad)
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

/** BFS depth from the sources becomes the row. Best for DAGs and trees. */
function layered(
  nodes: LayoutInput[],
  edges: LayoutEdge[],
  width: number,
  height: number,
  pad: number,
): Map<string | number, Positioned> {
  const ids = nodes.map((n) => n.id);
  const adjacency = new Map<string | number, (string | number)[]>();
  const indegree = new Map<string | number, number>();
  for (const id of ids) {
    adjacency.set(id, []);
    indegree.set(id, 0);
  }
  for (const e of edges) {
    if (!adjacency.has(e.from) || !adjacency.has(e.to)) continue;
    adjacency.get(e.from)!.push(e.to);
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
  const stepY = depths.length > 1 ? (height - pad * 2) / (depths.length - 1) : 0;
  const out = new Map<string | number, Positioned>();
  depths.forEach((depth, row) => {
    const rowIds = byLevel.get(depth)!;
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
