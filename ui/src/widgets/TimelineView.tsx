import { alpha } from "./colors";
import { SvgLabel } from "./WidgetText";

export interface TimelineInterval {
  start: number;
  end: number;
  /** Identity for the highlight sets. Defaults to the array index. */
  id?: string | number;
  /** Caption drawn inside the bar when it fits. */
  label?: string;
  /** Row to draw on. Omit to let overlapping intervals stack automatically. */
  lane?: number;
  color?: string;
}

export interface TimelineMark {
  at: number;
  label?: string;
  color?: string;
}

export interface TimelineViewProps {
  intervals: TimelineInterval[];
  /** Position of the sweep cursor. Omit for a static picture. */
  sweep?: number;
  /** Caption beside the sweep cursor — usually the running counter. */
  sweepLabel?: string;
  /** Extra vertical marks: query points, event coordinates. */
  marks?: TimelineMark[];
  activeIds?: Set<string | number>;
  highlightIds?: Set<string | number>;
  dimIds?: Set<string | number>;
  /** Axis range. Defaults to the extent of the data. */
  min?: number;
  max?: number;
  /** Values to label on the axis. Defaults to the distinct endpoints when
   *  there are few enough of them. */
  ticks?: number[];
  showAxis?: boolean;
  width?: number;
  laneHeight?: number;
  activeColor?: string;
  highlightColor?: string;
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

/** First-fit lane packing, so overlapping intervals stack instead of collide. */
export function assignLanes(intervals: TimelineInterval[]): number[] {
  const laneEnds: number[] = [];
  return intervals.map((iv) => {
    if (iv.lane !== undefined) {
      while (laneEnds.length <= iv.lane) laneEnds.push(-Infinity);
      laneEnds[iv.lane] = Math.max(laneEnds[iv.lane]!, iv.end);
      return iv.lane;
    }
    const lo = Math.min(iv.start, iv.end);
    const hi = Math.max(iv.start, iv.end);
    for (let lane = 0; lane < laneEnds.length; lane++) {
      if (laneEnds[lane]! <= lo) {
        laneEnds[lane] = hi;
        return lane;
      }
    }
    laneEnds.push(hi);
    return laneEnds.length - 1;
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
  sweep,
  sweepLabel,
  marks = [],
  activeIds,
  highlightIds,
  dimIds,
  min,
  max,
  ticks,
  showAxis = true,
  width = DEFAULTS.width,
  laneHeight = DEFAULTS.laneHeight,
  activeColor = DEFAULTS.activeColor,
  highlightColor = DEFAULTS.highlightColor,
}: TimelineViewProps) {
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

  const lanes = assignLanes(intervals);
  const laneCount = Math.max(...lanes) + 1;

  const plotW = width - PAD_X * 2;
  const height = PAD_TOP + laneCount * laneHeight + (showAxis ? AXIS_H : 6);
  const scale = (v: number) => PAD_X + ((v - lo) / span) * plotW;

  const axisY = PAD_TOP + laneCount * laneHeight + 4;

  const autoTicks = [...new Set([...starts, ...ends])].sort((a, b) => a - b);
  const tickValues = ticks ?? (autoTicks.length <= MAX_AUTO_TICKS ? autoTicks : [lo, hi]);

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "0.5rem 0", overflow: "auto" }}>
      <svg width={width} height={height} style={{ display: "block" }}>
        {/* Lane guides */}
        {Array.from({ length: laneCount }, (_, lane) => (
          <line
            key={`lane${lane}`}
            x1={PAD_X}
            y1={PAD_TOP + lane * laneHeight + laneHeight / 2}
            x2={PAD_X + plotW}
            y2={PAD_TOP + lane * laneHeight + laneHeight / 2}
            stroke={DEFAULTS.border}
            strokeWidth={1}
            opacity={0.3}
          />
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

        {/* Interval bars */}
        {intervals.map((iv, i) => {
          const id = iv.id ?? i;
          const isActive = activeIds?.has(id) ?? false;
          const isHighlight = highlightIds?.has(id) ?? false;
          const isDim = dimIds?.has(id) ?? false;

          const x1 = scale(Math.min(iv.start, iv.end));
          const x2 = scale(Math.max(iv.start, iv.end));
          const w = Math.max(3, x2 - x1);
          const y = PAD_TOP + lanes[i]! * laneHeight + 3;
          const h = laneHeight - 8;

          let fill = alpha(iv.color ?? DEFAULTS.bar, 30);
          let stroke = iv.color ?? DEFAULTS.bar;
          let textColor = DEFAULTS.text;
          let opacity = 1;

          if (isActive) {
            fill = activeColor;
            stroke = activeColor;
            textColor = "var(--kw-widget-active-foreground, #111827)";
          } else if (isHighlight) {
            fill = alpha(highlightColor, 26);
            stroke = highlightColor;
          } else if (isDim) {
            stroke = DEFAULTS.dimColor;
            fill = "transparent";
            opacity = 0.45;
          }

          const caption = iv.label ?? `[${iv.start}, ${iv.end}]`;
          const fits = w > caption.length * 6.2;

          return (
            <g key={`iv${i}`} style={{ transition: "all 0.25s ease", opacity }}>
              <rect x={x1} y={y} width={w} height={h} rx={4} fill={fill} stroke={stroke} strokeWidth={1.5} />
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
            <line x1={PAD_X} y1={axisY} x2={PAD_X + plotW} y2={axisY} stroke={DEFAULTS.border} strokeWidth={1.5} />
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
      </svg>
    </div>
  );
}
