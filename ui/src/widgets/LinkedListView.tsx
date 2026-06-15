export interface LLNode {
  value: string | number;
  next?: boolean;
}

export interface LinkedListPointer {
  index: number;
  label: string;
  color?: string;
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
  nodeWidth: 56,
};

export function LinkedListView({
  nodes,
  activeIndex,
  highlightIndices,
  dimIndices,
  pointers = [],
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

  const ptrMap = new Map<number, LinkedListPointer[]>();
  for (const p of pointers) {
    const list = ptrMap.get(p.index) ?? [];
    list.push(p);
    ptrMap.set(p.index, list);
  }

  const h = 36;
  const arrowW = 24;

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "0.75rem 0", overflow: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
        {nodes.map((node, i) => {
          const isActive = i === activeIndex;
          const isHighlight = highlightIndices?.has(i) ?? false;
          const isDim = dimIndices?.has(i) ?? false;
          const ptrs = ptrMap.get(i);

          let bg = "transparent";
          let border = DEFAULTS.border;
          let color = DEFAULTS.text;
          let opacity = 1;

          if (isActive) {
            bg = activeColor;
            border = activeColor;
            color = "#111827";
          } else if (isHighlight) {
            bg = highlightColor + "2e";
            border = highlightColor;
          } else if (isDim) {
            border = DEFAULTS.dimColor;
            opacity = 0.5;
          }

          return (
            <div key={i} style={{ display: "flex", alignItems: "center" }}>
              {/* Node */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                {/* Pointer labels above */}
                <div style={{ height: 16, display: "flex", gap: 3, fontSize: "0.65rem", fontWeight: 600 }}>
                  {ptrs?.map((p, j) => (
                    <span key={j} style={{ color: p.color ?? activeColor }}>{p.label}</span>
                  )) ?? <span style={{ visibility: "hidden" }}>_</span>}
                </div>

                {/* Node box: value | next pointer */}
                <div style={{
                  display: "flex",
                  height: h,
                  borderRadius: 6,
                  border: `2px solid ${border}`,
                  overflow: "hidden",
                  opacity,
                  transition: "all 0.2s ease",
                }}>
                  {/* Value cell */}
                  <div style={{
                    width: nodeWidth,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: bg,
                    color,
                    fontWeight: 700,
                    fontSize: "0.85rem",
                    fontVariantNumeric: "tabular-nums",
                    fontFamily: "ui-monospace, monospace",
                  }}>
                    {node.value}
                  </div>
                  {/* Next pointer cell */}
                  <div style={{
                    width: 18,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderLeft: `1.5px solid ${border}`,
                    background: bg === "transparent" ? "transparent" : bg + "66",
                    fontSize: "0.6rem",
                    color: DEFAULTS.dimColor,
                  }}>
                    {node.next !== false ? "•" : "∅"}
                  </div>
                </div>
              </div>

              {/* Arrow to next node */}
              {i < nodes.length - 1 && (
                <svg width={arrowW} height={h} style={{ display: "block", flexShrink: 0 }}>
                  <line
                    x1={2} y1={h / 2} x2={arrowW - 6} y2={h / 2}
                    stroke={DEFAULTS.border}
                    strokeWidth={1.5}
                    style={{ transition: "stroke 0.2s ease" }}
                  />
                  <polygon
                    points={`${arrowW - 6},${h / 2 - 4} ${arrowW},${h / 2} ${arrowW - 6},${h / 2 + 4}`}
                    fill={DEFAULTS.border}
                  />
                </svg>
              )}
            </div>
          );
        })}

        {/* Null terminator */}
        {showNull && (
          <>
            <svg width={arrowW} height={h} style={{ display: "block", flexShrink: 0 }}>
              <line
                x1={2} y1={h / 2} x2={arrowW - 6} y2={h / 2}
                stroke={DEFAULTS.border}
                strokeWidth={1.5}
              />
              <polygon
                points={`${arrowW - 6},${h / 2 - 4} ${arrowW},${h / 2} ${arrowW - 6},${h / 2 + 4}`}
                fill={DEFAULTS.border}
              />
            </svg>
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "0.75rem",
              fontWeight: 600,
              color: DEFAULTS.dimColor,
              fontFamily: "ui-monospace, monospace",
              border: `2px solid ${DEFAULTS.dimColor}`,
              borderRadius: 6,
              padding: "4px 8px",
              opacity: 0.6,
              marginTop: 19,
            }}>
              null
            </div>
          </>
        )}
      </div>
    </div>
  );
}
