import { useLayoutEffect, useRef, type ReactNode } from "react";
import { alpha } from "./colors";
import { WidgetText } from "./WidgetText";
import { headerGutterPx } from "./widgetLabel";
import { toSet, type Many } from "./sets";
import {
  CellOverlay,
  formatCell,
  linkPath,
  useCellRects,
  useChangedCells,
  type CellRect,
  type CellValue,
  type OverlayShape,
} from "./cellOverlay";

interface CellStyle {
  border: string;
  borderStyle?: "solid" | "dashed";
  background: string;
  color: string;
  opacity?: number;
}

export interface ArrayPointer {
  index: number;
  label: string;
  color?: string;
  /** Draw the label above (default) or below the cell. */
  side?: "top" | "bottom";
}

export interface ArrayArrow {
  /** Index the value is read from. */
  from: number;
  /** Index being written. */
  to: number;
  label?: string;
  color?: string;
  dashed?: boolean;
  /** Arc above (default) or below the row. */
  side?: "top" | "bottom";
}

export interface ArrayRange {
  /** First index covered, inclusive. */
  start: number;
  /** Last index covered, inclusive. */
  end: number;
  label?: string;
  color?: string;
  /** Bracket above (default) or below the row. */
  side?: "top" | "bottom";
}

export interface ArrayRowProps {
  /** The array values to display. `null` is an unfilled slot; ±Infinity shows ∞. */
  values: CellValue[];
  /** Row title shown to the left, e.g. `nums` or `dp`. */
  label?: string;
  /** Optional sublabel per cell (shown below the value, inside the cell). */
  sublabels?: (string | number | null | undefined)[];
  /** The cell(s) being written this step. */
  activeIndex?: number | number[];
  /** More active cells; merged with `activeIndex`. */
  activeIndices?: Many<number>;
  /** Cells the active cell reads from — `dp[i-1]`, `dp[i-2]`, `dp[c-w]`. */
  readIndices?: Many<number>;
  /** Secondary highlight (e.g. part of a streak). */
  highlightIndices?: Many<number>;
  /** "Done" / checked / greyed-out cells. */
  dimIndices?: Many<number>;
  /**
   * Base color per cell — e.g. one `groupColor` per component, matching the
   * same nodes in a TreeView or GraphView. Active and highlight still win.
   */
  cellColors?: (string | null | undefined)[];
  /** Named pointers shown above or below cells. */
  pointers?: ArrayPointer[];
  /** Dependency arcs between cells of this row. */
  arrows?: ArrayArrow[];
  /** Brackets over spans: a window, a partition segment, an interval. */
  ranges?: ArrayRange[];
  /** Hover text per cell. */
  tooltips?: (string | null | undefined)[];
  /** Strings that render as unfilled slots, e.g. `["."]`. */
  empty?: string[];
  /** Index captions instead of 0..n-1 — characters, amounts, `∅`. */
  indexLabels?: (string | number | null | undefined)[];
  /**
   * Blank cells to insert before the first value, so this row lines up under
   * another one. Stack two ArrayViews with an offset to show a pattern sitting
   * beneath the text it is being matched against.
   */
  offset?: number;
  /** Whether to show the index row beneath the cells. */
  showIndices?: boolean;
}

interface SharedProps {
  /** Primary highlight color. Defaults to purple. */
  activeColor?: string;
  /** Secondary highlight color. Defaults to green. */
  highlightColor?: string;
  /** Color of cells read by the active cell. Defaults to a tint of the active color. */
  readColor?: string;
  /** Cell size in px. Defaults to 48, shrinking for long arrays. */
  cellSize?: number;
  /** First index number. Default 0. */
  indexBase?: number;
  /** Wrap long arrays onto more lines instead of scrolling. Default false. */
  wrap?: boolean;
  /** Pulse cells whose value changed since the previous step. Default true. */
  flash?: boolean;
  /** Width of the row-label gutter. Defaults to fit the longest label. */
  labelWidth?: number;
}

export interface ArrayViewProps extends ArrayRowProps, SharedProps {}

export interface ArrayStackArrow {
  /** `[row, index]` of the source cell. */
  from: [number, number];
  /** `[row, index]` of the target cell. */
  to: [number, number];
  label?: string;
  color?: string;
  dashed?: boolean;
}

export interface ArrayStackProps extends SharedProps {
  /** Rows sharing one index axis: `nums` over `dp`, `hold` over `free`, `prev` over `cur`. */
  rows: ArrayRowProps[];
  /** Arrows between cells of different rows. */
  arrows?: ArrayStackArrow[];
  /** Index row under every row, only the last, or none. Default "last". */
  showIndices?: boolean | "last" | "all";
  /** Index captions shared by every row. */
  indexLabels?: (string | number | null | undefined)[];
  /** Vertical gap between rows in px. Default 2. */
  rowGap?: number;
}

const DEFAULTS = {
  activeColor: "var(--kw-widget-active, #a78bfa)",
  highlightColor: "var(--kw-widget-highlight, #22c55e)",
  dimColor: "var(--kw-widget-dim, #64748b)",
  border: "var(--kw-widget-border, #3f3f46)",
  text: "var(--kw-widget-text, #e5e7eb)",
};

const GAP = 6;
const POINTER_H = 18;
const INDEX_H = 14;
const ARC_LANE = 26;
const RANGE_LANE = 22;
const COL_GAP = 4;

export function autoCellSize(n: number): number {
  if (n <= 12) return 48;
  if (n <= 18) return 42;
  if (n <= 26) return 36;
  return 32;
}

function activeSet(row: ArrayRowProps): Set<number> {
  const s = new Set(toSet(row.activeIndices));
  const a = row.activeIndex;
  if (Array.isArray(a)) a.forEach((i) => s.add(i));
  else if (typeof a === "number" && a >= 0) s.add(a);
  return s;
}

function getCellStyle(
  i: number,
  sets: { active: Set<number>; read: Set<number>; highlight: Set<number>; dim: Set<number> },
  colors: { active: string; read: string; highlight: string },
  groupColor: string | null | undefined,
  cell: { empty: boolean; bool?: boolean },
): CellStyle {
  if (sets.active.has(i)) return {
    border: colors.active,
    background: colors.active,
    color: "var(--kw-widget-active-foreground, #111827)",
  };
  if (sets.read.has(i)) return {
    border: colors.read,
    background: alpha(colors.read, 22),
    color: DEFAULTS.text,
  };
  if (sets.highlight.has(i)) return {
    border: colors.highlight,
    background: alpha(colors.highlight, 18),
    color: DEFAULTS.text,
  };
  const isDim = sets.dim.has(i);
  if (groupColor) return {
    border: groupColor,
    background: alpha(groupColor, 18),
    color: DEFAULTS.text,
    opacity: isDim ? 0.55 : undefined,
  };
  if (isDim) return {
    border: DEFAULTS.dimColor,
    background: alpha(DEFAULTS.dimColor, 18),
    color: DEFAULTS.text,
    opacity: 0.55,
  };
  if (cell.empty) return {
    border: DEFAULTS.border,
    borderStyle: "dashed",
    background: "transparent",
    color: DEFAULTS.dimColor,
    opacity: 0.7,
  };
  return {
    border: DEFAULTS.border,
    background: "transparent",
    color: cell.bool === false ? DEFAULTS.dimColor : cell.bool ? colors.highlight : DEFAULTS.text,
  };
}

interface Lanes {
  rangeTop: number;
  arcTop: number;
  ptrBottom: number;
  arcBottom: number;
  rangeBottom: number;
  index: number;
}

function rowLanes(row: ArrayRowProps, showIdx: boolean): Lanes {
  const ptrs = row.pointers ?? [];
  const arrows = row.arrows;
  const ranges = row.ranges;
  return {
    rangeTop: ranges && (ranges.length === 0 || ranges.some((r) => r.side !== "bottom")) ? RANGE_LANE : 0,
    arcTop: arrows && (arrows.length === 0 || arrows.some((a) => a.side !== "bottom")) ? ARC_LANE : 0,
    ptrBottom: ptrs.some((p) => p.side === "bottom") ? POINTER_H : 0,
    arcBottom: arrows?.some((a) => a.side === "bottom") ? ARC_LANE : 0,
    rangeBottom: ranges?.some((r) => r.side === "bottom") ? RANGE_LANE : 0,
    index: showIdx ? INDEX_H : 0,
  };
}

function rowShapes(
  rowIdx: number,
  row: ArrayRowProps,
  lanes: Lanes,
  rects: Map<string, CellRect>,
  activeColor: string,
): OverlayShape[] {
  const out: OverlayShape[] = [];
  const rect = (i: number) => rects.get(`${rowIdx}:${i}`);

  for (const a of row.arrows ?? []) {
    const p = rect(a.from), q = rect(a.to);
    if (!p || !q || a.from === a.to) continue;
    const color = a.color ?? activeColor;
    const dir = Math.sign(q.x - p.x);
    const inset = Math.min(p.w, q.w) * 0.26;
    const x1 = p.x + p.w / 2 + dir * inset;
    const x2 = q.x + q.w / 2 - dir * inset;
    const top = a.side !== "bottom";
    const y = top ? p.y - 1 : p.y + p.h + 1;
    const room = top ? COL_GAP + POINTER_H + lanes.arcTop - 4 : COL_GAP + lanes.index + lanes.ptrBottom + lanes.arcBottom - 4;
    const rise = Math.min(room, 12 + Math.abs(x2 - x1) * 0.22);
    const cy = top ? y - rise * 1.33 : y + rise * 1.33;
    const mx = (x1 + x2) / 2;
    out.push({
      d: `M${x1},${y} Q${mx},${cy} ${x2},${y}`,
      color,
      dashed: a.dashed,
      arrow: true,
      label: a.label ? { x: mx, y: top ? y - rise - 6 : y + rise + 6, text: a.label } : undefined,
    });
  }

  for (const r of row.ranges ?? []) {
    const lo = Math.min(r.start, r.end), hi = Math.max(r.start, r.end);
    const p = rect(lo), q = rect(hi);
    if (!p || !q) continue;
    const color = r.color ?? activeColor;
    const x1 = p.x + 2, x2 = q.x + q.w - 2;
    const top = r.side !== "bottom";
    if (top) {
      const y = p.y - COL_GAP - POINTER_H - lanes.arcTop - 6;
      out.push({ d: `M${x1},${y + 6} V${y} H${x2} V${y + 6}`, color, width: 1.5, label: r.label ? { x: (x1 + x2) / 2, y: y - 7, text: r.label } : undefined });
    } else {
      const y = p.y + p.h + COL_GAP + lanes.index + lanes.ptrBottom + lanes.arcBottom + 6;
      out.push({ d: `M${x1},${y - 6} V${y} H${x2} V${y - 6}`, color, width: 1.5, label: r.label ? { x: (x1 + x2) / 2, y: y + 8, text: r.label } : undefined });
    }
  }
  return out;
}

function PointerRow({ ptrs, activeColor, height }: { ptrs?: ArrayPointer[]; activeColor: string; height: number }) {
  return (
    <div style={{ height, display: "flex", gap: 4, fontSize: "0.7rem", fontWeight: 600, whiteSpace: "nowrap" }}>
      {ptrs?.length
        ? ptrs.map((p, j) => <span key={j} style={{ color: p.color ?? activeColor }}><WidgetText text={p.label} /></span>)
        : <span style={{ visibility: "hidden" }}>_</span>}
    </div>
  );
}

function ArrayRow({
  rowIdx,
  row,
  lanes,
  cellSize,
  labelWidth,
  indexBase,
  indexLabels,
  wrap,
  colors,
  flash,
  versions,
}: {
  rowIdx: number;
  row: ArrayRowProps;
  lanes: Lanes;
  cellSize: number;
  labelWidth: number;
  indexBase: number;
  indexLabels?: (string | number | null | undefined)[];
  wrap: boolean;
  colors: { active: string; read: string; highlight: string };
  flash: Set<string>;
  versions: Map<string, number>;
}) {
  const sets = {
    active: activeSet(row),
    read: toSet(row.readIndices),
    highlight: toSet(row.highlightIndices),
    dim: toSet(row.dimIndices),
  };
  const top = new Map<number, ArrayPointer[]>();
  const bottom = new Map<number, ArrayPointer[]>();
  for (const p of row.pointers ?? []) {
    const m = p.side === "bottom" ? bottom : top;
    const list = m.get(p.index) ?? [];
    list.push(p);
    m.set(p.index, list);
  }
  const idxCaptions = row.indexLabels ?? indexLabels;
  const topPad = lanes.rangeTop + lanes.arcTop;
  const bottomPad = lanes.arcBottom + lanes.rangeBottom;
  const offset = Math.max(0, row.offset ?? 0);

  let label: ReactNode = null;
  if (labelWidth > 0) {
    label = (
      <div
        style={{
          width: labelWidth,
          flexShrink: 0,
          marginTop: topPad + POINTER_H + COL_GAP,
          height: cellSize,
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          paddingRight: 10,
          fontSize: "0.72rem",
          fontWeight: 700,
          color: "var(--kw-widget-dim, #94a3b8)",
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
          whiteSpace: "nowrap",
        }}
      >
        <WidgetText text={row.label ?? ""} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "flex-start", width: wrap ? "100%" : undefined }}>
      {label}
      <div
        style={wrap
          ? { display: "flex", gap: GAP, flexWrap: "wrap", justifyContent: "center", flex: "1 1 auto", minWidth: 0 }
          : { display: "flex", gap: GAP }}
      >
        {Array.from({ length: offset }, (_, i) => (
          <div key={`pad-${i}`} style={{ width: cellSize, flexShrink: 0 }} aria-hidden />
        ))}
        {row.values.map((raw, i) => {
          const cell = formatCell(raw, row.empty);
          const style = getCellStyle(i, sets, colors, row.cellColors?.[i], cell);
          const sub = row.sublabels?.[i];
          const hasSub = sub != null && sub !== "";
          const mainFontSize = hasSub
            ? (cellSize > 40 ? "0.85rem" : "0.75rem")
            : (cellSize > 40 ? "1rem" : cellSize > 34 ? "0.85rem" : "0.78rem");
          const key = `${rowIdx}:${i}`;
          const caption = idxCaptions?.[i] ?? indexBase + i;

          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: COL_GAP, flexShrink: 0 }}>
              {topPad > 0 && <div style={{ height: topPad - COL_GAP }} aria-hidden />}
              <PointerRow ptrs={top.get(i)} activeColor={colors.active} height={POINTER_H} />
              <div
                key={`c${versions.get(key) ?? 0}`}
                data-cell={key}
                data-active={sets.active.has(i) ? "" : undefined}
                title={row.tooltips?.[i] ?? undefined}
                className={flash.has(key) ? "kw-cell-flash" : undefined}
                style={{
                  width: cellSize,
                  height: cellSize,
                  borderRadius: 8,
                  border: `2px ${style.borderStyle ?? "solid"} ${style.border}`,
                  background: style.background,
                  color: style.color,
                  opacity: style.opacity ?? 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: mainFontSize,
                  transition: "background 0.2s ease, border-color 0.2s ease, color 0.2s ease, opacity 0.2s ease",
                  fontVariantNumeric: "tabular-nums",
                  boxSizing: "border-box",
                }}
              >
                <span><WidgetText text={cell.text} /></span>
                {hasSub && (
                  <span style={{ fontSize: "0.55rem", fontWeight: 500, opacity: 0.6, lineHeight: 1 }}>
                    <WidgetText text={sub} />
                  </span>
                )}
              </div>
              {lanes.index > 0 && (
                <div style={{ height: INDEX_H, lineHeight: `${INDEX_H}px`, fontSize: "0.65rem", color: DEFAULTS.dimColor, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                  <WidgetText text={caption} />
                </div>
              )}
              {lanes.ptrBottom > 0 && <PointerRow ptrs={bottom.get(i)} activeColor={colors.active} height={POINTER_H} />}
              {bottomPad > 0 && <div style={{ height: bottomPad - COL_GAP }} aria-hidden />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Several arrays on one shared index axis, with arrows between rows. */
export function ArrayStack({
  rows: rowsIn,
  arrows,
  showIndices = "last",
  indexLabels,
  indexBase = 0,
  activeColor = DEFAULTS.activeColor,
  highlightColor = DEFAULTS.highlightColor,
  readColor,
  cellSize,
  wrap = false,
  flash = true,
  labelWidth,
  rowGap,
}: ArrayStackProps) {
  const innerRef = useRef<HTMLDivElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const rows = rowsIn.map((r) => {
    const v = r.values as unknown;
    return typeof v === "string" ? { ...r, values: Array.from(v) } : Array.isArray(v) ? r : { ...r, values: [] };
  });
  const longest = Math.max(0, ...rows.map((r) => r.values.length + Math.max(0, r.offset ?? 0)));
  const size = cellSize ?? autoCellSize(longest);
  const anyLabel = rows.some((r) => r.label);
  const gutter = labelWidth ?? (anyLabel ? headerGutterPx(rows.map((r) => r.label ?? null), { min: 28 }) : 0);
  const colors = { active: activeColor, read: readColor ?? activeColor, highlight: highlightColor };

  const needsOverlay = !!arrows?.length || rows.some((r) => r.arrows?.length || r.ranges?.length);
  const rects = useCellRects(innerRef, needsOverlay);

  const entries: [string, string][] = [];
  rows.forEach((r, ri) => r.values.forEach((v, i) => entries.push([`${ri}:${i}`, formatCell(v, r.empty).text])));
  const { flash: flashSet, versions } = useChangedCells(entries, flash);

  const lanes = rows.map((r, ri) => {
    const show = r.showIndices ?? (showIndices === true || showIndices === "all" || (showIndices === "last" && ri === rows.length - 1));
    return rowLanes(r, show);
  });

  const shapes: OverlayShape[] = [];
  if (needsOverlay) {
    rows.forEach((r, ri) => shapes.push(...rowShapes(ri, r, lanes[ri]!, rects, activeColor)));
    for (const a of arrows ?? []) {
      const p = rects.get(`${a.from[0]}:${a.from[1]}`);
      const q = rects.get(`${a.to[0]}:${a.to[1]}`);
      if (!p || !q) continue;
      const { d, mx, my } = linkPath(p, q, { labelAt: 0.3, labelOffset: 10 });
      shapes.push({ d, color: a.color ?? activeColor, dashed: a.dashed, arrow: true, label: a.label ? { x: mx, y: my, text: a.label } : undefined });
    }
  }
  const box = innerRef.current;
  const gap = rowGap ?? (arrows?.length ? 36 : 2);

  const activeSig = rows.map((r) => Array.from(activeSet(r)).join(",")).join("|");
  useLayoutEffect(() => {
    const outer = outerRef.current;
    if (!outer || wrap || outer.scrollWidth <= outer.clientWidth) return;
    const el = outer.querySelector<HTMLElement>("[data-active]");
    if (!el) return;
    const o = outer.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.left < o.left + 8) outer.scrollLeft += r.left - o.left - 24;
    else if (r.right > o.right - 8) outer.scrollLeft += r.right - o.right + 24;
  }, [activeSig, wrap]);

  return (
    <div ref={outerRef} style={{ overflowX: wrap ? "visible" : "auto", padding: "0.75rem 0" }}>
      <div
        ref={innerRef}
        style={{
          position: "relative",
          width: wrap ? undefined : "max-content",
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          alignItems: wrap ? "center" : "flex-start",
          gap,
        }}
      >
        {rows.map((r, ri) => (
          <ArrayRow
            key={ri}
            rowIdx={ri}
            row={r}
            lanes={lanes[ri]!}
            cellSize={size}
            labelWidth={gutter}
            indexBase={indexBase}
            indexLabels={indexLabels}
            wrap={wrap}
            colors={colors}
            flash={flashSet}
            versions={versions}
          />
        ))}
        {needsOverlay && (
          <CellOverlay shapes={shapes} width={box?.offsetWidth || 1} height={box?.offsetHeight || 1} />
        )}
      </div>
    </div>
  );
}

export function ArrayView({
  activeColor,
  highlightColor,
  readColor,
  cellSize,
  indexBase,
  wrap,
  flash,
  labelWidth,
  showIndices = true,
  ...row
}: ArrayViewProps) {
  return (
    <ArrayStack
      rows={[{ ...row, showIndices }]}
      activeColor={activeColor}
      highlightColor={highlightColor}
      readColor={readColor}
      cellSize={cellSize}
      indexBase={indexBase}
      wrap={wrap}
      flash={flash}
      labelWidth={labelWidth}
    />
  );
}
