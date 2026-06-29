export interface MatrixViewProps {
  /** 2D array of cell values. Rows can have different lengths (ragged/triangular). */
  values: (string | number)[][];
  /** [row, col] of the active cell. */
  activeCell?: [number, number];
  /** Set of "row,col" strings that are highlighted. */
  highlightCells?: Set<string>;
  /** Set of "row,col" strings that are dimmed. */
  dimCells?: Set<string>;
  /** Row pointer labels (shown left of the row). */
  rowPointers?: { row: number; label: string; color?: string }[];
  /** Column pointer labels (shown above the column). */
  colPointers?: { col: number; label: string; color?: string }[];
  /** Whether to show row/col indices. Default true. */
  showIndices?: boolean;
  /** Ragged row mode — only render actual cells per row (no padding to max width).
   *  "start" = left-aligned (staircase), "center" = centered (pyramid). Default false. */
  centerRows?: boolean | "start" | "center";
  /** Use circular cells instead of squares (for coin/token grids). Default false. */
  roundCells?: boolean;
  activeColor?: string;
  highlightColor?: string;
  cellSize?: number;
}

const DEFAULTS = {
  activeColor: "var(--kw-widget-active, #a78bfa)",
  highlightColor: "var(--kw-widget-highlight, #22c55e)",
  dimColor: "var(--kw-widget-dim, #64748b)",
  border: "var(--kw-widget-border, #3f3f46)",
  text: "var(--kw-widget-text, #e5e7eb)",
  cellSize: 44,
};

export function MatrixView({
  values,
  activeCell,
  highlightCells,
  dimCells,
  rowPointers = [],
  colPointers = [],
  showIndices = true,
  centerRows = false,
  roundCells = false,
  activeColor = DEFAULTS.activeColor,
  highlightColor = DEFAULTS.highlightColor,
  cellSize = DEFAULTS.cellSize,
}: MatrixViewProps) {
  if (values.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 16, color: DEFAULTS.dimColor, fontSize: "0.8rem" }}>
        (empty matrix)
      </div>
    );
  }

  const cols = Math.max(...values.map((r) => r.length));
  const raggedAlign = centerRows === true || centerRows === "center"
    ? "center"
    : centerRows === "start"
      ? "flex-start"
      : undefined;
  const isRagged = !!centerRows;

  const rowPtrMap = new Map<number, typeof rowPointers>();
  for (const p of rowPointers) {
    const list = rowPtrMap.get(p.row) ?? [];
    list.push(p);
    rowPtrMap.set(p.row, list);
  }
  const colPtrMap = new Map<number, typeof colPointers>();
  for (const p of colPointers) {
    const list = colPtrMap.get(p.col) ?? [];
    list.push(p);
    colPtrMap.set(p.col, list);
  }

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "0.5rem 0", overflow: "auto" }}>
      <div style={{ display: "inline-flex", flexDirection: "column", gap: 0 }}>
        {/* Column pointer row (hidden for ragged layouts) */}
        {colPointers.length > 0 && !isRagged && (
          <div style={{ display: "flex", marginLeft: showIndices ? 28 : 0 }}>
            {Array.from({ length: cols }, (_, c) => {
              const ptrs = colPtrMap.get(c);
              return (
                <div key={c} style={{ width: cellSize, textAlign: "center", fontSize: "0.65rem", fontWeight: 600, height: 16 }}>
                  {ptrs?.map((p, j) => (
                    <span key={j} style={{ color: p.color ?? activeColor }}>{p.label} </span>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {/* Column index row (hidden for ragged layouts) */}
        {showIndices && !isRagged && (
          <div style={{ display: "flex", marginLeft: 28 }}>
            {Array.from({ length: cols }, (_, c) => (
              <div key={c} style={{
                width: cellSize,
                textAlign: "center",
                fontSize: "0.6rem",
                color: DEFAULTS.dimColor,
                fontVariantNumeric: "tabular-nums",
                paddingBottom: 2,
              }}>
                {c}
              </div>
            ))}
          </div>
        )}

        {/* Rows */}
        {values.map((row, r) => {
          const rptrs = rowPtrMap.get(r);
          const rowLen = isRagged ? row.length : cols;
          return (
            <div key={r} style={{ display: "flex", alignItems: "center", justifyContent: raggedAlign }}>
              {/* Row index */}
              {showIndices && !isRagged && (
                <div style={{
                  width: 24,
                  textAlign: "right",
                  fontSize: "0.6rem",
                  color: DEFAULTS.dimColor,
                  fontVariantNumeric: "tabular-nums",
                  marginRight: 4,
                  flexShrink: 0,
                }}>
                  {r}
                </div>
              )}

              {/* Cells */}
              {Array.from({ length: rowLen }, (_, c) => {
                const key = `${r},${c}`;
                const isActive = activeCell && activeCell[0] === r && activeCell[1] === c;
                const isHighlight = highlightCells?.has(key) ?? false;
                const isDim = dimCells?.has(key) ?? false;
                const val = row[c] ?? "";

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
                  <div
                    key={c}
                    style={{
                      width: cellSize,
                      height: cellSize,
                      border: `1.5px solid ${border}`,
                      borderRadius: roundCells ? "50%" : 0,
                      background: bg,
                      color,
                      opacity,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: cellSize > 40 ? "0.85rem" : "0.75rem",
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                      transition: "all 0.2s ease",
                      margin: roundCells ? 1 : -0.5,
                    }}
                  >
                    {val}
                  </div>
                );
              })}

              {/* Row pointer label */}
              {rptrs && (
                <div style={{ marginLeft: 6, fontSize: "0.65rem", fontWeight: 600 }}>
                  {rptrs.map((p, j) => (
                    <span key={j} style={{ color: p.color ?? activeColor }}>{p.label} </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
