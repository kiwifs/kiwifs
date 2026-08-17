import { alpha } from "./colors";
import {
  niceTicks,
  plotDomain,
  slicePoints,
  type PlotPoint,
} from "./plotLayout";

export type { PlotPoint } from "./plotLayout";

export type PlotSeriesKind = "line" | "area" | "scatter";

export interface PlotSeries {
  /** Identity for highlight sets. Defaults to the array index. */
  id?: string | number;
  /** Caption in the legend. */
  label?: string;
  points?: PlotPoint[];
  /** "line" (default), "area" (fill down to baseline), or "scatter". */
  kind?: PlotSeriesKind;
  color?: string;
  /** Area fill closes down to this y. Default 0. */
  baseline?: number;
}

export interface PlotGuide {
  /** Vertical line at this x. */
  x?: number;
  /** Horizontal line at this y. */
  y?: number;
  label?: string;
  color?: string;
}

export interface PlotShade {
  from: number;
  to: number;
  /** Shade under this series between from and to. Omit for a rectangle. */
  series?: string | number;
  fromY?: number;
  toY?: number;
  color?: string;
  opacity?: number;
  label?: string;
}

export interface PlotMark {
  x: number;
  /** If omitted, the mark sits on the x-axis. */
  y?: number;
  label?: string;
  color?: string;
}

export interface PlotViewProps {
  series: PlotSeries[];
  shades?: PlotShade[];
  guides?: PlotGuide[];
  marks?: PlotMark[];
  activeIds?: Set<string | number>;
  highlightIds?: Set<string | number>;
  dimIds?: Set<string | number>;
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
  xTicks?: number[];
  yTicks?: number[];
  xLabel?: string;
  yLabel?: string;
  showAxes?: boolean;
  showLegend?: boolean;
  width?: number;
  height?: number;
  activeColor?: string;
  highlightColor?: string;
}

const DEFAULTS = {
  activeColor: "var(--kw-widget-active, #a78bfa)",
  highlightColor: "var(--kw-widget-highlight, #22c55e)",
  dimColor: "var(--kw-widget-dim, #64748b)",
  border: "var(--kw-widget-border, #3f3f46)",
  text: "var(--kw-widget-text, #e5e7eb)",
  surface: "var(--kw-widget-surface, #18181b)",
  series: [
    "var(--kw-widget-accent-blue, #38bdf8)",
    "var(--kw-widget-accent-amber, #f59e0b)",
    "var(--kw-widget-accent-indigo, #818cf8)",
    "var(--kw-widget-accent-red, #f43f5e)",
  ],
  width: 560,
  height: 280,
};

const PAD = { left: 44, right: 16, top: 18, bottom: 36 };

function seriesId(s: PlotSeries, i: number): string | number {
  return s.id ?? i;
}

function seriesColor(s: PlotSeries, i: number): string {
  return s.color ?? DEFAULTS.series[i % DEFAULTS.series.length]!;
}

function polyline(points: PlotPoint[], sx: (x: number) => number, sy: (y: number) => number): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${sx(p.x)} ${sy(p.y)}`).join(" ");
}

function areaPath(
  points: PlotPoint[],
  baseline: number,
  sx: (x: number) => number,
  sy: (y: number) => number,
): string {
  if (points.length === 0) return "";
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return [
    `M ${sx(first.x)} ${sy(baseline)}`,
    ...points.map((p) => `L ${sx(p.x)} ${sy(p.y)}`),
    `L ${sx(last.x)} ${sy(baseline)}`,
    "Z",
  ].join(" ");
}

/**
 * A 2D plot: lines, area fills, and scatter, with optional shaded intervals,
 * axis guides, and labeled marks. Generic — densities, payoff diagrams,
 * scatter clouds, any y = f(x).
 */
export function PlotView({
  series,
  shades = [],
  guides = [],
  marks = [],
  activeIds,
  highlightIds,
  dimIds,
  xMin,
  xMax,
  yMin,
  yMax,
  xTicks,
  yTicks,
  xLabel,
  yLabel,
  showAxes = true,
  showLegend,
  width = DEFAULTS.width,
  height = DEFAULTS.height,
  activeColor = DEFAULTS.activeColor,
  highlightColor = DEFAULTS.highlightColor,
}: PlotViewProps) {
  const hasPoints = series.some((s) => (s.points?.length ?? 0) > 0);
  if (!hasPoints && shades.length === 0 && guides.length === 0 && marks.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 16, color: DEFAULTS.dimColor, fontSize: "0.8rem" }}>
        (no data)
      </div>
    );
  }

  const domain = plotDomain(series, { shades, guides, marks, xMin, xMax, yMin, yMax });
  const plotW = Math.max(40, width - PAD.left - PAD.right);
  const plotH = Math.max(40, height - PAD.top - PAD.bottom);
  const sx = (x: number) => PAD.left + ((x - domain.xMin) / (domain.xMax - domain.xMin)) * plotW;
  const sy = (y: number) => PAD.top + ((domain.yMax - y) / (domain.yMax - domain.yMin)) * plotH;

  const xt = xTicks ?? niceTicks(domain.xMin, domain.xMax, 5);
  const yt = yTicks ?? niceTicks(domain.yMin, domain.yMax, 5);

  const legend = showLegend ?? series.some((s) => s.label);

  const findSeries = (id: string | number): PlotSeries | undefined =>
    series.find((s, i) => seriesId(s, i) === id);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "0.5rem 0", overflow: "auto" }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ fontVariantNumeric: "tabular-nums", maxWidth: "100%" }}
        role="img"
      >
        {/* Plot frame */}
        <rect
          x={PAD.left}
          y={PAD.top}
          width={plotW}
          height={plotH}
          fill="transparent"
          stroke={DEFAULTS.border}
          strokeWidth={1}
          opacity={0.55}
        />

        {/* Grid + ticks */}
        {showAxes &&
          yt.map((t, i) => (
            <g key={`yg${i}`}>
              <line
                x1={PAD.left}
                y1={sy(t)}
                x2={PAD.left + plotW}
                y2={sy(t)}
                stroke={DEFAULTS.border}
                strokeWidth={1}
                opacity={0.28}
              />
              <text
                x={PAD.left - 6}
                y={sy(t)}
                textAnchor="end"
                dominantBaseline="central"
                fill={DEFAULTS.dimColor}
                fontSize={9}
                fontFamily="ui-monospace, SFMono-Regular, monospace"
              >
                {t}
              </text>
            </g>
          ))}
        {showAxes &&
          xt.map((t, i) => (
            <g key={`xg${i}`}>
              <line
                x1={sx(t)}
                y1={PAD.top}
                x2={sx(t)}
                y2={PAD.top + plotH}
                stroke={DEFAULTS.border}
                strokeWidth={1}
                opacity={0.18}
              />
              <text
                x={sx(t)}
                y={PAD.top + plotH + 14}
                textAnchor="middle"
                fill={DEFAULTS.dimColor}
                fontSize={9}
                fontFamily="ui-monospace, SFMono-Regular, monospace"
              >
                {t}
              </text>
            </g>
          ))}

        {xLabel && (
          <text
            x={PAD.left + plotW / 2}
            y={height - 4}
            textAnchor="middle"
            fill={DEFAULTS.dimColor}
            fontSize={10}
            fontWeight={600}
          >
            {xLabel}
          </text>
        )}
        {yLabel && (
          <text
            x={12}
            y={PAD.top + plotH / 2}
            textAnchor="middle"
            fill={DEFAULTS.dimColor}
            fontSize={10}
            fontWeight={600}
            transform={`rotate(-90 12 ${PAD.top + plotH / 2})`}
          >
            {yLabel}
          </text>
        )}

        {/* Shaded regions — behind series */}
        {shades.map((sh, i) => {
          const lo = Math.min(sh.from, sh.to);
          const hi = Math.max(sh.from, sh.to);
          const color = sh.color ?? DEFAULTS.series[0]!;
          const target = sh.series != null ? findSeries(sh.series) : undefined;
          const pts = target?.points?.length
            ? slicePoints(target.points, lo, hi)
            : [];
          const d = pts.length
            ? areaPath(pts, target?.baseline ?? sh.fromY ?? 0, sx, sy)
            : (() => {
                const y0 = sh.toY ?? domain.yMax;
                const y1 = sh.fromY ?? 0;
                const x1 = sx(lo);
                const x2 = sx(hi);
                const ya = sy(Math.max(y0, y1));
                const yb = sy(Math.min(y0, y1));
                return `M ${x1} ${yb} L ${x2} ${yb} L ${x2} ${ya} L ${x1} ${ya} Z`;
              })();
          return (
            <g key={`sh${i}`}>
              <path d={d} fill={color} opacity={sh.opacity ?? 0.22} />
              {sh.label && (
                <text
                  x={(sx(lo) + sx(hi)) / 2}
                  y={sy((sh.toY ?? domain.yMax * 0.15) * 0.5)}
                  textAnchor="middle"
                  fill={color}
                  fontSize={10}
                  fontWeight={700}
                >
                  {sh.label}
                </text>
              )}
            </g>
          );
        })}

        {/* Guides */}
        {guides.map((g, i) => {
          const color = g.color ?? DEFAULTS.dimColor;
          return (
            <g key={`g${i}`}>
              {g.x != null && (
                <line
                  x1={sx(g.x)}
                  y1={PAD.top}
                  x2={sx(g.x)}
                  y2={PAD.top + plotH}
                  stroke={color}
                  strokeWidth={1.25}
                  strokeDasharray="4 4"
                  opacity={0.85}
                />
              )}
              {g.y != null && (
                <line
                  x1={PAD.left}
                  y1={sy(g.y)}
                  x2={PAD.left + plotW}
                  y2={sy(g.y)}
                  stroke={color}
                  strokeWidth={1.25}
                  strokeDasharray="4 4"
                  opacity={0.85}
                />
              )}
              {g.label && (
                <text
                  x={g.x != null ? sx(g.x) + 4 : PAD.left + 4}
                  y={g.y != null ? sy(g.y) - 4 : PAD.top + 12}
                  fill={color}
                  fontSize={10}
                  fontWeight={600}
                  style={{ paintOrder: "stroke", stroke: DEFAULTS.surface, strokeWidth: 3 }}
                >
                  {g.label}
                </text>
              )}
            </g>
          );
        })}

        {/* Series */}
        {series.map((s, i) => {
          const id = seriesId(s, i);
          const pts = (s.points ?? []).slice().sort((a, b) => a.x - b.x);
          if (pts.length === 0) return null;
          const isActive = activeIds?.has(id) ?? false;
          const isHighlight = highlightIds?.has(id) ?? false;
          const isDim = dimIds?.has(id) ?? false;
          let color = seriesColor(s, i);
          let opacity = 1;
          if (isActive) color = activeColor;
          else if (isHighlight) color = highlightColor;
          else if (isDim) {
            color = DEFAULTS.dimColor;
            opacity = 0.4;
          }
          const kind = s.kind ?? "line";
          const baseline = s.baseline ?? 0;
          return (
            <g key={`s${i}`} opacity={opacity} style={{ transition: "opacity 0.2s ease" }}>
              {kind === "area" && (
                <path d={areaPath(pts, baseline, sx, sy)} fill={alpha(color, 28)} stroke="none" />
              )}
              {kind !== "scatter" && (
                <path
                  d={polyline(pts, sx, sy)}
                  fill="none"
                  stroke={color}
                  strokeWidth={isActive ? 2.5 : 2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}
              {kind === "scatter" &&
                pts.map((p, pi) => (
                  <circle
                    key={pi}
                    cx={sx(p.x)}
                    cy={sy(p.y)}
                    r={isActive ? 4 : 3}
                    fill={color}
                    stroke={DEFAULTS.surface}
                    strokeWidth={1}
                  />
                ))}
            </g>
          );
        })}

        {/* Marks */}
        {marks.map((m, i) => {
          const color = m.color ?? activeColor;
          const y = m.y ?? domain.yMin;
          return (
            <g key={`m${i}`}>
              <circle cx={sx(m.x)} cy={sy(y)} r={3.5} fill={color} />
              {m.label && (
                <text
                  x={sx(m.x)}
                  y={sy(y) - 8}
                  textAnchor="middle"
                  fill={color}
                  fontSize={10}
                  fontWeight={700}
                  style={{ paintOrder: "stroke", stroke: DEFAULTS.surface, strokeWidth: 3 }}
                >
                  {m.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {legend && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "8px 16px",
            fontSize: 11,
            color: DEFAULTS.text,
            padding: "0 8px 4px",
          }}
        >
          {series.map((s, i) => {
            if (!s.label) return null;
            const id = seriesId(s, i);
            const dim = dimIds?.has(id) ?? false;
            const color = activeIds?.has(id)
              ? activeColor
              : highlightIds?.has(id)
                ? highlightColor
                : seriesColor(s, i);
            return (
              <span key={`leg${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, opacity: dim ? 0.45 : 1 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: s.kind === "scatter" ? 99 : 2,
                    background: color,
                    display: "inline-block",
                  }}
                />
                {s.label}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
