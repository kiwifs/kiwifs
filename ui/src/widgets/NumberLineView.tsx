import { useId } from "react";
import { compile } from "@kw/lib/expr";
import { toSet, type Many } from "./sets";
import { SvgLabel } from "./WidgetText";
import { expandRange, niceTicks } from "./plotLayout";
import { assignLanes } from "./lanes";
import { objectsOf, shortText, summarizeNumberLine } from "./widgetA11y";
import { partHandlers, useInspect, whyFor, type InspectKind, type InspectRef } from "./inspect";

/**
 * A single value axis.
 *
 * Inequalities, binary-search-on-answer buckets, interval arithmetic, SLO
 * thresholds, two pointers on a *value* rather than an index. Not
 * `TimelineView`, which is Gantt lanes over time; not `PlotView`, which needs
 * a second dimension to say anything.
 *
 * Endpoint styles follow Manim and Desmos: a filled dot is closed, a hollow
 * one is open, a cross is excluded.
 */

export type PointStyle = "closed" | "open" | "cross";

export interface NumberLinePoint {
  id?: string | number;
  x: number;
  label?: string;
  style?: PointStyle;
  color?: string;
}

export interface NumberLineInterval {
  id?: string | number;
  from: number;
  to: number;
  /** `true` draws a hollow left endpoint — `(from, to]`. */
  fromOpen?: boolean;
  toOpen?: boolean;
  label?: string;
  color?: string;
  /** Row to draw on. Omit to let overlapping intervals stack. */
  row?: number;
}

export interface NumberLineRay {
  id?: string | number;
  at: number;
  dir: "left" | "right";
  open?: boolean;
  label?: string;
  color?: string;
}

export interface NumberLineMark {
  at: number;
  label?: string;
  color?: string;
}

export interface NumberLinePointer {
  at: number;
  label: string;
  color?: string;
}

export interface NumberLineViewProps {
  /** Left end of the axis. */
  min?: number;
  /** Right end of the axis. */
  max?: number;
  /** `[min, max]` or `[min, max, step]`, an alias for the three props. */
  xRange?: readonly number[];
  /** Tick spacing. Omit for automatic nice ticks. */
  step?: number;
  /** Explicit tick values, overriding `step`. */
  ticks?: number[];
  /** Print the number under each tick. Default true. */
  includeNumbers?: boolean;
  /** `"log"` needs a positive `min`. Default "linear". */
  scale?: "linear" | "log";
  /** Dots on the axis: closed, open, or a cross. */
  points?: NumberLinePoint[];
  /** Spans between two values, each end open or closed. */
  intervals?: NumberLineInterval[];
  /** Half-lines running off one end of the axis. */
  rays?: NumberLineRay[];
  /** Vertical ticks with a caption: query points, boundaries. */
  marks?: NumberLineMark[];
  /** Named pointers above the axis — `lo`, `hi`, `mid`. */
  pointers?: NumberLinePointer[];
  /** Position of a sweep cursor. */
  sweep?: number;
  /** Caption beside the sweep cursor. */
  sweepLabel?: string;
  /** Shade the axis wherever this formula in `x` is true — `"x^2 < 9"`. */
  predicate?: string;
  /** Caption on the shaded `predicate` region. */
  predicateLabel?: string;
  /** Fill of the `predicate` region. Defaults to the highlight color. */
  predicateColor?: string;
  /** Point or interval ids emphasised this step. */
  activeIds?: Many<string | number>;
  /** Secondary-highlighted point or interval ids. */
  highlightIds?: Many<string | number>;
  /** Dimmed point or interval ids. */
  dimIds?: Many<string | number>;
  /** Axis caption. */
  label?: string;
  /** Canvas width in px. Default 560. */
  width?: number;
  /** Reported when the reader selects a point or an interval. */
  onSelect?: (ref: InspectRef) => void;
  /** Point or interval id → explanation, revealed on select. */
  why?: Record<string, string>;
  /** Controlled selection, as point or interval ids. */
  selected?: Many<string | number>;
  /** Name for the inspect bus. Defaults to "numberline". */
  widgetId?: string;
  /** Primary highlight color. */
  activeColor?: string;
  /** Secondary highlight color. */
  highlightColor?: string;
  /** Accessible name. Defaults to a summary of the axis and its marks. */
  ariaLabel?: string;
}

const DEFAULTS = {
  activeColor: "var(--kw-widget-active, #a78bfa)",
  highlightColor: "var(--kw-widget-highlight, #22c55e)",
  dimColor: "var(--kw-widget-dim, #64748b)",
  border: "var(--kw-widget-border, #3f3f46)",
  text: "var(--kw-widget-text, #e5e7eb)",
  surface: "var(--kw-widget-surface, #18181b)",
  bar: "var(--kw-widget-bar, #94a3b8)",
  width: 560,
};

const PAD_X = 34;
const ROW_H = 20;
const AXIS_Y_FROM_TOP = 26;
const MAX_TICKS = 200;
const MAX_DECADE_LABELS = 12;
const PREDICATE_SAMPLES = 400;

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function stringSet(value: Many<string | number>): Set<string> {
  return new Set([...toSet(value)].map(String));
}

/** The axis extent, whatever the author wrote: missing, NaN, reversed or empty. */
export function axisRange(
  min: unknown,
  max: unknown,
  xRange?: readonly unknown[],
): { min: number; max: number; step?: number } {
  const r = Array.isArray(xRange) ? xRange : [];
  let lo = finite(r[0]) ? r[0] : finite(min) ? min : 0;
  let hi = finite(r[1]) ? r[1] : finite(max) ? max : lo + 10;
  if (lo > hi) [lo, hi] = [hi, lo];
  const e = expandRange(lo, hi);
  return { min: e.min, max: e.max, step: finite(r[2]) ? r[2] : undefined };
}

/** Tick values, bounded however small the step or wide the log range. */
export function axisTicks(
  min: number,
  max: number,
  opts: { log?: boolean; step?: number; ticks?: readonly unknown[] } = {},
): number[] {
  const inRange = (t: number) => t >= min - 1e-9 * (max - min) && t <= max + 1e-9 * (max - min);
  if (Array.isArray(opts.ticks)) {
    return opts.ticks.filter((t): t is number => finite(t) && inRange(t) && (!opts.log || t > 0)).slice(0, MAX_TICKS);
  }
  if (opts.log) {
    const decades: number[] = [];
    const k0 = Math.ceil(Math.log10(min) - 1e-9);
    const k1 = Math.floor(Math.log10(max) + 1e-9);
    const every = Math.max(1, Math.ceil((k1 - k0 + 1) / MAX_DECADE_LABELS));
    for (let k = k0; k <= k1 && decades.length < MAX_TICKS; k += every) decades.push(10 ** k);
    if (decades.length >= 2) return decades;
    return niceTicks(min, max, 6).filter((t) => t > 0 && inRange(t));
  }
  const step = opts.step;
  if (finite(step) && step > 0 && (max - min) / step <= MAX_TICKS) {
    return Array.from({ length: Math.floor((max - min) / step + 1e-9) + 1 }, (_, i) => min + i * step);
  }
  return niceTicks(min, max, 6).filter(inRange);
}

function tickText(t: number): string {
  if (Number.isInteger(t)) return String(t);
  if (Math.abs(t) < 0.01) return String(Number(t.toPrecision(2)));
  return String(Number(t.toFixed(2)));
}

/** Where `predicate` holds on [min, max], or why it could not be evaluated. */
export function predicateRuns(
  predicate: string,
  min: number,
  max: number,
  log = false,
): { runs: { from: number; to: number }[]; error?: string } {
  let f: ReturnType<typeof compile>;
  try {
    f = compile(predicate);
  } catch (err) {
    return { runs: [], error: err instanceof Error ? err.message : String(err) };
  }
  let error: string | undefined;
  const holds = (x: number) => {
    if (error) return false;
    try {
      const v = f({ x });
      return v !== 0 && !Number.isNaN(v);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      return false;
    }
  };
  const runs = log
    ? shadeWhere(Math.log(min), Math.log(max), (u) => holds(Math.exp(u)), PREDICATE_SAMPLES).map((r) => ({
        from: Math.exp(r.from),
        to: Math.exp(r.to),
      }))
    : shadeWhere(min, max, holds, PREDICATE_SAMPLES);
  return error ? { runs: [], error } : { runs };
}

export function NumberLineView({
  min: minIn,
  max: maxIn,
  xRange,
  step: stepIn,
  ticks,
  includeNumbers = true,
  scale: scaleKind = "linear",
  points: pointsIn,
  intervals: intervalsIn,
  rays: raysIn,
  marks: marksIn,
  pointers: pointersIn,
  sweep,
  sweepLabel,
  predicate,
  predicateLabel,
  predicateColor,
  activeIds: activeIdsIn,
  highlightIds: highlightIdsIn,
  dimIds: dimIdsIn,
  label,
  width: widthIn = DEFAULTS.width,
  onSelect,
  why,
  selected,
  widgetId = "numberline",
  activeColor = DEFAULTS.activeColor,
  highlightColor = DEFAULTS.highlightColor,
  ariaLabel,
}: NumberLineViewProps) {
  const bus = useInspect();
  const mergedWhy = { ...bus.why, ...(why ?? {}) };
  const activeIds = stringSet(activeIdsIn);
  const highlightIds = stringSet(highlightIdsIn);
  const dimIds = stringSet(dimIdsIn);
  const selectedKeys = stringSet(selected);
  const uid = useId().replace(/:/g, "");
  const arrowId = `kw-nl-arrow-${uid}`;

  const range = axisRange(minIn, maxIn, xRange);
  const { min, max } = range;
  const step = finite(stepIn) ? stepIn : range.step;
  const logScale = scaleKind === "log" && min > 0;
  // Zero and negatives have no place on a log axis; drawing them at -∞ would
  // put them off the canvas.
  const onAxis = (v: unknown): v is number => finite(v) && (!logScale || v > 0);

  const points = objectsOf<NumberLinePoint>(pointsIn).filter((p) => onAxis(p.x));
  const intervals = objectsOf<NumberLineInterval>(intervalsIn).filter(
    (iv) => finite(iv.from) && finite(iv.to) && (!logScale || Math.max(iv.from, iv.to) > 0),
  );
  const rays = objectsOf<NumberLineRay>(raysIn).filter((r) => onAxis(r.at));
  const marks = objectsOf<NumberLineMark>(marksIn).filter((m) => onAxis(m.at));
  const pointers = objectsOf<NumberLinePointer>(pointersIn).filter((p) => onAxis(p.at));
  const sweepAt = onAxis(sweep) ? sweep : undefined;

  const width = finite(widthIn) ? Math.max(PAD_X * 2 + 40, widthIn) : DEFAULTS.width;
  const plotW = width - PAD_X * 2;
  const project = (v: number): number => {
    if (logScale) {
      const lo = Math.log(min);
      const hi = Math.log(max);
      const t = (Math.log(Math.max(v, min)) - lo) / (hi - lo || 1);
      return PAD_X + t * plotW;
    }
    return PAD_X + ((v - min) / (max - min || 1)) * plotW;
  };

  const rows = assignLanes(
    intervals.map((iv) => ({
      start: Math.min(iv.from, iv.to),
      end: Math.max(iv.from, iv.to),
      lane: finite(iv.row) ? Math.min(iv.row, intervals.length) : undefined,
    })),
  );
  const rowCount = rows.reduce((hi, r) => Math.max(hi, r + 1), 0);

  const shading = predicate ? predicateRuns(String(predicate), min, max, logScale) : null;

  const axisY = AXIS_Y_FROM_TOP + rowCount * ROW_H;
  const footer = (includeNumbers ? 30 : 16) + (label ? 14 : 0);
  const height = axisY + footer + (shading?.error ? 14 : 0);

  const tickValues = axisTicks(min, max, { log: logScale, step, ticks });

  const idOf = (item: { id?: string | number }, kind: string, i: number) => String(item.id ?? `${kind}${i}`);
  const isSelected = (kind: InspectKind, key: string) =>
    selectedKeys.has(key) ||
    (bus.selected?.widget === widgetId && bus.selected.kind === kind && bus.selected.key === key);
  const selectable = (kind: InspectKind, key: string) =>
    onSelect !== undefined || whyFor(mergedWhy, { widget: widgetId, kind, key }) !== undefined;
  const firstSelectable = (() => {
    const p = points.findIndex((pt, i) => selectable("point", idOf(pt, "pt", i)));
    if (p >= 0) return `point:${idOf(points[p]!, "pt", p)}`;
    const v = intervals.findIndex((iv, i) => selectable("interval", idOf(iv, "iv", i)));
    return v >= 0 ? `interval:${idOf(intervals[v]!, "iv", v)}` : undefined;
  })();
  const partProps = (kind: InspectKind, key: string) =>
    selectable(kind, key)
      ? {
          ...partHandlers(widgetId, kind, key, bus, {
            onSelect,
            why: mergedWhy,
            tabbable: firstSelectable === `${kind}:${key}`,
          }),
          "aria-selected": isSelected(kind, key) || undefined,
          style: { cursor: "pointer", outline: "none", transition: "opacity 0.25s ease" },
        }
      : { style: { transition: "opacity 0.25s ease" } };

  const toneOf = (id: string, base?: string, picked = false) => {
    if (picked || activeIds.has(id)) return { color: activeColor, opacity: 1, weight: picked ? 3 : 2.5 };
    if (highlightIds.has(id)) return { color: highlightColor, opacity: 1, weight: 2.5 };
    if (dimIds.has(id)) return { color: DEFAULTS.dimColor, opacity: 0.4, weight: 1.5 };
    return { color: base ?? DEFAULTS.bar, opacity: 1, weight: 2 };
  };

  /** Closed = filled, open = hollow, cross = ✕. Manim / Desmos convention. */
  const endpoint = (x: number, y: number, open: boolean, color: string, style?: PointStyle) => {
    if (style === "cross") {
      return (
        <g>
          <line x1={x - 4} y1={y - 4} x2={x + 4} y2={y + 4} stroke={color} strokeWidth={2} />
          <line x1={x - 4} y1={y + 4} x2={x + 4} y2={y - 4} stroke={color} strokeWidth={2} />
        </g>
      );
    }
    return (
      <circle
        cx={x}
        cy={y}
        r={4.5}
        fill={open ? DEFAULTS.surface : color}
        stroke={color}
        strokeWidth={2}
      />
    );
  };

  const interactive = firstSelectable !== undefined;

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "0.5rem 0", overflow: "auto" }}>
      <svg
        width={width}
        height={height}
        role={interactive ? "graphics-document" : "img"}
        aria-label={ariaLabel ?? summarizeNumberLine({ min, max, points, intervals })}
        style={{ display: "block" }}
      >
        <defs>
          <marker id={arrowId} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={DEFAULTS.bar} />
          </marker>
        </defs>

        {/* Predicate shading — a backdrop on the axis itself */}
        {shading?.runs.map((run, i) => (
          <rect
            key={`sh${i}`}
            x={project(run.from)}
            y={axisY - 5}
            width={Math.max(1, project(run.to) - project(run.from))}
            height={10}
            rx={3}
            fill={predicateColor ?? highlightColor}
            opacity={0.35}
          />
        ))}
        {predicateLabel && shading?.runs[0] && (
          <SvgLabel
            x={(project(shading.runs[0].from) + project(shading.runs[0].to)) / 2}
            y={axisY - 9}
            text={predicateLabel}
            anchor="middle"
            fill={predicateColor ?? highlightColor}
            fontSize={10}
            fontWeight={600}
            halo={DEFAULTS.surface}
          />
        )}

        {/* Stacked interval rows above the axis */}
        {intervals.map((iv, i) => {
          const id = idOf(iv, "iv", i);
          const tone = toneOf(id, iv.color, isSelected("interval", id));
          const y = AXIS_Y_FROM_TOP + (rowCount - 1 - rows[i]!) * ROW_H;
          const x1 = project(Math.min(iv.from, iv.to));
          const x2 = project(Math.max(iv.from, iv.to));
          const leftOpen = iv.from <= iv.to ? Boolean(iv.fromOpen) : Boolean(iv.toOpen);
          const rightOpen = iv.from <= iv.to ? Boolean(iv.toOpen) : Boolean(iv.fromOpen);
          return (
            <g key={`iv${i}`} opacity={tone.opacity} {...partProps("interval", id)}>
              <line x1={x1} y1={y} x2={x2} y2={y} stroke={tone.color} strokeWidth={tone.weight + 1.5} />
              {endpoint(x1, y, leftOpen, tone.color)}
              {endpoint(x2, y, rightOpen, tone.color)}
              {iv.label && (
                <SvgLabel
                  x={(x1 + x2) / 2}
                  y={y - 9}
                  text={shortText(iv.label)}
                  anchor="middle"
                  fill={tone.color}
                  fontSize={10}
                  fontWeight={600}
                  fontFamily="ui-monospace, SFMono-Regular, monospace"
                  halo={DEFAULTS.surface}
                />
              )}
            </g>
          );
        })}

        {/* Rays — an inequality with no far end */}
        {rays.map((ray, i) => {
          const id = idOf(ray, "ray", i);
          const tone = toneOf(id, ray.color);
          const x = project(ray.at);
          const end = ray.dir === "left" ? PAD_X - 14 : PAD_X + plotW + 14;
          return (
            <g key={`ray${i}`} opacity={tone.opacity}>
              <line
                x1={x}
                y1={axisY}
                x2={end}
                y2={axisY}
                stroke={tone.color}
                strokeWidth={tone.weight + 1.5}
                markerEnd={`url(#${arrowId})`}
              />
              {endpoint(x, axisY, Boolean(ray.open), tone.color)}
              {ray.label && (
                <SvgLabel
                  x={x + (ray.dir === "left" ? -10 : 10)}
                  y={axisY - 10}
                  text={shortText(ray.label)}
                  anchor={ray.dir === "left" ? "end" : "start"}
                  fill={tone.color}
                  fontSize={10}
                  fontWeight={600}
                  fontFamily="ui-monospace, SFMono-Regular, monospace"
                  halo={DEFAULTS.surface}
                />
              )}
            </g>
          );
        })}

        {/* The axis */}
        <line x1={PAD_X} y1={axisY} x2={PAD_X + plotW} y2={axisY} stroke={DEFAULTS.border} strokeWidth={1.5} />

        {tickValues.map((t, i) => (
          <g key={`t${i}`}>
            <line x1={project(t)} y1={axisY - 4} x2={project(t)} y2={axisY + 4} stroke={DEFAULTS.border} strokeWidth={1} />
            {includeNumbers && (
              <text
                x={project(t)}
                y={axisY + 16}
                textAnchor="middle"
                fill={DEFAULTS.dimColor}
                fontSize={9}
                fontFamily="ui-monospace, SFMono-Regular, monospace"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {tickText(t)}
              </text>
            )}
          </g>
        ))}

        {/* Dashed reference marks */}
        {marks.map((m, i) => (
          <g key={`m${i}`}>
            <line
              x1={project(m.at)}
              y1={8}
              x2={project(m.at)}
              y2={axisY}
              stroke={m.color ?? DEFAULTS.dimColor}
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.7}
            />
            {m.label && (
              <SvgLabel
                x={project(m.at)}
                y={7}
                text={shortText(m.label)}
                anchor="middle"
                fill={m.color ?? DEFAULTS.dimColor}
                fontSize={9}
                fontWeight={600}
                fontFamily="system-ui, sans-serif"
              />
            )}
          </g>
        ))}

        {/* Points on the axis */}
        {points.map((p, i) => {
          const id = idOf(p, "pt", i);
          const picked = isSelected("point", id);
          const tone = toneOf(id, p.color, picked);
          const x = project(p.x);
          return (
            <g key={`pt${i}`} opacity={tone.opacity} {...partProps("point", id)}>
              {picked && <circle cx={x} cy={axisY} r={8} fill="none" stroke={activeColor} strokeWidth={1.5} />}
              {endpoint(x, axisY, p.style === "open", tone.color, p.style)}
              {p.label && (
                <SvgLabel
                  x={x}
                  y={axisY - 11}
                  text={shortText(p.label)}
                  anchor="middle"
                  fill={tone.color}
                  fontSize={10}
                  fontWeight={700}
                  fontFamily="ui-monospace, SFMono-Regular, monospace"
                  halo={DEFAULTS.surface}
                />
              )}
            </g>
          );
        })}

        {/* Named pointers */}
        {pointers.map((ptr, i) => (
          <g key={`ptr${i}`}>
            <path
              d={`M ${project(ptr.at)} ${axisY - 7} l -4 -7 l 8 0 Z`}
              fill={ptr.color ?? activeColor}
            />
            <SvgLabel
              x={project(ptr.at)}
              y={axisY - 18}
              text={shortText(ptr.label ?? "")}
              anchor="middle"
              fill={ptr.color ?? activeColor}
              fontSize={10}
              fontWeight={700}
              fontFamily="ui-monospace, SFMono-Regular, monospace"
              halo={DEFAULTS.surface}
            />
          </g>
        ))}

        {/* Sweep cursor */}
        {sweepAt !== undefined && (
          <g>
            <line x1={project(sweepAt)} y1={6} x2={project(sweepAt)} y2={axisY + 6} stroke={activeColor} strokeWidth={2} />
            <circle cx={project(sweepAt)} cy={6} r={3} fill={activeColor} />
            {sweepLabel && (
              <SvgLabel
                x={project(sweepAt) + 6}
                y={8}
                text={shortText(sweepLabel)}
                fill={activeColor}
                fontSize={10}
                fontWeight={700}
                fontFamily="ui-monospace, SFMono-Regular, monospace"
                halo={DEFAULTS.surface}
              />
            )}
          </g>
        )}

        {label && (
          <SvgLabel
            x={PAD_X + plotW / 2}
            y={axisY + footer - 3}
            text={shortText(label)}
            anchor="middle"
            fill={DEFAULTS.dimColor}
            fontSize={10}
            fontWeight={600}
            fontFamily="system-ui, sans-serif"
          />
        )}

        {shading?.error && (
          <text x={PAD_X} y={height - 3} fill={DEFAULTS.dimColor} fontSize={9} fontFamily="system-ui, sans-serif">
            predicate: {shading.error}
          </text>
        )}
      </svg>
    </div>
  );
}

/**
 * Runs of [min, max] where `holds` is true, sampled. A run's ends sit halfway
 * between the last sample inside and the first outside.
 */
export function shadeWhere(
  min: number,
  max: number,
  holds: (x: number) => boolean,
  samples = 200,
): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  const n = Math.max(1, Math.min(2000, Math.trunc(samples) || 1));
  const dx = (max - min) / n;
  let start: number | null = null;
  for (let i = 0; i <= n; i++) {
    const x = min + i * dx;
    const on = holds(x);
    if (on && start === null) start = i === 0 ? x : x - dx / 2;
    if (!on && start !== null) {
      out.push({ from: start, to: x - dx / 2 });
      start = null;
    }
  }
  if (start !== null) out.push({ from: start, to: max });
  return out;
}
