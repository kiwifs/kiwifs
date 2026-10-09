import { useEffect, useRef, useState } from "react";
import { alpha } from "./colors";
import { WidgetText } from "./WidgetText";
import { headerGutterPx } from "./widgetLabel";
import { cellKey, parseCell, toCellSet, type CellRef, type ManyCells } from "./sets";
import {
  CellOverlay,
  formatCell,
  linkPath,
  useCellRects,
  useChangedCells,
  type CellValue,
  type OverlayShape,
} from "./cellOverlay";

export interface MatrixArrow {
  /** Cell read from, as `[r, c]` or `"r,c"`. */
  from: CellRef;
  /** Cell written. */
  to: CellRef;
  label?: string;
  color?: string;
  dashed?: boolean;
}

export interface MatrixLayer {
  label: string;
  values: CellValue[][];
}

export interface MatrixViewProps {
  /** 2D array of cell values. Rows can have different lengths (ragged/triangular).
   *  `null` is an unfilled slot; ±Infinity shows ∞; booleans show T/F. */
  values?: CellValue[][];
  /** The cell(s) being written, as `[r, c]`, `"r,c"`, or a list of either. */
  activeCell?: CellRef | CellRef[];
  /** More active cells; merged with `activeCell`. */
  activeCells?: ManyCells;
  /** Cells the active cell reads from — diagonal, above, left. */
  readCells?: ManyCells;
  /** Highlighted cells (`"r,c"` strings, `[r, c]` pairs, or a Set). */
  highlightCells?: ManyCells;
  /** Dimmed cells. */
  dimCells?: ManyCells;
  /** Cells that are not part of the table — e.g. `"lower"` for interval DP where i ≤ j. */
  mask?: "lower" | "upper" | ManyCells;
  /** Base color per cell; active, read, and highlight still win. */
  cellColors?: (string | null | undefined)[][];
  /** Shade numeric cells by value. `true` uses the table's min/max. */
  heatmap?: boolean | { min?: number; max?: number; color?: string };
  /** Small caption under each value — a choice arrow ↖ ↑ ←, a parent pointer. */
  sublabels?: (string | number | null | undefined)[][];
  /** Hover text per cell. */
  tooltips?: (string | null | undefined)[][];
  /** Strings that render as unfilled slots, e.g. `["."]`. */
  empty?: string[];
  /** Dependency arrows between cells. */
  arrows?: MatrixArrow[];
  /** A traceback path through the table, drawn as a line over the cells. */
  path?: CellRef[];
  pathColor?: string;
  /** Row pointer labels (shown right of the row). */
  rowPointers?: { row: number; label: string; color?: string }[];
  /** Column pointer labels (shown above the column). */
  colPointers?: { col: number; label: string; color?: string }[];
  /** Captions for each column, outside the index strip — the characters of a
   *  string in an edit-distance table, item weights in a knapsack, bit place
   *  values in a bit grid. */
  colHeaders?: (string | number | null)[];
  /** Captions for each row. */
  rowHeaders?: (string | number | null)[];
  /** Whether to show row/col indices. Default true. */
  showIndices?: boolean;
  /** Ragged row mode — only render actual cells per row (no padding to max width).
   *  "start" = left-aligned (staircase), "center" = centered (pyramid). Default false. */
  centerRows?: boolean | "start" | "center";
  /** Use circular cells instead of squares (for coin/token grids). Default false. */
  roundCells?: boolean;
  /** Slices of a 3D table, switchable by tabs; the shown slice replaces `values`. */
  layers?: MatrixLayer[];
  /** Index of the slice to show. Readers can still click the tabs. */
  layer?: number;
  onLayerChange?: (layer: number) => void;
  /** Pulse cells whose value changed since the previous step. Default true. */
  flash?: boolean;
  activeColor?: string;
  highlightColor?: string;
  readColor?: string;
  /** Cell size in px. Defaults to 44, shrinking for wide tables. */
  cellSize?: number;
}

const DEFAULTS = {
  activeColor: "var(--kw-widget-active, #a78bfa)",
  highlightColor: "var(--kw-widget-highlight, #22c55e)",
  dimColor: "var(--kw-widget-dim, #64748b)",
  border: "var(--kw-widget-border, #3f3f46)",
  text: "var(--kw-widget-text, #e5e7eb)",
  pathColor: "var(--kw-widget-path, #f59e0b)",
};

function autoMatrixCell(cols: number): number {
  if (cols <= 10) return 44;
  if (cols <= 14) return 38;
  if (cols <= 20) return 32;
  return 28;
}

function activeKeys(activeCell: MatrixViewProps["activeCell"], activeCells: ManyCells): Set<string> {
  const s = toCellSet(activeCells);
  if (activeCell == null) return s;
  const isPair = Array.isArray(activeCell) && activeCell.length === 2 && typeof activeCell[0] === "number";
  if (typeof activeCell === "string" || isPair || (!Array.isArray(activeCell) && typeof activeCell === "object")) {
    const [r, c] = parseCell(activeCell as CellRef);
    if (r >= 0 && c >= 0) s.add(`${r},${c}`);
    return s;
  }
  for (const k of toCellSet(activeCell as CellRef[])) s.add(k);
  return s;
}

export function MatrixView({
  values: valuesProp,
  activeCell,
  activeCells,
  readCells,
  highlightCells,
  dimCells,
  mask,
  cellColors,
  heatmap,
  sublabels,
  tooltips,
  empty,
  arrows,
  path,
  pathColor = DEFAULTS.pathColor,
  rowPointers = [],
  colPointers = [],
  colHeaders,
  rowHeaders,
  showIndices = true,
  centerRows = false,
  roundCells = false,
  layers,
  layer,
  onLayerChange,
  flash = true,
  activeColor = DEFAULTS.activeColor,
  highlightColor = DEFAULTS.highlightColor,
  readColor,
  cellSize,
}: MatrixViewProps) {
  const [layerSel, setLayerSel] = useState(layer ?? 0);
  useEffect(() => {
    if (layer != null) setLayerSel(layer);
  }, [layer]);
  const shownLayer = layers?.length ? Math.max(0, Math.min(layerSel, layers.length - 1)) : 0;
  const values = ((layers?.length ? layers[shownLayer]!.values : valuesProp) ?? []).map(
    (row) => (typeof row === "string" ? Array.from(row as string) : Array.isArray(row) ? row : []),
  ) as CellValue[][];

  const gridRef = useRef<HTMLDivElement>(null);
  const needsOverlay = !!arrows?.length || (path?.length ?? 0) > 1;
  const rects = useCellRects(gridRef, needsOverlay);

  const entries: [string, string][] = [];
  values.forEach((row, r) => row.forEach((v, c) => entries.push([`${r},${c}`, formatCell(v, empty).text])));
  const { flash: flashSet, versions } = useChangedCells(entries, flash);

  if (values.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 16, color: DEFAULTS.dimColor, fontSize: "0.8rem" }}>
        (empty matrix)
      </div>
    );
  }

  const cols = Math.max(...values.map((r) => r.length));
  const size = cellSize ?? autoMatrixCell(cols);
  const raggedAlign = centerRows === true || centerRows === "center"
    ? "center"
    : centerRows === "start"
      ? "flex-start"
      : undefined;
  const isRagged = !!centerRows;

  const active = activeKeys(activeCell, activeCells);
  const read = toCellSet(readCells);
  const highlight = toCellSet(highlightCells);
  const dim = toCellSet(dimCells);
  const masked = mask === "lower" || mask === "upper" ? null : toCellSet(mask as ManyCells);
  const isMasked = (r: number, c: number) =>
    mask === "lower" ? r > c : mask === "upper" ? c > r : masked?.has(`${r},${c}`) ?? false;
  const pathKeys = new Set((path ?? []).map(cellKey));
  const rc = readColor ?? activeColor;

  let heatMin = 0, heatMax = 0;
  const heatColor = (typeof heatmap === "object" && heatmap.color) || activeColor;
  if (heatmap) {
    const nums = values.flat().filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    heatMin = (typeof heatmap === "object" && heatmap.min != null) ? heatmap.min : Math.min(...nums);
    heatMax = (typeof heatmap === "object" && heatmap.max != null) ? heatmap.max : Math.max(...nums);
  }

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

  const hasRowHeaders = !!rowHeaders && !isRagged;
  const hasColHeaders = !!colHeaders && !isRagged;
  const rowHeaderW = hasRowHeaders ? headerGutterPx(rowHeaders) : 0;
  const indexGutter = showIndices && !isRagged ? 28 : 0;
  const leftGutter = rowHeaderW + indexGutter;

  const shapes: OverlayShape[] = [];
  const pathShapes: OverlayShape[] = [];
  if (needsOverlay) {
    if (path && path.length > 1) {
      const pts = path.map((p) => rects.get(cellKey(p))).filter((r): r is NonNullable<typeof r> => !!r)
        .map((r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 }));
      if (pts.length > 1) {
        pathShapes.push({
          d: "M" + pts.map((p) => `${p.x},${p.y}`).join(" L"),
          color: pathColor,
          width: 3,
          opacity: 0.9,
          arrow: true,
        });
      }
    }
    for (const a of arrows ?? []) {
      const p = rects.get(cellKey(a.from));
      const q = rects.get(cellKey(a.to));
      if (!p || !q) continue;
      const { d, mx, my } = linkPath(p, q, { bend: 0, inset: [0.55, 0.4], labelOffset: -9 });
      shapes.push({
        d,
        color: a.color ?? rc,
        dashed: a.dashed,
        arrow: true,
        label: a.label ? { x: mx, y: my, text: a.label } : undefined,
      });
    }
  }
  const box = gridRef.current;

  const setLayer = (i: number) => {
    setLayerSel(i);
    onLayerChange?.(i);
  };

  return (
    <div style={{ overflowX: "auto", padding: "0.5rem 0" }}>
      <div style={{ width: "max-content", margin: "0 auto", display: "flex", flexDirection: "column", gap: 0 }}>
        {layers && layers.length > 0 && (
          <div role="tablist" style={{ display: "flex", gap: 4, flexWrap: "wrap", marginLeft: leftGutter, marginBottom: 8 }}>
            {layers.map((l, i) => {
              const on = i === shownLayer;
              return (
                <button
                  key={i}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setLayer(i)}
                  style={{
                    fontSize: "0.68rem",
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: 999,
                    border: `1px solid ${on ? activeColor : DEFAULTS.border}`,
                    background: on ? alpha(activeColor, 20) : "transparent",
                    color: on ? DEFAULTS.text : DEFAULTS.dimColor,
                    cursor: "pointer",
                  }}
                >
                  <WidgetText text={l.label} />
                </button>
              );
            })}
          </div>
        )}

        {/* Column pointer row (hidden for ragged layouts) */}
        {colPointers.length > 0 && !isRagged && (
          <div style={{ display: "flex", marginLeft: leftGutter }}>
            {Array.from({ length: cols }, (_, c) => {
              const ptrs = colPtrMap.get(c);
              return (
                <div key={c} style={{ width: size - 1, textAlign: "center", fontSize: "0.65rem", fontWeight: 600, height: 16, whiteSpace: "nowrap" }}>
                  {ptrs?.map((p, j) => (
                    <span key={j} style={{ color: p.color ?? activeColor }}><WidgetText text={p.label} /> </span>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {/* Column header captions */}
        {hasColHeaders && (
          <div style={{ display: "flex", marginLeft: leftGutter }}>
            {Array.from({ length: cols }, (_, c) => (
              <div key={c} style={{
                width: size - 1,
                textAlign: "center",
                fontSize: "0.7rem",
                fontWeight: 700,
                color: DEFAULTS.text,
                fontFamily: "ui-monospace, SFMono-Regular, monospace",
                paddingBottom: 2,
              }}>
                <WidgetText text={colHeaders?.[c]} />
              </div>
            ))}
          </div>
        )}

        {/* Column index row (hidden for ragged layouts) */}
        {showIndices && !isRagged && (
          <div style={{ display: "flex", marginLeft: leftGutter }}>
            {Array.from({ length: cols }, (_, c) => (
              <div key={c} style={{
                width: size - 1,
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

        <div ref={gridRef} style={{ position: "relative", isolation: "isolate" }}>
          {values.map((row, r) => {
            const rptrs = rowPtrMap.get(r);
            const rowLen = isRagged ? row.length : cols;
            return (
              <div key={r} style={{ display: "flex", alignItems: "stretch", justifyContent: raggedAlign }}>
                {hasRowHeaders && (
                  <div style={{
                    width: rowHeaderW,
                    textAlign: "right",
                    fontSize: "0.7rem",
                    fontWeight: 700,
                    color: DEFAULTS.text,
                    fontFamily: "ui-monospace, SFMono-Regular, monospace",
                    paddingRight: 8,
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                    lineHeight: 1.2,
                    alignSelf: "center",
                    boxSizing: "border-box",
                  }}>
                    <WidgetText text={rowHeaders?.[r]} />
                  </div>
                )}

                {showIndices && !isRagged && (
                  <div style={{
                    width: 24,
                    textAlign: "right",
                    fontSize: "0.6rem",
                    color: DEFAULTS.dimColor,
                    fontVariantNumeric: "tabular-nums",
                    marginRight: 4,
                    flexShrink: 0,
                    alignSelf: "center",
                  }}>
                    {r}
                  </div>
                )}

                {Array.from({ length: rowLen }, (_, c) => {
                  const key = `${r},${c}`;
                  const cell = formatCell(row[c], empty);
                  const isMask = isMasked(r, c);
                  const isActive = active.has(key);
                  const isRead = !isActive && read.has(key);
                  const isHighlight = highlight.has(key);
                  const isDim = dim.has(key);
                  const onPath = pathKeys.has(key);
                  const custom = cellColors?.[r]?.[c];

                  let bg = "transparent";
                  let border = DEFAULTS.border;
                  let borderStyle = "solid";
                  let color = DEFAULTS.text;
                  let opacity = 1;

                  if (isMask) {
                    bg = alpha(DEFAULTS.dimColor, 8);
                    border = alpha(DEFAULTS.border, 50);
                    opacity = 0.35;
                  } else if (isActive) {
                    bg = activeColor;
                    border = activeColor;
                    color = "var(--kw-widget-active-foreground, #111827)";
                  } else if (isRead) {
                    bg = alpha(rc, 24);
                    border = rc;
                  } else if (isHighlight) {
                    bg = alpha(highlightColor, 18);
                    border = highlightColor;
                  } else if (custom) {
                    bg = alpha(custom, 22);
                    border = custom;
                    if (isDim) opacity = 0.5;
                  } else if (isDim) {
                    border = DEFAULTS.dimColor;
                    opacity = 0.5;
                  } else if (cell.empty) {
                    color = DEFAULTS.dimColor;
                    opacity = 0.75;
                  } else {
                    if (heatmap && typeof row[c] === "number" && Number.isFinite(row[c] as number) && heatMax > heatMin) {
                      const t = ((row[c] as number) - heatMin) / (heatMax - heatMin);
                      bg = alpha(heatColor, Math.round(6 + 52 * Math.max(0, Math.min(1, t))));
                    }
                    if (cell.bool !== undefined) color = cell.bool ? highlightColor : DEFAULTS.dimColor;
                  }
                  if (onPath && !isActive && !isMask) {
                    border = pathColor;
                    if (bg === "transparent") bg = alpha(pathColor, 10);
                  }

                  const sub = sublabels?.[r]?.[c];
                  const hasSub = sub != null && sub !== "";

                  return (
                    <div
                      key={`${c}-${versions.get(key) ?? 0}`}
                      data-cell={key}
                      title={tooltips?.[r]?.[c] ?? undefined}
                      className={flashSet.has(key) ? "kw-cell-flash" : undefined}
                      style={{
                        width: size,
                        minHeight: size,
                        border: `1.5px ${borderStyle} ${border}`,
                        borderRadius: roundCells ? "50%" : 0,
                        background: bg,
                        color,
                        opacity,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: size > 40 ? "0.85rem" : size > 32 ? "0.75rem" : "0.68rem",
                        fontWeight: 700,
                        fontVariantNumeric: "tabular-nums",
                        transition: "background 0.2s ease, border-color 0.2s ease, color 0.2s ease, opacity 0.2s ease",
                        margin: roundCells ? 1 : -0.5,
                        padding: 4,
                        boxSizing: "border-box",
                        position: isActive || onPath ? "relative" : undefined,
                        zIndex: isActive || isRead || onPath ? 1 : undefined,
                      }}
                    >
                      {!isMask && <WidgetText text={cell.text} />}
                      {!isMask && hasSub && (
                        <span style={{ fontSize: "0.55rem", fontWeight: 500, opacity: 0.65, lineHeight: 1 }}>
                          <WidgetText text={sub} />
                        </span>
                      )}
                    </div>
                  );
                })}

                {rptrs && (
                  <div style={{ marginLeft: 6, fontSize: "0.65rem", fontWeight: 600, alignSelf: "center", whiteSpace: "nowrap" }}>
                    {rptrs.map((p, j) => (
                      <span key={j} style={{ color: p.color ?? activeColor }}><WidgetText text={p.label} /> </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {needsOverlay && <CellOverlay under shapes={pathShapes} width={box?.offsetWidth || 1} height={box?.offsetHeight || 1} />}
          {needsOverlay && <CellOverlay shapes={shapes} width={box?.offsetWidth || 1} height={box?.offsetHeight || 1} />}
        </div>
      </div>
    </div>
  );
}
