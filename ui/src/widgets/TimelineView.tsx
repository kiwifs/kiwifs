import { alpha } from "./colors";
import { toSet, type Many } from "./sets";
import { SvgLabel } from "./WidgetText";
import { summarizeTimeline } from "./widgetA11y";
import { assignLanes as packLanes } from "./lanes";
import { textWidth } from "./graphGeometry";
import { useId, useState } from "react";

export interface TimelineInterval {
  start: number;
  /** Equal to `start` for a point event, which draws as a diamond. */
  end: number;
  /** Identity for the highlight sets and for `links`. Defaults to the index. */
  id?: string | number;
  /** Caption drawn inside the bar when it fits. */
  label?: string;
  /**
   * Row to draw on: a lane index, or a name from `lanes`. Omit to let
   * overlapping intervals stack automatically.
   */
  lane?: number | string;
  /**
   * What the span *is*, not just when it is: a thread running, blocked on a
   * lock, waiting to be woken, holding a resource. Blocked and waiting draw
   * hatched, so a scheduling diagram reads without a colour key.
   */
  state?: "running" | "blocked" | "waiting" | "holding" | string;
  color?: string;
}

/**
 * A causal edge between two spans: happens-before, "woken by", a lock handoff,
 * an MVCC read-from. Drawn from the end of `from` to the start of `to`, which
 * is where the causality actually is.
 */
export interface TimelineLink {
  from: string | number;
  to: string | number;
  label?: string;
  color?: string;
  dashed?: boolean;
}

export interface TimelineMark {
  at: number;
  label?: string;
  color?: string;
}

export interface TimelineViewProps {
  /** Spans to draw. `start === end` draws a point event. */
  intervals: TimelineInterval[];
  /**
   * Named lanes in the order they should be drawn, labelled in the gutter.
   * Without this, lanes are packed automatically and unlabelled — fine for
   * meeting rooms, wrong for "thread A" above "thread B".
   */
  lanes?: string[];
  /** Causal arrows between spans. */
  links?: TimelineLink[];
  /**
   * Hovering a span lights everything it causally depends on, walking `links`
   * backwards — the happens-before cone.
   */
  hoverPredecessors?: boolean;
  /** Draw a legend for the `state` values in use. Default true when any is set. */
  showLegend?: boolean;
  /** Position of the sweep cursor. Omit for a static picture. */
  sweep?: number;
  /** Caption beside the sweep cursor — usually the running counter. */
  sweepLabel?: string;
  /** Extra vertical marks: query points, event coordinates. */
  marks?: TimelineMark[];
  /** Interval ids emphasised this step. */
  activeIds?: Many<string | number>;
  /** Secondary-highlighted interval ids. */
  highlightIds?: Many<string | number>;
  /** Dimmed interval ids. */
  dimIds?: Many<string | number>;
  /** Axis range. Defaults to the extent of the data. */
  min?: number;
  max?: number;
  /** Values to label on the axis. Defaults to the distinct endpoints when
   *  there are few enough of them. */
  ticks?: number[];
  /** Draw the time axis. Default true. */
  showAxis?: boolean;
  /** Canvas width in px. Default 560. */
  width?: number;
  /** Height of one lane in px. Default 26. */
  laneHeight?: number;
  /** Primary highlight color. */
  activeColor?: string;
  /** Secondary highlight color. */
  highlightColor?: string;
  /** Accessible name. Defaults to a summary of the intervals and span. */
  ariaLabel?: string;
}

const DEFAULTS = {
  activeColor: "var(--kw-widget-active, #a78bfa)",
  highlightColor: "var(--kw-widget-highlight, #22c55e)",
  dimColor: "var(--kw-widget-dim, #64748b)",
  border: "var(--kw-widget-border, #3f3f46)",
  text: "var(--kw-widget-text, #e5e7eb)",
  bar: "var(--kw-widget-bar, #94a3b8)",
  surface: "var(--kw-widget-surface, #18181b)",
  width: 560,
  laneHeight: 26,
};

const PAD_X = 30;
const PAD_TOP = 18;
const AXIS_H = 26;
const MAX_AUTO_TICKS = 14;

/**
 * First-fit lane packing, so overlapping intervals stack instead of collide.
 * A named `lane` resolves against `laneNames`; an unknown name gets its own
 * row appended rather than silently landing in lane 0. With named lanes, an
 * interval without a `lane` is packed into unlabelled rows below them, so it
 * neither overlaps nor borrows a label that is not its own.
 */
export function assignLanes(intervals: TimelineInterval[], laneNames: string[] = []): number[] {
  const extra: string[] = [];
  const indexOfName = (name: string): number => {
    const declared = laneNames.indexOf(name);
    if (declared >= 0) return declared;
    const seen = extra.indexOf(name);
    if (seen >= 0) return laneNames.length + seen;
    extra.push(name);
    return laneNames.length + extra.length - 1;
  };
  const spans = intervals.map((iv) => ({
    start: Math.min(iv.start, iv.end),
    end: Math.max(iv.start, iv.end),
    lane: typeof iv.lane === "string" ? indexOfName(iv.lane) : iv.lane ?? undefined,
  }));
  if (laneNames.length === 0) return packLanes(spans);

  const declared = spans.filter((s) => s.lane != null);
  const declaredLanes = packLanes(declared);
  const base = Math.max(laneNames.length + extra.length, ...declaredLanes.map((l) => l + 1));
  const autoLanes = packLanes(spans.filter((s) => s.lane == null));
  let d = 0;
  let a = 0;
  return spans.map((s) => (s.lane != null ? declaredLanes[d++]! : base + autoLanes[a++]!));
}

/** Hatch pattern ids per state, so one <defs> entry serves every bar. */
const HATCHED_STATES = new Set(["blocked", "waiting"]);

const STATE_LABEL: Record<string, string> = {
  running: "running",
  blocked: "blocked",
  waiting: "waiting",
  holding: "holding",
};

/** Own keys only: a state named `constructor` must print as itself. */
export function stateLabel(state: string): string {
  return Object.hasOwn(STATE_LABEL, state) ? STATE_LABEL[state]! : state;
}

const LEGEND_SWATCH = 19;
const LEGEND_GAP = 14;
const LEGEND_ROW = 14;

/**
 * Legend entries laid out by their measured width, wrapping onto a new row
 * rather than overlapping when the labels are long.
 */
export function legendLayout(labels: string[], maxWidth: number): { x: number; row: number }[] {
  let x = 0;
  let row = 0;
  return labels.map((label) => {
    const w = LEGEND_SWATCH + textWidth(label, 9) + LEGEND_GAP;
    if (x > 0 && x + w - LEGEND_GAP > maxWidth) {
      x = 0;
      row += 1;
    }
    const at = { x, row };
    x += w;
    return at;
  });
}

/**
 * Intervals as spans on a shared axis, with an optional sweep cursor.
 *
 * Works for anything with a start and an end: meeting rooms, Gantt charts,
 * log spans, the ranges a Fenwick index covers.
 */
export function TimelineView({
  intervals,
  lanes: laneNames,
  links,
  hoverPredecessors = false,
  showLegend,
  sweep,
  sweepLabel,
  marks = [],
  activeIds: activeIdsIn,
  highlightIds: highlightIdsIn,
  dimIds: dimIdsIn,
  min,
  max,
  ticks,
  showAxis = true,
  width = DEFAULTS.width,
  laneHeight = DEFAULTS.laneHeight,
  activeColor = DEFAULTS.activeColor,
  highlightColor = DEFAULTS.highlightColor,
  ariaLabel,
}: TimelineViewProps) {
  const activeIds = toSet(activeIdsIn);
  const highlightIds = toSet(highlightIdsIn);
  const dimIds = toSet(dimIdsIn);
  const [hovered, setHovered] = useState<string | null>(null);
  const uid = useId().replace(/:/g, "");
  const hatchId = `kw-tl-hatch-${uid}`;
  const linkArrowId = `kw-tl-link-${uid}`;
  if (intervals.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 16, color: DEFAULTS.dimColor, fontSize: "0.8rem" }}>
        (no intervals)
      </div>
    );
  }

  const starts = intervals.map((i) => Math.min(i.start, i.end));
  const ends = intervals.map((i) => Math.max(i.start, i.end));
  const candidates = [...starts, ...ends, ...marks.map((m) => m.at), ...(sweep !== undefined ? [sweep] : [])];
  const lo = min ?? Math.min(...candidates);
  const hi = max ?? Math.max(...candidates);
  const span = hi - lo || 1;

  const lanes = assignLanes(intervals, laneNames ?? []);
  const laneCount = Math.max(laneNames?.length ?? 0, Math.max(...lanes) + 1);

  // Named lanes need a gutter wide enough for the longest name.
  const gutter = laneNames?.length
    ? Math.min(140, 12 + Math.max(...laneNames.map((n) => n.length)) * 6.4)
    : 0;
  const leftPad = PAD_X + gutter;
  const states = new Set(
    intervals.map((iv) => iv.state).filter((st): st is string => Boolean(st)),
  );
  const legend = showLegend ?? states.size > 0;
  const plotW = width - leftPad - PAD_X;
  const legendItems = legendLayout([...states].map(stateLabel), plotW);
  const legendRows = legendItems.length ? Math.max(...legendItems.map((p) => p.row)) + 1 : 0;
  const legendH = legend && states.size > 0 ? 20 + (legendRows - 1) * LEGEND_ROW : 0;

  const height = PAD_TOP + laneCount * laneHeight + (showAxis ? AXIS_H : 6) + legendH;
  const scale = (v: number) => leftPad + ((v - lo) / span) * plotW;

  const axisY = PAD_TOP + laneCount * laneHeight + 4;
  const laneMid = (lane: number) => PAD_TOP + lane * laneHeight + laneHeight / 2;

  // Causal predecessors, so hovering a span can light the cone behind it.
  const byId = new Map<string, number>();
  intervals.forEach((iv, i) => byId.set(String(iv.id ?? i), i));
  const predecessors = new Map<string, string[]>();
  for (const link of links ?? []) {
    const list = predecessors.get(String(link.to)) ?? [];
    list.push(String(link.from));
    predecessors.set(String(link.to), list);
  }
  const coneOf = (id: string): Set<string> => {
    const seen = new Set<string>();
    const stack = [id];
    while (stack.length) {
      const here = stack.pop()!;
      for (const p of predecessors.get(here) ?? []) {
        if (seen.has(p)) continue;
        seen.add(p);
        stack.push(p);
      }
    }
    return seen;
  };
  const cone = hoverPredecessors && hovered != null ? coneOf(hovered) : null;

  const autoTicks = [...new Set([...starts, ...ends])].sort((a, b) => a - b);
  const tickValues = ticks ?? (autoTicks.length <= MAX_AUTO_TICKS ? autoTicks : [lo, hi]);

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "0.5rem 0", overflow: "auto" }}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={ariaLabel ?? summarizeTimeline({ intervals, lanes: laneNames, sweep })}
        style={{ display: "block" }}
      >
        <defs>
          {/* One hatch, reused by every blocked or waiting bar. */}
          <pattern id={hatchId} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={6} stroke={DEFAULTS.dimColor} strokeWidth={2.5} opacity={0.55} />
          </pattern>
          <marker id={linkArrowId} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={6} markerHeight={6} orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={DEFAULTS.dimColor} />
          </marker>
        </defs>

        {/* Lane rows — named lanes get a label and a banded background */}
        {Array.from({ length: laneCount }, (_, lane) => (
          <g key={`lane${lane}`}>
            {laneNames?.length ? (
              <>
                {lane % 2 === 1 && (
                  <rect
                    x={leftPad}
                    y={PAD_TOP + lane * laneHeight}
                    width={plotW}
                    height={laneHeight}
                    fill={DEFAULTS.border}
                    opacity={0.12}
                  />
                )}
                {laneNames[lane] && (
                  <SvgLabel
                    x={leftPad - 8}
                    y={laneMid(lane)}
                    text={laneNames[lane]!}
                    anchor="end"
                    dominantBaseline="central"
                    fill={DEFAULTS.dimColor}
                    fontSize={10}
                    fontWeight={600}
                    fontFamily="system-ui, sans-serif"
                  />
                )}
              </>
            ) : (
              <line
                x1={leftPad}
                y1={laneMid(lane)}
                x2={leftPad + plotW}
                y2={laneMid(lane)}
                stroke={DEFAULTS.border}
                strokeWidth={1}
                opacity={0.3}
              />
            )}
          </g>
        ))}

        {/* Marks behind the bars */}
        {marks.map((m, i) => (
          <g key={`m${i}`}>
            <line
              x1={scale(m.at)} y1={PAD_TOP - 4}
              x2={scale(m.at)} y2={axisY}
              stroke={m.color ?? DEFAULTS.dimColor}
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.7}
            />
            {m.label && (
              <SvgLabel
                x={scale(m.at)} y={PAD_TOP - 6}
                text={m.label}
                anchor="middle"
                fill={m.color ?? DEFAULTS.dimColor}
                fontSize={9}
                fontWeight={600}
                fontFamily="system-ui, sans-serif"
              />
            )}
          </g>
        ))}

        {/* Causal links, behind the bars they connect */}
        {(links ?? []).map((link, i) => {
          const a = byId.get(String(link.from));
          const b = byId.get(String(link.to));
          if (a == null || b == null) return null;
          const from = intervals[a]!;
          const to = intervals[b]!;
          const x1 = scale(Math.max(from.start, from.end));
          const y1 = laneMid(lanes[a]!);
          const x2 = scale(Math.min(to.start, to.end));
          const y2 = laneMid(lanes[b]!);
          const inCone = cone?.has(String(link.from)) && (hovered === String(link.to) || cone.has(String(link.to)));
          const lift = Math.max(10, Math.abs(y2 - y1) * 0.4);
          const mx = (x1 + x2) / 2;
          const my = (y1 + y2) / 2 - (y1 === y2 ? lift : 0);
          return (
            <g key={`lk${i}`} opacity={cone && !inCone ? 0.25 : 1} style={{ transition: "opacity 0.2s ease" }}>
              <path
                d={`M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`}
                fill="none"
                stroke={link.color ?? (inCone ? activeColor : DEFAULTS.dimColor)}
                strokeWidth={inCone ? 2 : 1.25}
                strokeDasharray={link.dashed ? "4 3" : undefined}
                markerEnd={`url(#${linkArrowId})`}
              />
              {link.label && (
                <SvgLabel
                  x={mx}
                  y={my - 4}
                  text={link.label}
                  anchor="middle"
                  fill={DEFAULTS.dimColor}
                  fontSize={9}
                  fontWeight={600}
                  fontFamily="system-ui, sans-serif"
                  halo={DEFAULTS.surface}
                />
              )}
            </g>
          );
        })}

        {/* Interval bars */}
        {intervals.map((iv, i) => {
          const id = iv.id ?? i;
          const key = String(id);
          const isActive = activeIds?.has(id) ?? false;
          const isHighlight = highlightIds?.has(id) ?? false;
          const isDim = dimIds?.has(id) ?? false;
          const inCone = cone ? cone.has(key) || hovered === key : false;

          const lo2 = Math.min(iv.start, iv.end);
          const hi2 = Math.max(iv.start, iv.end);
          const isPoint = lo2 === hi2;
          const x1 = scale(lo2);
          const x2 = scale(hi2);
          const w = Math.max(3, x2 - x1);
          const y = PAD_TOP + lanes[i]! * laneHeight + 3;
          const h = laneHeight - 8;
          const hatched = iv.state ? HATCHED_STATES.has(iv.state) : false;

          let fill = alpha(iv.color ?? DEFAULTS.bar, 30);
          let stroke = iv.color ?? DEFAULTS.bar;
          let textColor = DEFAULTS.text;
          let opacity = 1;

          if (isActive) {
            fill = activeColor;
            stroke = activeColor;
            textColor = "var(--kw-widget-active-foreground, #111827)";
          } else if (isHighlight || inCone) {
            fill = alpha(highlightColor, 26);
            stroke = highlightColor;
          } else if (isDim) {
            stroke = DEFAULTS.dimColor;
            fill = "transparent";
            opacity = 0.45;
          }
          if (hatched && !isActive) fill = `url(#${hatchId})`;
          if (cone && !inCone) opacity = Math.min(opacity, 0.35);

          const caption = iv.label ?? (isPoint ? String(iv.start) : `[${iv.start}, ${iv.end}]`);
          const fits = !isPoint && w > caption.length * 6.2;
          const hoverProps = hoverPredecessors
            ? {
                onMouseEnter: () => setHovered(key),
                onMouseLeave: () => setHovered(null),
                style: { transition: "all 0.25s ease", opacity, cursor: "pointer" },
              }
            : { style: { transition: "all 0.25s ease", opacity } };

          return (
            <g key={`iv${i}`} {...hoverProps}>
              {isPoint ? (
                // A zero-width span is an event, not a duration; a diamond
                // says so where a 3px bar would read as a rounding error.
                <path
                  d={`M ${x1} ${y + h / 2 - 6} L ${x1 + 6} ${y + h / 2} L ${x1} ${y + h / 2 + 6} L ${x1 - 6} ${y + h / 2} Z`}
                  fill={isActive ? activeColor : stroke}
                  stroke={stroke}
                  strokeWidth={1.5}
                />
              ) : (
                <rect x={x1} y={y} width={w} height={h} rx={4} fill={fill} stroke={stroke} strokeWidth={1.5} />
              )}
              {isPoint && iv.label && (
                <SvgLabel
                  x={x1 + 9}
                  y={y + h / 2}
                  text={iv.label}
                  dominantBaseline="central"
                  fill={DEFAULTS.text}
                  fontSize={9}
                  fontWeight={600}
                  fontFamily="system-ui, sans-serif"
                  halo={DEFAULTS.surface}
                />
              )}
              {fits && (
                <SvgLabel
                  x={x1 + w / 2} y={y + h / 2}
                  text={caption}
                  anchor="middle"
                  dominantBaseline="central"
                  fill={textColor}
                  fontSize={10}
                  fontWeight={600}
                  fontFamily="ui-monospace, SFMono-Regular, monospace"
                />
              )}
            </g>
          );
        })}

        {/* Sweep cursor */}
        {sweep !== undefined && (
          <g>
            <line
              x1={scale(sweep)} y1={PAD_TOP - 6}
              x2={scale(sweep)} y2={axisY}
              stroke={activeColor}
              strokeWidth={2}
            />
            <circle cx={scale(sweep)} cy={PAD_TOP - 6} r={3} fill={activeColor} />
            {sweepLabel && (
              <SvgLabel
                x={scale(sweep) + 6} y={PAD_TOP - 4}
                text={sweepLabel}
                fill={activeColor}
                fontSize={10}
                fontWeight={700}
                fontFamily="ui-monospace, SFMono-Regular, monospace"
                halo={DEFAULTS.surface}
              />
            )}
          </g>
        )}

        {/* Axis */}
        {showAxis && (
          <g>
            <line x1={leftPad} y1={axisY} x2={leftPad + plotW} y2={axisY} stroke={DEFAULTS.border} strokeWidth={1.5} />
            {tickValues.map((t, i) => (
              <g key={`t${i}`}>
                <line x1={scale(t)} y1={axisY} x2={scale(t)} y2={axisY + 4} stroke={DEFAULTS.border} strokeWidth={1} />
                <text
                  x={scale(t)} y={axisY + 15}
                  textAnchor="middle"
                  fill={DEFAULTS.dimColor}
                  fontSize={9}
                  fontFamily="ui-monospace, SFMono-Regular, monospace"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {t}
                </text>
              </g>
            ))}
          </g>
        )}
        {/* State legend — hatching alone needs naming */}
        {legend && states.size > 0 && (
          <g>
            {[...states].map((st, i) => {
              const x = leftPad + legendItems[i]!.x;
              const y = height - 6 - (legendRows - 1 - legendItems[i]!.row) * LEGEND_ROW;
              const hatch = HATCHED_STATES.has(st);
              return (
                <g key={st}>
                  <rect
                    x={x}
                    y={y - 9}
                    width={14}
                    height={9}
                    rx={2}
                    fill={hatch ? `url(#${hatchId})` : alpha(DEFAULTS.bar, 30)}
                    stroke={DEFAULTS.bar}
                    strokeWidth={1}
                  />
                  <text
                    x={x + 19}
                    y={y - 1}
                    fill={DEFAULTS.dimColor}
                    fontSize={9}
                    fontFamily="system-ui, sans-serif"
                  >
                    {stateLabel(st)}
                  </text>
                </g>
              );
            })}
          </g>
        )}
      </svg>
    </div>
  );
}
