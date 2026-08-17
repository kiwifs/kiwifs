import { alpha } from "./colors";
import { SvgLabel } from "./WidgetText";

export interface LLNode {
  value: string | number;
  /**
   * Where this node's next pointer goes: `true` or omitted for the node that
   * follows it, `false` for null, or an index — which is how you draw the tail
   * of a cycle looping back into the middle of the list.
   */
  next?: boolean | number | null;
}

export interface LinkedListPointer {
  index: number;
  label: string;
  color?: string;
}

export interface LinkedListEdge {
  from: number;
  to: number;
  label?: string;
  color?: string;
  /** Which side of the chain to arc over. Default "below". */
  side?: "above" | "below";
}

export interface LinkedListViewProps {
  /** Nodes in order. */
  nodes: LLNode[];
  /** Index of the active node. */
  activeIndex?: number;
  /** Set of indices that are highlighted. */
  highlightIndices?: Set<number>;
  /** Set of indices that are dimmed. */
  dimIndices?: Set<number>;
  /** Named pointers (slow, fast, curr, prev, etc.). */
  pointers?: LinkedListPointer[];
  /** Draw a backward arrow beside each forward one, for a doubly linked list. */
  doubly?: boolean;
  /** Arcs on top of the chain: random pointers, child links, a cycle entrance. */
  edges?: LinkedListEdge[];
  /** Whether to show a null terminator. Default true. */
  showNull?: boolean;
  activeColor?: string;
  highlightColor?: string;
  nodeWidth?: number;
}

const DEFAULTS = {
  activeColor: "var(--kw-widget-active, #a78bfa)",
  highlightColor: "var(--kw-widget-highlight, #22c55e)",
  dimColor: "var(--kw-widget-dim, #64748b)",
  border: "var(--kw-widget-border, #3f3f46)",
  text: "var(--kw-widget-text, #e5e7eb)",
  surface: "var(--kw-widget-surface, #18181b)",
  nodeWidth: 56,
};

const NEXT_W = 18;
const BOX_H = 36;
const GAP = 26;
const LABEL_BAND = 16;
const NULL_W = 40;

const ARROW = "kw-ll-arrow";
const ARROW_ACTIVE = "kw-ll-arrow-active";

interface Arc {
  from: number;
  to: number;
  label?: string;
  color?: string;
  side: "above" | "below";
}

/** Deeper arcs for longer spans, so nested pointers don't overlap. */
function arcDepth(span: number): number {
  return 16 + Math.min(Math.abs(span), 6) * 9;
}

export function LinkedListView({
  nodes,
  activeIndex,
  highlightIndices,
  dimIndices,
  pointers = [],
  doubly = false,
  edges = [],
  showNull = true,
  activeColor = DEFAULTS.activeColor,
  highlightColor = DEFAULTS.highlightColor,
  nodeWidth = DEFAULTS.nodeWidth,
}: LinkedListViewProps) {
  if (nodes.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 16, color: DEFAULTS.dimColor, fontSize: "0.8rem" }}>
        (empty list)
      </div>
    );
  }

  const boxW = nodeWidth + NEXT_W;
  const stride = boxW + GAP;

  const arcs: Arc[] = [];
  nodes.forEach((n, i) => {
    if (typeof n.next === "number" && n.next >= 0 && n.next < nodes.length) {
      arcs.push({ from: i, to: n.next, side: "below" });
    }
  });
  for (const e of edges) {
    if (e.from < 0 || e.from >= nodes.length || e.to < 0 || e.to >= nodes.length) continue;
    arcs.push({ ...e, side: e.side ?? "below" });
  }

  const spaceFor = (side: "above" | "below") =>
    arcs.filter((a) => a.side === side).reduce((max, a) => Math.max(max, arcDepth(a.to - a.from) + 14), 0);
  const aboveSpace = spaceFor("above");
  const belowSpace = spaceFor("below");

  // A tail that loops back has no null terminator to draw.
  const lastNext = nodes[nodes.length - 1]!.next;
  const hasNull = showNull && lastNext !== false && typeof lastNext !== "number";

  const padX = 12;
  const boxTop = LABEL_BAND + 6 + aboveSpace;
  const centerY = boxTop + BOX_H / 2;
  const width = padX * 2 + nodes.length * boxW + (nodes.length - 1) * GAP + (hasNull ? GAP + NULL_W : 0);
  const height = boxTop + BOX_H + belowSpace + 6;

  const boxX = (i: number) => padX + i * stride;
  const centerX = (i: number) => boxX(i) + boxW / 2;

  const ptrMap = new Map<number, LinkedListPointer[]>();
  for (const p of pointers) {
    const list = ptrMap.get(p.index) ?? [];
    list.push(p);
    ptrMap.set(p.index, list);
  }

  function styleFor(i: number) {
    if (i === activeIndex) {
      return {
        bg: activeColor,
        border: activeColor,
        text: "var(--kw-widget-active-foreground, #111827)",
        opacity: 1,
      };
    }
    if (highlightIndices?.has(i)) {
      return { bg: alpha(highlightColor, 18), border: highlightColor, text: DEFAULTS.text, opacity: 1 };
    }
    if (dimIndices?.has(i)) {
      return { bg: "transparent", border: DEFAULTS.dimColor, text: DEFAULTS.text, opacity: 0.5 };
    }
    return { bg: "transparent", border: DEFAULTS.border, text: DEFAULTS.text, opacity: 1 };
  }

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "0.5rem 0", overflow: "auto" }}>
      <svg width={width} height={height} style={{ display: "block" }}>
        <defs>
          <marker id={ARROW} markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill={DEFAULTS.border} />
          </marker>
          <marker id={ARROW_ACTIVE} markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill={activeColor} />
          </marker>
        </defs>

        {/* Straight arrows between neighbours */}
        {nodes.map((node, i) => {
          const goesToNeighbour = node.next === undefined || node.next === true;
          if (!goesToNeighbour || i >= nodes.length - 1) return null;
          const x1 = boxX(i) + boxW + 3;
          const x2 = boxX(i + 1) - 4;
          const y = doubly ? centerY - 6 : centerY;
          return (
            <g key={`n${i}`}>
              <line x1={x1} y1={y} x2={x2} y2={y} stroke={DEFAULTS.border} strokeWidth={1.5} markerEnd={`url(#${ARROW})`} />
              {doubly && (
                <line
                  x1={x2} y1={centerY + 6} x2={x1} y2={centerY + 6}
                  stroke={DEFAULTS.border} strokeWidth={1.5} markerEnd={`url(#${ARROW})`}
                />
              )}
            </g>
          );
        })}

        {/* Arcs: cycles, random pointers, anything non-adjacent */}
        {arcs.map((a, i) => {
          const dir = a.side === "above" ? -1 : 1;
          const y0 = a.side === "above" ? boxTop : boxTop + BOX_H;
          const depth = arcDepth(a.to - a.from);
          const x1 = centerX(a.from);
          const x2 = centerX(a.to);
          const stroke = a.color ?? DEFAULTS.dimColor;
          const midX = (x1 + x2) / 2;
          const midY = y0 + dir * depth;
          return (
            <g key={`a${i}`}>
              <path
                d={`M ${x1} ${y0} Q ${midX} ${y0 + dir * depth * 1.6} ${x2} ${y0}`}
                fill="none"
                stroke={stroke}
                strokeWidth={1.5}
                strokeDasharray="5 3"
                markerEnd={`url(#${ARROW})`}
              />
              {a.label && (
                <SvgLabel
                  x={midX}
                  y={midY + dir * 6}
                  text={a.label}
                  anchor="middle"
                  dominantBaseline="central"
                  fill={stroke}
                  fontSize={10}
                  fontWeight={600}
                  fontFamily="ui-monospace, SFMono-Regular, monospace"
                  halo={DEFAULTS.surface}
                />
              )}
            </g>
          );
        })}

        {/* Nodes */}
        {nodes.map((node, i) => {
          const s = styleFor(i);
          const x = boxX(i);
          const ptrs = ptrMap.get(i);
          const nextCellX = x + nodeWidth;
          const terminates = node.next === false || node.next === null;

          return (
            <g key={`b${i}`} style={{ transition: "all 0.2s ease", opacity: s.opacity }}>
              <rect
                x={x} y={boxTop} width={boxW} height={BOX_H} rx={6}
                fill={s.bg} stroke={s.border} strokeWidth={2}
              />
              <line
                x1={nextCellX} y1={boxTop} x2={nextCellX} y2={boxTop + BOX_H}
                stroke={s.border} strokeWidth={1.5}
              />
              <SvgLabel
                x={x + nodeWidth / 2} y={centerY}
                text={node.value}
                anchor="middle"
                dominantBaseline="central"
                fill={s.text}
                fontSize={13}
                fontWeight={700}
                fontFamily="ui-monospace, SFMono-Regular, monospace"
              />
              <text
                x={nextCellX + NEXT_W / 2} y={centerY}
                textAnchor="middle" dominantBaseline="central"
                fill={i === activeIndex ? s.text : DEFAULTS.dimColor}
                fontSize={11}
              >
                {terminates ? "∅" : "•"}
              </text>
              {ptrs?.map((p, j) => (
                <SvgLabel
                  key={j}
                  x={x + boxW / 2}
                  y={LABEL_BAND - 4 - j * 13}
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

        {/* Null terminator */}
        {hasNull && (
          <g opacity={0.6}>
            <line
              x1={boxX(nodes.length - 1) + boxW + 3}
              y1={centerY}
              x2={boxX(nodes.length - 1) + boxW + GAP - 4}
              y2={centerY}
              stroke={DEFAULTS.border}
              strokeWidth={1.5}
              markerEnd={`url(#${ARROW})`}
            />
            <rect
              x={boxX(nodes.length - 1) + boxW + GAP}
              y={boxTop + 4}
              width={NULL_W}
              height={BOX_H - 8}
              rx={6}
              fill="none"
              stroke={DEFAULTS.dimColor}
              strokeWidth={2}
            />
            <text
              x={boxX(nodes.length - 1) + boxW + GAP + NULL_W / 2}
              y={centerY}
              textAnchor="middle"
              dominantBaseline="central"
              fill={DEFAULTS.dimColor}
              fontSize={11}
              fontWeight={600}
              fontFamily="ui-monospace, SFMono-Regular, monospace"
            >
              null
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
