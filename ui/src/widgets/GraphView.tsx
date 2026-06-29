export interface GraphNode {
  id: string | number;
  x: number;
  y: number;
  label?: string;
}

export interface GraphEdge {
  from: string | number;
  to: string | number;
  weight?: number;
  label?: string;
}

export interface GraphViewProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Set of node IDs that are currently active. */
  activeNodes?: Set<string | number>;
  /** Set of node IDs that are highlighted (secondary). */
  highlightNodes?: Set<string | number>;
  /** Set of node IDs that are dimmed. */
  dimNodes?: Set<string | number>;
  /** Set of "from->to" strings for highlighted edges. */
  activeEdges?: Set<string>;
  /** Set of "from->to" strings for secondary-highlighted edges. */
  highlightEdges?: Set<string>;
  /** Whether edges are directed (arrows). Default false. */
  directed?: boolean;
  /** Node labels shown next to nodes (e.g. "src", "dst"). */
  pointers?: { id: string | number; label: string; color?: string }[];
  activeColor?: string;
  highlightColor?: string;
  nodeSize?: number;
  /** SVG width. Default 400. */
  width?: number;
  /** SVG height. Default 300. */
  height?: number;
}

const DEFAULTS = {
  activeColor: "var(--kw-widget-active, #a78bfa)",
  highlightColor: "var(--kw-widget-highlight, #22c55e)",
  dimColor: "var(--kw-widget-dim, #64748b)",
  border: "var(--kw-widget-border, #3f3f46)",
  text: "var(--kw-widget-text, #e5e7eb)",
  nodeSize: 36,
  width: 400,
  height: 300,
};

export function GraphView({
  nodes,
  edges,
  activeNodes,
  highlightNodes,
  dimNodes,
  activeEdges,
  highlightEdges,
  directed = false,
  pointers = [],
  activeColor = DEFAULTS.activeColor,
  highlightColor = DEFAULTS.highlightColor,
  nodeSize = DEFAULTS.nodeSize,
  width = DEFAULTS.width,
  height = DEFAULTS.height,
}: GraphViewProps) {
  if (nodes.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 16, color: DEFAULTS.dimColor, fontSize: "0.8rem" }}>
        (empty graph)
      </div>
    );
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const r = nodeSize / 2;

  const pointerMap = new Map<string | number, typeof pointers>();
  for (const p of pointers) {
    const list = pointerMap.get(p.id) ?? [];
    list.push(p);
    pointerMap.set(p.id, list);
  }

  const arrowId = "kw-graph-arrow";
  const arrowActiveId = "kw-graph-arrow-active";
  const arrowHighlightId = "kw-graph-arrow-highlight";

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "0.5rem 0", overflow: "auto" }}>
      <svg width={width} height={height} style={{ display: "block" }}>
        <defs>
          <marker id={arrowId} markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill={DEFAULTS.border} />
          </marker>
          <marker id={arrowActiveId} markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill={activeColor} />
          </marker>
          <marker id={arrowHighlightId} markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill={highlightColor} />
          </marker>
        </defs>

        {edges.map((e, i) => {
          const from = nodeMap.get(e.from);
          const to = nodeMap.get(e.to);
          if (!from || !to) return null;

          const edgeKey = `${e.from}->${e.to}`;
          const isActive = activeEdges?.has(edgeKey) ?? false;
          const isHighlight = highlightEdges?.has(edgeKey) ?? false;

          let strokeColor = DEFAULTS.border;
          let strokeWidth = 1.5;
          let marker = directed ? `url(#${arrowId})` : undefined;

          if (isActive) {
            strokeColor = activeColor;
            strokeWidth = 2.5;
            marker = directed ? `url(#${arrowActiveId})` : undefined;
          } else if (isHighlight) {
            strokeColor = highlightColor;
            strokeWidth = 2;
            marker = directed ? `url(#${arrowHighlightId})` : undefined;
          }

          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const nx = dx / dist;
          const ny = dy / dist;
          const x1 = from.x + nx * r;
          const y1 = from.y + ny * r;
          const x2 = to.x - nx * (r + (directed ? 6 : 0));
          const y2 = to.y - ny * (r + (directed ? 6 : 0));

          const mx = (from.x + to.x) / 2;
          const my = (from.y + to.y) / 2;

          return (
            <g key={i}>
              <line
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                markerEnd={marker}
                style={{ transition: "all 0.25s ease" }}
              />
              {(e.weight !== undefined || e.label) && (
                <text
                  x={mx} y={my - 6}
                  textAnchor="middle"
                  fill={isActive ? activeColor : DEFAULTS.dimColor}
                  fontSize={10}
                  fontWeight={600}
                  fontFamily="ui-monospace, monospace"
                >
                  {e.weight !== undefined ? e.weight : e.label}
                </text>
              )}
            </g>
          );
        })}

        {nodes.map((n) => {
          const isActive = activeNodes?.has(n.id) ?? false;
          const isHighlight = highlightNodes?.has(n.id) ?? false;
          const isDim = dimNodes?.has(n.id) ?? false;
          const ptrs = pointerMap.get(n.id);

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

          return (
            <g key={n.id} style={{ transition: "all 0.25s ease", opacity }}>
              <circle
                cx={n.x} cy={n.y} r={r}
                fill={fill}
                stroke={stroke}
                strokeWidth={2}
              />
              <text
                x={n.x} y={n.y}
                textAnchor="middle"
                dominantBaseline="central"
                fill={textColor}
                fontSize={nodeSize > 32 ? 13 : 11}
                fontWeight={700}
                fontFamily="ui-monospace, SFMono-Regular, monospace"
              >
                {n.label ?? n.id}
              </text>
              {ptrs?.map((p, j) => (
                <text
                  key={j}
                  x={n.x}
                  y={n.y - r - 8 - j * 14}
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
