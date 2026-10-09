/**
 * Pure geometry for node-and-edge diagrams: label measurement, node sizing per
 * shape, boundary clipping, curved/parallel edge routing, and sampling a route
 * so labels and moving packets can sit at any fraction of its length.
 *
 * Text is measured with a per-glyph width table rather than the DOM, so layout
 * is identical in tests, on the server, and in every browser.
 */

export interface Point {
  x: number;
  y: number;
}

export type NodeShape =
  | "circle"
  | "box"
  | "pill"
  | "diamond"
  | "cylinder"
  | "queue"
  | "person"
  | "cloud"
  | "hexagon";

export const NODE_SHAPES: readonly NodeShape[] = [
  "circle", "box", "pill", "diamond", "cylinder", "queue", "person", "cloud", "hexagon",
];

const NARROW = new Set("iljtfr.,:;'|!()[]{} I1".split(""));
const WIDE = new Set("mwMW@%".split(""));

/** Approximate rendered width of `text` in px. */
export function textWidth(text: string, fontSize: number, mono = false): number {
  if (mono) return text.length * fontSize * 0.61;
  let em = 0;
  for (const ch of text) {
    if (NARROW.has(ch)) em += 0.32;
    else if (WIDE.has(ch)) em += 0.86;
    else if (ch >= "A" && ch <= "Z") em += 0.66;
    else if (ch >= "0" && ch <= "9") em += 0.57;
    else if (ch.charCodeAt(0) > 0x2000) em += 1.0;
    else em += 0.55;
  }
  return em * fontSize;
}

/** Break on explicit newlines, then greedily on spaces to fit `maxWidth`. */
export function wrapText(text: string, fontSize: number, maxWidth: number, mono = false): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push("");
      continue;
    }
    let line = words[0]!;
    for (const word of words.slice(1)) {
      const next = `${line} ${word}`;
      if (textWidth(next, fontSize, mono) <= maxWidth) line = next;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

export interface NodeBoxInput {
  label: string;
  sublabel?: string;
  shape: NodeShape;
  /** Minimum size: the diameter for circles, the height for other shapes. */
  nodeSize: number;
  width?: number;
  height?: number;
}

export interface NodeBox {
  w: number;
  h: number;
  lines: string[];
  sublines: string[];
  fontSize: number;
  subFontSize: number;
  lineHeight: number;
  /** Vertical offset of the text block's centre from the node centre. */
  textDy: number;
}

const LABEL_MAX = 150;

export function measureNode({ label, sublabel, shape, nodeSize, width, height }: NodeBoxInput): NodeBox {
  if (shape === "circle") {
    const fontSize = nodeSize > 32 ? 13 : 11;
    const lines = label.split(/\n/);
    const tw = Math.max(...lines.map((l) => textWidth(l, fontSize, true)));
    // Keep the author's size unless the label would spill; then grow, capped.
    const d = width ?? Math.min(Math.max(nodeSize, tw + 10), nodeSize * 2.2);
    return {
      w: d, h: height ?? d, lines, sublines: [], fontSize, subFontSize: 10,
      lineHeight: fontSize + 2, textDy: 0,
    };
  }

  const fontSize = 13;
  const subFontSize = 11;
  const lineHeight = 16;
  const lines = wrapText(label, fontSize, LABEL_MAX);
  const sublines = sublabel ? wrapText(sublabel, subFontSize, LABEL_MAX) : [];
  const tw = Math.max(
    ...lines.map((l) => textWidth(l, fontSize)),
    ...sublines.map((l) => textWidth(l, subFontSize)),
    0,
  );
  const th = lines.length * lineHeight + sublines.length * (subFontSize + 3);

  let w = tw + 24;
  let h = th + 14;
  let textDy = 0;
  switch (shape) {
    case "pill":
      w = tw + h;
      break;
    case "diamond":
      w = tw * 1.5 + 28;
      h = th * 1.9 + 16;
      break;
    case "hexagon":
      w = tw + 24 + h * 0.6;
      break;
    case "cylinder":
      h = th + 30;
      textDy = 4;
      break;
    case "queue":
      w = tw + 44;
      break;
    case "cloud":
      w = tw * 1.3 + 36;
      h = th * 1.6 + 22;
      break;
    case "person":
      w = Math.max(tw + 8, 40);
      h = th + 34;
      textDy = 15;
      break;
    default:
      break;
  }
  w = Math.max(w, nodeSize * 1.6);
  h = Math.max(h, Math.min(nodeSize, 40));
  return {
    w: width ?? Math.ceil(w), h: height ?? Math.ceil(h), lines, sublines, fontSize, subFontSize,
    lineHeight, textDy,
  };
}

export interface NodeGeom {
  x: number;
  y: number;
  w: number;
  h: number;
  shape: NodeShape;
}

/** Where the ray from the node centre toward `toward` leaves the node. */
export function boundaryPoint(node: NodeGeom, toward: Point): Point {
  const dx = toward.x - node.x;
  const dy = toward.y - node.y;
  if (dx === 0 && dy === 0) return { x: node.x, y: node.y };
  const hw = node.w / 2;
  const hh = node.h / 2;
  let t: number;
  if (node.shape === "circle") {
    t = hw / Math.hypot(dx, dy);
  } else if (node.shape === "diamond") {
    t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  } else if (node.shape === "cloud") {
    // An ellipse is close enough to the cloud's outer bumps.
    t = 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh));
  } else {
    t = Math.min(dx === 0 ? Infinity : hw / Math.abs(dx), dy === 0 ? Infinity : hh / Math.abs(dy));
  }
  return { x: node.x + dx * t, y: node.y + dy * t };
}

/**
 * Bend per edge so parallel and opposite edges between the same pair fan out
 * instead of drawing on top of each other. Single edges get 0 (straight).
 */
export function parallelBends(
  edges: { from: string | number; to: string | number }[],
  spacing = 28,
): number[] {
  const groups = new Map<string, number[]>();
  edges.forEach((e, i) => {
    if (e.from === e.to) return;
    const [a, b] = [String(e.from), String(e.to)].sort();
    const key = `${a}\u0000${b}`;
    const list = groups.get(key) ?? [];
    list.push(i);
    groups.set(key, list);
  });
  const bends = edges.map(() => 0);
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const canonFrom = String(edges[list[0]!]!.from);
    list.forEach((edgeIndex, k) => {
      const canon = (k - (list.length - 1) / 2) * spacing;
      const reversed = String(edges[edgeIndex]!.from) !== canonFrom;
      bends[edgeIndex] = reversed ? -canon : canon;
    });
  }
  return bends;
}

export interface EdgeRoute {
  d: string;
  /** Flattened polyline along the drawn curve, for labels and packets. */
  samples: Point[];
  start: Point;
  end: Point;
}

function normal(a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: -dy / len, y: dx / len };
}

function quad(p0: Point, c: Point, p1: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
    y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
  };
}

const fmt = (n: number) => Math.round(n * 10) / 10;

/**
 * Route an edge between two nodes. `via` are optional interior waypoints (from
 * a layered layout); `bend` pushes the curve sideways, in px, along the
 * from → to normal. `gap` leaves room at the end, e.g. for an arrowhead.
 */
export function routeEdge(
  from: NodeGeom,
  to: NodeGeom,
  { via = [], bend = 0, startGap = 0, endGap = 0 }: { via?: Point[]; bend?: number; startGap?: number; endGap?: number } = {},
): EdgeRoute {
  const center = (n: NodeGeom) => ({ x: n.x, y: n.y });
  let interior: Point[];
  if (via.length > 0) {
    const n = normal(center(from), center(to));
    interior = via.map((p) => ({ x: p.x + n.x * bend, y: p.y + n.y * bend }));
  } else if (bend !== 0) {
    const n = normal(center(from), center(to));
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    // A quadratic through `mid + n·bend` has its control at twice the offset.
    interior = [{ x: mid.x + n.x * bend * 2, y: mid.y + n.y * bend * 2 }];
  } else {
    interior = [];
  }

  const shrink = (p: Point, toward: Point, gap: number) => {
    if (gap === 0) return p;
    const dx = toward.x - p.x;
    const dy = toward.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * gap, y: p.y + (dy / len) * gap };
  };
  const firstToward = interior[0] ?? center(to);
  const lastToward = interior[interior.length - 1] ?? center(from);
  const start = shrink(boundaryPoint(from, firstToward), firstToward, startGap);
  const end = shrink(boundaryPoint(to, lastToward), lastToward, endGap);

  const samples: Point[] = [];
  let d: string;
  if (interior.length === 0) {
    d = `M ${fmt(start.x)} ${fmt(start.y)} L ${fmt(end.x)} ${fmt(end.y)}`;
    samples.push(start, end);
  } else if (interior.length === 1 && via.length === 0) {
    const c = interior[0]!;
    d = `M ${fmt(start.x)} ${fmt(start.y)} Q ${fmt(c.x)} ${fmt(c.y)} ${fmt(end.x)} ${fmt(end.y)}`;
    for (let i = 0; i <= 16; i++) samples.push(quad(start, c, end, i / 16));
  } else {
    // Smooth through the waypoints: each waypoint is a control point and the
    // curve passes through the midpoints between them.
    const pts = [start, ...interior, end];
    d = `M ${fmt(start.x)} ${fmt(start.y)}`;
    samples.push(start);
    let cursor = start;
    for (let i = 1; i < pts.length - 1; i++) {
      const c = pts[i]!;
      const next = i === pts.length - 2 ? pts[i + 1]! : { x: (c.x + pts[i + 1]!.x) / 2, y: (c.y + pts[i + 1]!.y) / 2 };
      d += ` Q ${fmt(c.x)} ${fmt(c.y)} ${fmt(next.x)} ${fmt(next.y)}`;
      for (let s = 1; s <= 8; s++) samples.push(quad(cursor, c, next, s / 8));
      cursor = next;
    }
  }
  return { d, samples, start, end };
}

/** Point (and heading, in degrees) at fraction `t` of a sampled route's length. */
export function pointAlong(samples: Point[], t: number): Point & { angle: number } {
  if (samples.length === 0) return { x: 0, y: 0, angle: 0 };
  if (samples.length === 1) return { ...samples[0]!, angle: 0 };
  const lengths = [0];
  for (let i = 1; i < samples.length; i++) {
    lengths.push(lengths[i - 1]! + Math.hypot(samples[i]!.x - samples[i - 1]!.x, samples[i]!.y - samples[i - 1]!.y));
  }
  const total = lengths[lengths.length - 1]!;
  const target = Math.min(1, Math.max(0, t)) * total;
  let i = 1;
  while (i < samples.length - 1 && lengths[i]! < target) i++;
  const a = samples[i - 1]!;
  const b = samples[i]!;
  const seg = lengths[i]! - lengths[i - 1]! || 1;
  const f = (target - lengths[i - 1]!) / seg;
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
  };
}
