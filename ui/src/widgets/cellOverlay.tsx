import { useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { SvgLabel } from "./WidgetText";

export interface CellRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type CellValue = string | number | boolean | null | undefined;

export interface FormattedCell {
  text: string;
  empty: boolean;
  bool?: boolean;
}

/**
 * Display text for a cell. `null`/`undefined` are unfilled, infinities read as
 * ∞, booleans as T/F. Strings listed in `empty` are treated as unfilled too.
 */
export function formatCell(v: CellValue, empty?: readonly string[]): FormattedCell {
  if (v === null || v === undefined) return { text: "", empty: true };
  if (typeof v === "boolean") return { text: v ? "T" : "F", empty: false, bool: v };
  if (typeof v === "number") {
    if (v === Infinity) return { text: "∞", empty: false };
    if (v === -Infinity) return { text: "−∞", empty: false };
    if (Number.isNaN(v)) return { text: "—", empty: false };
    return { text: String(v), empty: false };
  }
  if (empty?.includes(v)) return { text: v, empty: true };
  return { text: v, empty: false };
}

/** Positions of every `[data-cell]` element, relative to `ref`. */
export function useCellRects(ref: RefObject<HTMLElement | null>, enabled: boolean): Map<string, CellRect> {
  const [rects, setRects] = useState<Map<string, CellRect>>(() => new Map());
  const sigRef = useRef("");

  useLayoutEffect(() => {
    if (!enabled) return;
    const root = ref.current;
    if (!root) return;
    const measure = () => {
      const base = root.getBoundingClientRect();
      const next = new Map<string, CellRect>();
      root.querySelectorAll<HTMLElement>("[data-cell]").forEach((el) => {
        const r = el.getBoundingClientRect();
        next.set(el.dataset.cell!, {
          x: Math.round(r.left - base.left),
          y: Math.round(r.top - base.top),
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      });
      const sig = Array.from(next, ([k, r]) => `${k}:${r.x},${r.y},${r.w},${r.h}`).join("|");
      if (sig !== sigRef.current) {
        sigRef.current = sig;
        setRects(next);
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  });

  return rects;
}

/**
 * Keys whose displayed value changed since the previous distinct snapshot,
 * plus a per-key version so a changed cell can remount and replay its pulse.
 */
export function useChangedCells(entries: [string, string][], enabled: boolean) {
  const ref = useRef<{ snap: Map<string, string> | null; flash: Set<string>; versions: Map<string, number> }>({
    snap: null,
    flash: new Set(),
    versions: new Map(),
  });
  const st = ref.current;
  if (!enabled) return { flash: st.flash, versions: st.versions };
  const next = new Map(entries);
  if (!st.snap) {
    st.snap = next;
    return { flash: st.flash, versions: st.versions };
  }
  let differs = next.size !== st.snap.size;
  if (!differs) for (const [k, v] of next) if (st.snap.get(k) !== v) { differs = true; break; }
  if (differs) {
    const flash = new Set<string>();
    for (const [k, v] of next) {
      const prev = st.snap.get(k);
      if (prev !== undefined && prev !== v && v !== "") {
        flash.add(k);
        st.versions.set(k, (st.versions.get(k) ?? 0) + 1);
      }
    }
    st.flash = flash;
    st.snap = next;
  }
  return { flash: st.flash, versions: st.versions };
}

export interface OverlayShape {
  d: string;
  color: string;
  dashed?: boolean;
  width?: number;
  arrow?: boolean;
  opacity?: number;
  label?: { x: number; y: number; text: string; anchor?: "start" | "middle" | "end" };
  dots?: { x: number; y: number }[];
}

export function CellOverlay({ shapes, width, height, under = false }: { shapes: OverlayShape[]; width: number; height: number; under?: boolean }) {
  const uid = useId().replace(/:/g, "");
  if (!shapes.length || width <= 0 || height <= 0) return null;
  const colors = Array.from(new Set(shapes.filter((s) => s.arrow).map((s) => s.color)));
  const markerId = (c: string) => `kw-ov-${uid}-${colors.indexOf(c)}`;
  return (
    <svg
      width={width}
      height={height}
      style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", overflow: "visible", zIndex: under ? -1 : 2 }}
      aria-hidden
    >
      <defs>
        {colors.map((c) => (
          <marker key={c} id={markerId(c)} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,1 L9,5 L0,9 z" fill={c} />
          </marker>
        ))}
      </defs>
      {shapes.map((s, i) => (
        <g key={i} opacity={s.opacity ?? 1}>
          <path
            d={s.d}
            fill="none"
            stroke={s.color}
            strokeWidth={s.width ?? 1.75}
            strokeDasharray={s.dashed ? "4 3" : undefined}
            strokeLinecap="round"
            strokeLinejoin="round"
            markerEnd={s.arrow ? `url(#${markerId(s.color)})` : undefined}
          />
          {s.dots?.map((p, j) => <circle key={j} cx={p.x} cy={p.y} r={3} fill={s.color} />)}
          {s.label && (
            <SvgLabel
              x={s.label.x}
              y={s.label.y}
              text={s.label.text}
              fill={s.color}
              fontSize={10}
              fontWeight={700}
              anchor={s.label.anchor ?? "middle"}
              dominantBaseline="central"
              halo="var(--kw-widget-bg, var(--card, #18181b))"
            />
          )}
        </g>
      ))}
    </svg>
  );
}

/** Where the segment from a rect's centre toward (tx, ty) leaves the rect. */
export function rectExit(r: CellRect, tx: number, ty: number, pad = 2): { x: number; y: number } {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const hw = r.w / 2 + pad;
  const hh = r.h / 2 + pad;
  const s = Math.min(dx === 0 ? Infinity : hw / Math.abs(dx), dy === 0 ? Infinity : hh / Math.abs(dy));
  return { x: cx + dx * s, y: cy + dy * s };
}

/**
 * A gently bowed arrow from one cell to another. `inset` pulls each end from
 * the cell edge toward its centre, so arrows between touching cells stay
 * visible. The label anchor sits at `labelAt` along the curve, offset sideways.
 */
export function linkPath(
  a: CellRect,
  b: CellRect,
  opts: { bend?: number; inset?: [number, number]; labelAt?: number; labelOffset?: number } = {},
): { d: string; mx: number; my: number } {
  const { bend = 0.12, inset = [0, 0], labelAt = 0.5, labelOffset = 0 } = opts;
  const acx = a.x + a.w / 2, acy = a.y + a.h / 2;
  const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
  const pe = rectExit(a, bcx, bcy, 1);
  const qe = rectExit(b, acx, acy, 3);
  const p = { x: pe.x + (acx - pe.x) * inset[0], y: pe.y + (acy - pe.y) * inset[0] };
  const q = { x: qe.x + (bcx - qe.x) * inset[1], y: qe.y + (bcy - qe.y) * inset[1] };
  const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
  const dx = q.x - p.x, dy = q.y - p.y;
  const straight = Math.abs(dx) < 1 || Math.abs(dy) < 1;
  const k = straight ? 0 : bend;
  const cx = mx - dy * k, cy = my + dx * k;
  const t = labelAt, u = 1 - t;
  const lx = u * u * p.x + 2 * u * t * cx + t * t * q.x;
  const ly = u * u * p.y + 2 * u * t * cy + t * t * q.y;
  const len = Math.hypot(dx, dy) || 1;
  return {
    d: `M${p.x},${p.y} Q${cx},${cy} ${q.x},${q.y}`,
    mx: lx + (-dy / len) * labelOffset,
    my: ly + (dx / len) * labelOffset,
  };
}
