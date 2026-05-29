// Knowledge graph — react-force-graph 3D + d3-force.
// Nodes = markdown pages, edges = [[wiki-link]] references.
// Features: community coloring, PageRank sizing, hover glow, search highlight,
// directory/tag filtering, shortest-path finder, zoom-adaptive labels.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Loader2,
  Maximize2,
  Route,
  Search as SearchIcon,
  Tag,
} from "lucide-react";
import ForceGraph2D, { type ForceGraphMethods as ForceGraph2DMethods } from "react-force-graph-2d";
import ForceGraph3D, { type ForceGraphMethods as ForceGraph3DMethods } from "react-force-graph-3d";
import * as THREE from "three";
import { api, type GraphResponse, type TreeEntry } from "@kw/lib/api";
import { buildResolver } from "@kw/lib/wikiLinks";
import { titleize } from "@kw/lib/paths";
import { cn } from "@kw/lib/cn";
import { getGraphPerformanceProfile, type GraphPerformanceProfile } from "@kw/lib/graphPerformance";
import {
  readKiwiGraphTheme,
  type KiwiGraphTheme,
} from "@kw/lib/kiwiGraphTheme";
import {
  communityPalette,
  computePageRank,
  pagerankToSize,
} from "@kw/lib/graphAnalytics";
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import { Button } from "@kw/components/ui/button";
import { Card } from "@kw/components/ui/card";
import { Input } from "@kw/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@kw/components/ui/select";

type Props = {
  tree: TreeEntry | null;
  activePath?: string | null;
  onNavigate: (path: string) => void;
  onClose: () => void;
};

type GraphMode = "2d" | "3d";

type GraphApi = {
  d3Force: (forceName: string) =>
    | { strength?: (value: number) => unknown; distanceMax?: (value: number) => unknown; distance?: (value: number) => unknown }
    | undefined;
  zoomToFit: (durationMs?: number, padding?: number, nodeFilter?: (node: GNode) => boolean) => unknown;
};

// ── Internal node/link types for the simulation ──────────────────────────────

interface GNode {
  id: string;
  label: string;
  dir: string;
  tags: string[];
  community: number;
  pagerank: number;
  radius: number;
  color: string;
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  fx?: number;
  fy?: number;
  fz?: number;
}

interface GLink {
  source: string | GNode;
  target: string | GNode;
}


function createNodeLabelSprite(label: string, isDark: boolean): THREE.Sprite {
  const paddingX = 16;
  const paddingY = 8;
  const fontSize = 28;
  const font = `${fontSize}px Sans-Serif`;
  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d")!;
  measureCtx.font = font;
  const textWidth = Math.ceil(measureCtx.measureText(label).width);
  const width = Math.max(64, textWidth + paddingX * 2);
  const height = fontSize + paddingY * 2;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const radius = 10;
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(width - radius, 0);
  ctx.quadraticCurveTo(width, 0, width, radius);
  ctx.lineTo(width, height - radius);
  ctx.quadraticCurveTo(width, height, width - radius, height);
  ctx.lineTo(radius, height);
  ctx.quadraticCurveTo(0, height, 0, height - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.closePath();
  ctx.fillStyle = isDark ? "rgba(15,23,42,0.86)" : "rgba(255,255,255,0.86)";
  ctx.fill();
  ctx.strokeStyle = isDark ? "rgba(148,163,184,0.42)" : "rgba(30,41,59,0.22)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = isDark ? "rgba(255,255,255,0.92)" : "rgba(15,23,42,0.9)";
  ctx.fillText(label, width / 2, height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  const scale = 0.08;
  sprite.scale.set(width * scale, height * scale, 1);
  return sprite;
}

function topDir(path: string): string {
  const i = path.indexOf("/");
  return i < 0 ? "(root)" : path.slice(0, i);
}

// ── Build graph data from API response ───────────────────────────────────────

type BuiltGraph = {
  nodes: GNode[];
  links: GLink[];
  dirs: string[];
  tags: string[];
  communityMap: Map<number, { color: string; count: number; topDir: string }>;
  performance: GraphPerformanceProfile;
};

function buildGraphData(
  resp: GraphResponse,
  tree: TreeEntry | null,
  theme: KiwiGraphTheme,
  sizeByPageRank: boolean,
  colorByCommunity: boolean,
): BuiltGraph {
  const g = new Graph({ type: "undirected", multi: false });
  const resolver = buildResolver(tree);
  const tagSet = new Set<string>();
  const dirSet = new Set<string>();

  for (const n of resp.nodes) {
    g.addNode(n.path, {});
    dirSet.add(topDir(n.path));
    if (n.tags) n.tags.forEach((t) => tagSet.add(t));
  }

  for (const e of resp.edges) {
    if (!g.hasNode(e.source)) continue;
    const resolved = resolver(e.target);
    if (!resolved || !g.hasNode(resolved) || resolved === e.source) continue;
    if (!g.hasEdge(e.source, resolved)) g.addEdge(e.source, resolved);
  }

  const prScores = computePageRank(g);
  const maxPR = Math.max(...Array.from(prScores.values()), 0);

  let communities = new Map<string, number>();
  if (g.size > 0) {
    try {
      const raw = louvain(g);
      communities = new Map(
        Object.entries(raw).map(([k, v]) => [k, v as number]),
      );
    } catch {}
  }

  const communityDirCounts = new Map<
    number,
    { color: string; count: number; dirs: Map<string, number> }
  >();

  const nodes: GNode[] = resp.nodes.map((n) => {
    const pr = prScores.get(n.path) ?? 0;
    const comm = communities.get(n.path) ?? 0;
    const color = communityPalette(comm);
    const dir = topDir(n.path);

    if (!communityDirCounts.has(comm)) {
      communityDirCounts.set(comm, {
        color,
        count: 0,
        dirs: new Map(),
      });
    }
    const cd = communityDirCounts.get(comm)!;
    cd.count++;
    cd.dirs.set(dir, (cd.dirs.get(dir) || 0) + 1);

    const radius = sizeByPageRank && maxPR > 0
      ? pagerankToSize(pr, maxPR, 4, 18)
      : Math.max(4, Math.min(14, 4 + Math.sqrt(g.hasNode(n.path) ? g.degree(n.path) : 0) * 2));

    const nodeColor = colorByCommunity ? color : (theme.defaultNode || "#7c8a6e");

    return {
      id: n.path,
      label: titleize(n.path),
      dir,
      tags: n.tags || [],
      community: comm,
      pagerank: pr,
      radius,
      color: nodeColor,
    };
  });

  const nodeIds = new Set(nodes.map((n) => n.id));
  const links: GLink[] = [];
  const seen = new Set<string>();
  for (const e of resp.edges) {
    if (!nodeIds.has(e.source)) continue;
    const resolved = resolver(e.target);
    if (!resolved || !nodeIds.has(resolved) || resolved === e.source) continue;
    const key = [e.source, resolved].sort().join("||");
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ source: e.source, target: resolved });
  }

  const communityMap = new Map<
    number,
    { color: string; count: number; topDir: string }
  >();
  for (const [idx, { color, count, dirs }] of communityDirCounts) {
    const topDirEntry =
      Array.from(dirs.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ??
      "unknown";
    communityMap.set(idx, { color, count, topDir: topDirEntry });
  }

  return {
    nodes,
    links,
    dirs: Array.from(dirSet).sort(),
    tags: Array.from(tagSet).sort(),
    communityMap,
    performance: getGraphPerformanceProfile(nodes.length),
  };
}

// ── Shortest path (BFS on adjacency) ─────────────────────────────────────────

function bfsPath(
  adj: Map<string, Set<string>>,
  from: string,
  to: string,
): string[] {
  if (from === to) return [from];
  const visited = new Set<string>([from]);
  const queue: [string, string[]][] = [[from, [from]]];
  while (queue.length > 0) {
    const [node, path] = queue.shift()!;
    for (const neighbor of adj.get(node) || []) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      const newPath = [...path, neighbor];
      if (neighbor === to) return newPath;
      queue.push([neighbor, newPath]);
    }
  }
  return [];
}

// ═════════════════════════════════════════════════════════════════════════════
// Main component
// ═════════════════════════════════════════════════════════════════════════════

export function KiwiGraph({ tree, activePath, onNavigate, onClose }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const graph2DRef = useRef<ForceGraph2DMethods<GNode, GLink> | undefined>(undefined);
  const graph3DRef = useRef<ForceGraph3DMethods<GNode, GLink> | undefined>(undefined);

  const [resp, setResp] = useState<GraphResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirFilter, setDirFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [query, setQuery] = useState("");
  const [hovered, setHovered] = useState<GNode | null>(null);
  const [graphSize, setGraphSize] = useState({ width: 0, height: 0 });
  const [graphMode, setGraphMode] = useState<GraphMode>("2d");

  const [sizeByPageRank, setSizeByPageRank] = useState(true);
  const [colorByCommunity, setColorByCommunity] = useState(true);
  const [showLinks, setShowLinks] = useState(false);

  const [pathFindActive, setPathFindActive] = useState(false);
  const [pathSource, setPathSource] = useState<string | null>(null);
  const [pathTarget, setPathTarget] = useState<string | null>(null);
  const [foundPath, setFoundPath] = useState<string[] | null>(null);

  // Fetch graph data
  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .graph()
      .then((r) => {
        if (!cancelled) setResp(r);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [tree]);

  // Read theme once and refresh when the root class changes.
  const themeRef = useRef<KiwiGraphTheme>(readKiwiGraphTheme());
  useEffect(() => {
    const obs = new MutationObserver(() => {
      themeRef.current = readKiwiGraphTheme();
    });
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const updateSize = () => {
      const rect = wrapper.getBoundingClientRect();
      setGraphSize({
        width: Math.max(1, Math.floor(rect.width)),
        height: Math.max(1, Math.floor(rect.height)),
      });
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, []);

  const built = useMemo(() => {
    if (!resp) return null;
    return buildGraphData(resp, tree, themeRef.current, sizeByPageRank, colorByCommunity);
  }, [resp, tree, sizeByPageRank, colorByCommunity]);

  // react-force-graph treats graphData identity changes as data updates.
  // Keep this object stable across hover/search/path re-renders so pointer
  // interaction does not restart the force engine or perturb the camera.
  const graphData = useMemo(
    () => ({ nodes: built?.nodes ?? [], links: built?.links ?? [] }),
    [built],
  );

  const adj = useMemo(() => {
    const next = new Map<string, Set<string>>();
    if (!built) return next;
    for (const n of built.nodes) next.set(n.id, new Set());
    for (const l of built.links) {
      const s = typeof l.source === "string" ? l.source : l.source.id;
      const t = typeof l.target === "string" ? l.target : l.target.id;
      next.get(s)?.add(t);
      next.get(t)?.add(s);
    }
    return next;
  }, [built]);

  const pathSet = useMemo(() => foundPath ? new Set(foundPath) : null, [foundPath]);
  const qLower = query.trim().toLowerCase();

  const nodeMatchesQuery = useCallback(
    (node: GNode) =>
      !qLower ||
      node.id.toLowerCase().includes(qLower) ||
      node.label.toLowerCase().includes(qLower),
    [qLower],
  );

  const nodeVisible = useCallback(
    (node: GNode) =>
      (!dirFilter || node.dir === dirFilter) &&
      (!tagFilter || node.tags.includes(tagFilter)),
    [dirFilter, tagFilter],
  );

  const linkVisible = useCallback(
    (link: GLink) => {
      const source = link.source as GNode;
      const target = link.target as GNode;
      return showLinks && nodeVisible(source) && nodeVisible(target);
    },
    [nodeVisible, showLinks],
  );

  const getGraphApi = useCallback(
    (): GraphApi | undefined => (graphMode === "2d" ? graph2DRef.current : graph3DRef.current) as GraphApi | undefined,
    [graphMode],
  );

  const fitGraphToView = useCallback(() => {
    getGraphApi()?.zoomToFit(400, 48, nodeVisible);
  }, [getGraphApi, nodeVisible]);

  useEffect(() => {
    const graphApi = getGraphApi();
    if (!built || !graphApi) return;

    const perf = built.performance.d3;
    const charge = graphApi.d3Force("charge");
    charge?.strength?.(perf.chargeStrength);
    charge?.distanceMax?.(perf.chargeDistanceMax);

    const link = graphApi.d3Force("link");
    link?.distance?.(perf.linkDistance);
    link?.strength?.(perf.linkStrength);

    // Keep the same charge/link tuning in both 2D and 3D modes.
    // Do not force d3ReheatSimulation() here: react-force-graph-3d creates
    // its internal layout during graphData update. Reheating before that layout
    // exists starts the animation loop early and crashes on state.layout.tick().

    const timeout = window.setTimeout(() => fitGraphToView(), 250);
    return () => window.clearTimeout(timeout);
  }, [built, fitGraphToView, getGraphApi]);

  // Path finding
  useEffect(() => {
    if (!pathSource || !pathTarget) {
      setFoundPath(null);
      return;
    }
    const path = bfsPath(adj, pathSource, pathTarget);
    setFoundPath(path.length > 0 ? path : null);
  }, [adj, pathSource, pathTarget]);

  useEffect(() => {
    if (!pathFindActive) {
      setPathSource(null);
      setPathTarget(null);
      setFoundPath(null);
    }
  }, [pathFindActive]);

  const handleNodeHover = useCallback((node: GNode | null) => {
    setHovered((current) => (current?.id === node?.id ? current : node));
  }, []);

  const shouldShowInlineLabel = useCallback(
    (node: GNode) => {
      const isActive = activePath === node.id;
      const isHovered = hovered?.id === node.id;
      const isNeighbor = hovered ? adj.get(hovered.id)?.has(node.id) : false;
      const onPath = pathSet?.has(node.id) ?? false;
      const queryMatch = Boolean(qLower && nodeMatchesQuery(node));
      return (
        !built?.performance.largeGraph ||
        isActive ||
        isHovered ||
        isNeighbor ||
        onPath ||
        queryMatch
      );
    },
    [activePath, adj, built?.performance.largeGraph, hovered, nodeMatchesQuery, pathSet, qLower],
  );

  const nodeTooltipLabel = useCallback(
    (node: GNode) => (shouldShowInlineLabel(node) ? "" : node.label),
    [shouldShowInlineLabel],
  );

  const handleNodeClick = useCallback(
    (node: GNode) => {
      if (pathFindActive) {
        if (!pathSource) setPathSource(node.id);
        else if (!pathTarget) setPathTarget(node.id);
        else {
          setPathSource(node.id);
          setPathTarget(null);
          setFoundPath(null);
        }
      } else {
        onNavigate(node.id);
      }
    },
    [onNavigate, pathFindActive, pathSource, pathTarget],
  );

  const nodeColor = useCallback(
    (node: GNode) => {
      const isActive = activePath === node.id;
      const isHovered = hovered?.id === node.id;
      const isNeighbor = hovered ? adj.get(hovered.id)?.has(node.id) : false;
      const onPath = pathSet?.has(node.id) ?? false;
      const queryMatch = nodeMatchesQuery(node);

      if (isActive || isHovered || onPath || (qLower && queryMatch)) return node.color;
      if (pathSet && !onPath) return "#243042";
      if (hovered && !isNeighbor) return "#243042";
      if (qLower && !queryMatch) return "#243042";
      return node.color;
    },
    [activePath, adj, hovered, nodeMatchesQuery, pathSet, qLower],
  );

  const linkColor = useCallback(
    (link: GLink) => {
      const source = link.source as GNode;
      const target = link.target as GNode;
      const isDark = document.documentElement.classList.contains("dark");
      let alpha = 0.15;
      let color = isDark ? "rgba(255,255,255," : "rgba(100,100,100,";

      if (pathSet) {
        const onPath = pathSet.has(source.id) && pathSet.has(target.id);
        if (onPath) {
          alpha = 0.9;
          color = "rgba(245,158,11,";
        } else {
          alpha = 0.04;
        }
      } else if (hovered) {
        const connected = source.id === hovered.id || target.id === hovered.id;
        alpha = connected ? 0.6 : 0.04;
      }
      return `${color}${alpha})`;
    },
    [hovered, pathSet],
  );

  const linkWidth = useCallback(
    (link: GLink) => {
      const source = link.source as GNode;
      const target = link.target as GNode;
      if (pathSet?.has(source.id) && pathSet.has(target.id)) return 2.5;
      if (hovered && (source.id === hovered.id || target.id === hovered.id)) return 1.5;
      return 0.5;
    },
    [hovered, pathSet],
  );

  const linkColor3D = useCallback(
    (link: GLink) => {
      const source = link.source as GNode;
      const target = link.target as GNode;
      if (pathSet?.has(source.id) && pathSet.has(target.id)) return "#f59e0b";
      return document.documentElement.classList.contains("dark") ? "#d1d5db" : "#64748b";
    },
    [pathSet],
  );

  const linkWidth3D = useCallback((link: GLink) => Math.max(0.6, linkWidth(link)), [linkWidth]);

  const nodeCanvasObject = useCallback(
    (node: GNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const nx = node.x ?? 0;
      const ny = node.y ?? 0;
      const r = Math.max(2, node.radius);
      const color = nodeColor(node);
      const isDark = document.documentElement.classList.contains("dark");

      const isActive = activePath === node.id;
      const isHovered = hovered?.id === node.id;
      const isNeighbor = hovered ? adj.get(hovered.id)?.has(node.id) : false;
      const onPath = pathSet?.has(node.id) ?? false;
      const highlighted = isActive || isHovered || isNeighbor || onPath || Boolean(qLower && nodeMatchesQuery(node));

      const hex = color.replace("#", "");
      const cr = parseInt(hex.slice(0, 2), 16) || 100;
      const cg = parseInt(hex.slice(2, 4), 16) || 100;
      const cb = parseInt(hex.slice(4, 6), 16) || 100;

      // Layer 1: Outer ambient glow
      if (!built?.performance.largeGraph || highlighted) {
        const glowRadius = highlighted ? r * 4 : r * 2.2;
        const glowAlpha = highlighted ? 0.35 : 0.12;
        const glow = ctx.createRadialGradient(nx, ny, r * 0.3, nx, ny, glowRadius);
        glow.addColorStop(0, `rgba(${cr},${cg},${cb},${glowAlpha})`);
        glow.addColorStop(0.5, `rgba(${cr},${cg},${cb},${glowAlpha * 0.4})`);
        glow.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
        ctx.beginPath();
        ctx.arc(nx, ny, glowRadius, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();
      }

      // Layer 2: Core disc with soft gradient edge
      const coreAlpha = highlighted ? 1 : 0.85;
      const core = ctx.createRadialGradient(nx, ny, 0, nx, ny, r);
      core.addColorStop(0, `rgba(${Math.min(255, cr + 60)},${Math.min(255, cg + 60)},${Math.min(255, cb + 60)},${coreAlpha})`);
      core.addColorStop(0.6, `rgba(${cr},${cg},${cb},${coreAlpha})`);
      core.addColorStop(1, `rgba(${cr},${cg},${cb},${coreAlpha * 0.6})`);
      ctx.beginPath();
      ctx.arc(nx, ny, r, 0, Math.PI * 2);
      ctx.fillStyle = core;
      ctx.fill();

      // Layer 3: Bright center highlight
      if (highlighted) {
        const bright = ctx.createRadialGradient(nx, ny, 0, nx, ny, r * 0.5);
        bright.addColorStop(0, `rgba(255,255,255,${isDark ? 0.7 : 0.5})`);
        bright.addColorStop(1, "rgba(255,255,255,0)");
        ctx.beginPath();
        ctx.arc(nx, ny, r * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = bright;
        ctx.fill();
      }

      // Labels
      if (!shouldShowInlineLabel(node)) return;

      const fontSize = Math.max(3, 12 / globalScale);
      ctx.font = `${fontSize}px Sans-Serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = isDark ? "rgba(255,255,255,0.88)" : "rgba(20,20,20,0.82)";
      ctx.fillText(node.label, nx, ny + r + fontSize);
    },
    [activePath, adj, hovered, nodeColor, pathSet, qLower, nodeMatchesQuery, shouldShowInlineLabel],
  );

  const glowTexture = useMemo(() => {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.2, "rgba(255,255,255,0.8)");
    gradient.addColorStop(0.5, "rgba(255,255,255,0.2)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
  }, []);

  const nodeThreeObject = useCallback(
    (node: GNode) => {
      const r = Math.max(2, node.radius);
      const color = nodeColor(node);
      const isHoveredNode = hovered?.id === node.id;
      const isDark = document.documentElement.classList.contains("dark");
      const highlighted =
        activePath === node.id ||
        isHoveredNode ||
        (hovered ? adj.get(hovered.id)?.has(node.id) : false) ||
        (pathSet?.has(node.id) ?? false) ||
        Boolean(qLower && nodeMatchesQuery(node));

      const group = new THREE.Group();

      // Core sphere with emissive glow
      const geometry = new THREE.SphereGeometry(r, 20, 20);
      const material = new THREE.MeshPhongMaterial({
        color: new THREE.Color(color),
        emissive: new THREE.Color(color),
        emissiveIntensity: highlighted ? 0.8 : 0.3,
        transparent: true,
        opacity: highlighted ? 1 : 0.88,
        shininess: 60,
      });
      const sphere = new THREE.Mesh(geometry, material);
      group.add(sphere);

      // Outer glow sprite
      const spriteMaterial = new THREE.SpriteMaterial({
        map: glowTexture,
        color: new THREE.Color(color),
        transparent: true,
        opacity: highlighted ? 0.6 : 0.2,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(spriteMaterial);
      const glowScale = highlighted ? r * 6 : r * 3.5;
      sprite.scale.set(glowScale, glowScale, 1);
      group.add(sprite);

      if (shouldShowInlineLabel(node)) {
        const label = createNodeLabelSprite(node.label, isDark);
        label.position.set(0, r + 8, 0);
        group.add(label);
      }

      return group;
    },
    [activePath, adj, glowTexture, hovered, nodeColor, nodeMatchesQuery, pathSet, qLower, shouldShowInlineLabel],
  );

  return (
    <div className="h-full w-full flex flex-col relative">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3 px-3 sm:px-6 py-3 border-b border-border bg-card shrink-0">
        <Button variant="outline" size="sm" onClick={onClose}>
          <ArrowLeft className="h-3.5 w-3.5" />{" "}
          <span className="hidden sm:inline">Back</span>
        </Button>
        <div className="font-semibold text-sm">Knowledge graph</div>
        <div className="text-xs text-muted-foreground hidden sm:block">
          {built
            ? `${built.nodes.length} pages · ${built.links.length} links`
            : null}
        </div>
        {built?.performance.largeGraph && (
          <div className="text-xs text-muted-foreground hidden lg:block">
            Large graph mode: labels appear on hover/search.
          </div>
        )}
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <div className="relative">
            <SearchIcon className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              type="text"
              placeholder="Highlight..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 pl-7 w-32 sm:w-48 text-sm"
            />
          </div>
          {built && built.dirs.length > 1 && (
            <Select
              value={dirFilter || "__all__"}
              onValueChange={(v) => setDirFilter(v === "__all__" ? "" : v)}
            >
              <SelectTrigger className="h-8 w-32 sm:w-44 text-sm">
                <SelectValue placeholder="All folders" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All folders</SelectItem>
                {built.dirs.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {built && built.tags.length > 0 && (
            <Select
              value={tagFilter || "__all__"}
              onValueChange={(v) => setTagFilter(v === "__all__" ? "" : v)}
            >
              <SelectTrigger className="h-8 w-32 sm:w-44 text-sm">
                <Tag className="h-3 w-3 mr-1" />
                <SelectValue placeholder="All tags" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All tags</SelectItem>
                {built.tags.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* ── Analytics bar ── */}
      <div className="flex flex-wrap items-center gap-2 px-3 sm:px-6 py-1.5 border-b border-border/50 bg-card/50 text-xs shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Mode</span>
          <Select value={graphMode} onValueChange={(value) => setGraphMode(value as GraphMode)}>
            <SelectTrigger className="h-6 w-20 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="2d">2D</SelectItem>
              <SelectItem value="3d">3D</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={sizeByPageRank}
            onChange={(e) => setSizeByPageRank(e.target.checked)}
            className="accent-primary h-3 w-3"
          />
          Size by PageRank
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={colorByCommunity}
            onChange={(e) => setColorByCommunity(e.target.checked)}
            className="accent-primary h-3 w-3"
          />
          Color by community
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showLinks}
            onChange={(e) => setShowLinks(e.target.checked)}
            className="accent-primary h-3 w-3"
          />
          Show links
        </label>
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-xs gap-1"
          onClick={fitGraphToView}
          title="Fit graph to view"
        >
          <Maximize2 className="h-3 w-3" />
          Fit graph
        </Button>
        <Button
          variant={pathFindActive ? "secondary" : "outline"}
          size="sm"
          className="h-6 px-2 text-xs gap-1"
          onClick={() => setPathFindActive((v) => !v)}
        >
          <Route className="h-3 w-3" />
          Find path
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-xs opacity-50 cursor-not-allowed"
          disabled
        >
          Show semantic edges
        </Button>
        {pathFindActive && (
          <span className="text-muted-foreground">
            {!pathSource
              ? "Click source node..."
              : !pathTarget
                ? `Source: ${titleize(pathSource)} — click target...`
                : foundPath
                  ? `Path: ${foundPath.length - 1} hop${foundPath.length - 1 !== 1 ? "s" : ""}`
                  : "No path found"}
          </span>
        )}
      </div>

      {/* ── Graph area ── */}
      <div ref={wrapperRef} className="flex-1 relative min-h-0">
        {error && (
          <div className="absolute inset-0 grid place-items-center text-sm text-destructive font-mono z-10">
            {error}
          </div>
        )}
        {!error && !resp && (
          <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground z-10">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Building graph...
            </div>
          </div>
        )}
        {resp && built && built.nodes.length === 0 && (
          <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground z-10">
            No pages yet.
          </div>
        )}

        {built && built.nodes.length > 0 && graphSize.width > 0 && graphSize.height > 0 && (
          graphMode === "2d" ? (
            <ForceGraph2D<GNode, GLink>
              ref={graph2DRef}
              width={graphSize.width}
              height={graphSize.height}
              graphData={graphData}
              nodeId="id"
              nodeVal="radius"
              nodeLabel={nodeTooltipLabel}
              nodeVisibility={nodeVisible}
              nodeColor={nodeColor}
              nodeCanvasObject={nodeCanvasObject}
              nodePointerAreaPaint={(node, color, ctx) => {
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(node.x ?? 0, node.y ?? 0, Math.max(6, node.radius), 0, 2 * Math.PI, false);
                ctx.fill();
              }}
              linkVisibility={linkVisible}
              linkColor={linkColor}
              linkWidth={linkWidth}
              linkDirectionalParticles={(link) => showLinks && linkWidth(link) > 1 ? 2 : 0}
              linkDirectionalParticleWidth={(link) => linkWidth(link) > 2 ? 3 : 1.5}
              linkDirectionalParticleColor={linkColor}
              onNodeHover={(node) => handleNodeHover(node as GNode | null)}
              onNodeClick={(node) => handleNodeClick(node as GNode)}
              showPointerCursor={(obj) => Boolean(obj && "label" in obj)}
              backgroundColor="rgba(0,0,0,0)"
              minZoom={0.15}
              maxZoom={8}
              d3AlphaDecay={built.performance.d3.alphaDecay}
              d3VelocityDecay={built.performance.d3.velocityDecay}
              cooldownTicks={built.performance.largeGraph ? 120 : undefined}
            />
          ) : (
            <ForceGraph3D<GNode, GLink>
              ref={graph3DRef}
              width={graphSize.width}
              height={graphSize.height}
              graphData={graphData}
              nodeId="id"
              nodeVal="radius"
              nodeLabel={nodeTooltipLabel}
              nodeVisibility={nodeVisible}
              nodeThreeObject={nodeThreeObject}
              nodeThreeObjectExtend={false}
              linkVisibility={linkVisible}
              linkColor={linkColor3D}
              linkWidth={linkWidth3D}
              linkOpacity={0.35}
              linkResolution={4}
              linkDirectionalParticles={(link) => showLinks && linkWidth(link) > 1 ? 2 : 0}
              linkDirectionalParticleWidth={(link) => linkWidth(link) > 2 ? 3 : 1.5}
              linkDirectionalParticleColor={linkColor3D}
              onNodeHover={(node) => handleNodeHover(node as GNode | null)}
              onNodeClick={(node) => handleNodeClick(node as GNode)}
              showPointerCursor={(obj) => Boolean(obj && "label" in obj)}
              backgroundColor="rgba(0,0,0,0)"
              showNavInfo={false}
              numDimensions={3}
              d3AlphaDecay={built.performance.d3.alphaDecay}
              d3VelocityDecay={built.performance.d3.velocityDecay}
              cooldownTicks={built.performance.largeGraph ? 120 : undefined}
            />
          )
        )}

        {/* Hover tooltip */}
        {hovered && (
          <Card
            className="absolute bottom-3 left-3 px-3 py-2 text-xs pointer-events-none max-w-xs z-20"
          >
            <div className="font-medium">{hovered.label}</div>
            <div className="text-muted-foreground font-mono text-[10px]">
              {hovered.id}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground mt-1">
              <span>
                {adj.get(hovered.id)?.size ?? 0} connection
                {(adj.get(hovered.id)?.size ?? 0) === 1 ? "" : "s"}
              </span>
              <span>
                PR: {(hovered.pagerank * 100).toFixed(2)}%
              </span>
              <span>Community: {hovered.community}</span>
            </div>
            {hovered.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {hovered.tags.map((t) => (
                  <span
                    key={t}
                    className="bg-muted px-1 rounded text-[10px]"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* Path overlay */}
        {foundPath && foundPath.length > 1 && (
          <Card className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 text-xs pointer-events-none bg-primary text-primary-foreground z-20">
            Shortest path: {foundPath.length - 1} hop
            {foundPath.length - 1 !== 1 ? "s" : ""} (
            {foundPath.map((n) => titleize(n)).join(" → ")})
          </Card>
        )}

        {/* Community legend */}
        {built && built.communityMap.size > 1 && (
          <Card className="absolute top-3 right-3 px-3 py-2 text-xs z-20">
            <div className="text-muted-foreground mb-1.5 font-medium">
              Communities
            </div>
            <div className="space-y-1">
              {Array.from(built.communityMap.entries())
                .sort((a, b) => b[1].count - a[1].count)
                .map(([idx, { color, count, topDir }]) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ background: color }}
                    />
                    <span className="text-muted-foreground">
                      {topDir} ({count})
                    </span>
                  </div>
                ))}
            </div>
          </Card>
        )}

        <div
          className={cn(
            "absolute bottom-3 right-3 text-[10px] text-muted-foreground font-mono",
            "pointer-events-none z-20",
          )}
        >
          {graphMode === "2d"
            ? "drag to pan · scroll to zoom"
            : "drag to rotate · right-drag to pan · scroll to zoom"}
        </div>
      </div>
    </div>
  );
}
