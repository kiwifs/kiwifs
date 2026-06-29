interface CellStyle {
  border: string;
  background: string;
  color: string;
  opacity?: number;
}

export interface ArrayPointer {
  index: number;
  label: string;
  color?: string;
}

export interface ArrayViewProps {
  /** The array values to display. */
  values: (string | number)[];
  /** Optional sublabel per cell (shown below the value, inside the cell). */
  sublabels?: (string | number | null | undefined)[];
  /** Index of the currently active cell (highlighted). */
  activeIndex?: number;
  /** Set of indices that should be highlighted as "secondary" (e.g. part of a streak). */
  highlightIndices?: Set<number>;
  /** Set of indices that are "done" / checked / greyed out. */
  dimIndices?: Set<number>;
  /** Named pointers shown above or below cells. */
  pointers?: ArrayPointer[];
  /** Primary highlight color. Defaults to purple. */
  activeColor?: string;
  /** Secondary highlight color. Defaults to green. */
  highlightColor?: string;
  /** Cell size in px. Defaults to 48. */
  cellSize?: number;
}

const DEFAULTS = {
  activeColor: "var(--kw-widget-active, #a78bfa)",
  highlightColor: "var(--kw-widget-highlight, #22c55e)",
  dimColor: "var(--kw-widget-dim, #64748b)",
  border: "var(--kw-widget-border, #3f3f46)",
  text: "var(--kw-widget-text, #e5e7eb)",
  cellSize: 48,
};

function getCellStyle(
  index: number,
  activeIndex: number | undefined,
  highlightIndices: Set<number> | undefined,
  dimIndices: Set<number> | undefined,
  activeColor: string,
  highlightColor: string,
): CellStyle {
  const isActive = index === activeIndex;
  const isHighlighted = highlightIndices?.has(index) ?? false;
  const isDim = dimIndices?.has(index) ?? false;

  if (isActive) return {
    border: activeColor,
    background: activeColor,
    color: "#111827",
  };
  if (isHighlighted) return {
    border: highlightColor,
    background: highlightColor + "2e",
    color: DEFAULTS.text,
  };
  if (isDim) return {
    border: DEFAULTS.dimColor,
    background: DEFAULTS.dimColor + "2e",
    color: DEFAULTS.text,
    opacity: 0.55,
  };
  return {
    border: DEFAULTS.border,
    background: "transparent",
    color: DEFAULTS.text,
  };
}

export function ArrayView({
  values,
  sublabels,
  activeIndex,
  highlightIndices,
  dimIndices,
  pointers = [],
  activeColor = DEFAULTS.activeColor,
  highlightColor = DEFAULTS.highlightColor,
  cellSize = DEFAULTS.cellSize,
}: ArrayViewProps) {
  const pointersByIndex = new Map<number, ArrayPointer[]>();
  for (const p of pointers) {
    const list = pointersByIndex.get(p.index) ?? [];
    list.push(p);
    pointersByIndex.set(p.index, list);
  }

  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 6, padding: "0.75rem 0", flexWrap: "wrap" }}>
      {values.map((val, i) => {
        const style = getCellStyle(i, activeIndex, highlightIndices, dimIndices, activeColor, highlightColor);
        const ptrs = pointersByIndex.get(i);

        const sub = sublabels?.[i];
        const hasSub = sub != null && sub !== "";
        const mainFontSize = hasSub
          ? (cellSize > 40 ? "0.85rem" : "0.75rem")
          : (cellSize > 40 ? "1rem" : "0.85rem");

        return (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            {/* Pointer labels above */}
            <div style={{ height: 18, display: "flex", gap: 4, fontSize: "0.7rem", fontWeight: 600 }}>
              {ptrs?.map((p, j) => (
                <span key={j} style={{ color: p.color ?? activeColor }}>{p.label}</span>
              )) ?? <span style={{ visibility: "hidden" }}>_</span>}
            </div>

            {/* Cell */}
            <div
              style={{
                width: cellSize,
                height: cellSize,
                borderRadius: 8,
                border: `2px solid ${style.border}`,
                background: style.background,
                color: style.color,
                opacity: style.opacity ?? 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                fontSize: mainFontSize,
                transition: "all 0.2s ease",
                fontVariantNumeric: "tabular-nums",
                gap: 0,
              }}
            >
              <span>{val}</span>
              {hasSub && (
                <span style={{
                  fontSize: "0.55rem",
                  fontWeight: 500,
                  opacity: 0.6,
                  lineHeight: 1,
                }}>
                  {sub}
                </span>
              )}
            </div>

            {/* Index label below */}
            <div style={{ fontSize: "0.65rem", color: DEFAULTS.dimColor, fontVariantNumeric: "tabular-nums" }}>
              {i}
            </div>
          </div>
        );
      })}
    </div>
  );
}
