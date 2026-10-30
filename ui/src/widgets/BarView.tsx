import { alpha } from "./colors";
import { toSet, type Many } from "./sets";
import { SvgLabel } from "./WidgetText";
import { summarizeBars } from "./widgetA11y";

export interface BarPointer {
  /** Column index the pointer sits above. */
  index: number;
  /** Short label (e.g. "L", "R", "i"). */
  label: string;
  color?: string;
}

export interface BarOverlay {
  /** First column the overlay spans (inclusive). */
  startIndex: number;
  /** Last column the overlay spans (inclusive). Omit for a single column. */
  endIndex?: number;
  /** Bottom of the overlay in value-space. Default 0. */
  fromValue?: number;
  /** Top of the overlay in value-space. */
  toValue: number;
  color?: string;
  opacity?: number;
  /** Optional label centered inside the overlay. */
  label?: string;
}

export interface BarGuide {
  /** Value at which to draw a horizontal dashed line. */
  value: number;
  label?: string;
  color?: string;
}

/** Raw samples turned into a histogram by the view. */
export interface BarBinning {
  samples: number[];
  /** Number of equal-width bins. Default 10. */
  binCount?: number;
  /** Fixed range. Defaults to the extent of the samples. */
  min?: number;
  max?: number;
  /** Label each bar with its interval rather than its index. Default true. */
  labelBins?: boolean;
}

export interface BarViewProps {
  /** Bar heights. May include negatives (drawn below a zero baseline). */
  values?: number[];
  /**
   * Build the bars by binning raw samples — a latency distribution, a hash
   * spread. Replaces `values` when given; an author with measurements should
   * not have to count them into buckets by hand.
   */
  from?: BarBinning;
  /** Labels under each bar. Defaults to the index. Pass null in a slot to hide. */
  labels?: (string | number | null)[];
  /**
   * Value labels drawn on the bar tips.
   * - true (default): show the numeric value
   * - false: hide all
   * - array: custom per-bar text (null hides that one)
   */
  valueLabels?: boolean | (string | number | null)[];
  /** Emphasized columns (primary color). */
  activeIndices?: Many<number>;
  /** Secondary highlighted columns. */
  highlightIndices?: Many<number>;
  /** Dimmed / eliminated columns. */
  dimIndices?: Many<number>;
  /** Per-bar fill override (takes priority below active/highlight/dim). */
  barColors?: (string | undefined | null)[];
  /** Named pointers shown above their column. */
  pointers?: BarPointer[];
  /**
   * The two columns being compared this step, drawn with a connecting brace.
   * Sorting is mostly comparisons, and "which two" is the whole state.
   */
  comparePair?: [number, number];
  /** The two columns being exchanged, drawn with a crossed double arrow. */
  swapPair?: [number, number];
  /** Columns merely read this step — a softer mark than `activeIndices`. */
  accessIndices?: Many<number>;
  /** Value-space rectangles: water fills, chosen sub-rectangles, etc. */
  overlays?: BarOverlay[];
  /** Horizontal reference lines (e.g. a water level). */
  guides?: BarGuide[];
  /** Fixed top of the value axis. Defaults to max(values, 0). */
  maxValue?: number;
  /** Fixed bottom of the value axis. Defaults to min(values, 0). */
  minValue?: number;
  /** Height of the plotting area in px. Default 220. */
  chartHeight?: number;
  /** Width of each bar in px. Default 40. */
  barWidth?: number;
  /** Gap between bars in px. Default 10. */
  gap?: number;
  /** Primary highlight color. */
  activeColor?: string;
  /** Secondary highlight color. */
  highlightColor?: string;
  /** Default overlay color (water). */
  overlayColor?: string;
  /** Accessible name. Defaults to a summary of the columns and range. */
  ariaLabel?: string;
}

const DEFAULTS = {
  activeColor: "var(--kw-widget-active, #a78bfa)",
  highlightColor: "var(--kw-widget-highlight, #22c55e)",
  dimColor: "var(--kw-widget-dim, #64748b)",
  border: "var(--kw-widget-border, #3f3f46)",
  text: "var(--kw-widget-text, #e5e7eb)",
  bar: "var(--kw-widget-bar, #475569)",
  overlay: "var(--kw-widget-water, #38bdf8)",
  chartHeight: 220,
  barWidth: 40,
  gap: 10,
};

function resolveBarColor(
  index: number,
  activeIndices: Set<number> | undefined,
  highlightIndices: Set<number> | undefined,
  dimIndices: Set<number> | undefined,
  barColors: (string | undefined | null)[] | undefined,
  activeColor: string,
  highlightColor: string,
): { fill: string; stroke: string; opacity: number } {
  const custom = barColors?.[index];
  if (custom) return { fill: custom, stroke: custom, opacity: 1 };
  if (activeIndices?.has(index)) return { fill: activeColor, stroke: activeColor, opacity: 1 };
  if (highlightIndices?.has(index)) return { fill: alpha(highlightColor, 80), stroke: highlightColor, opacity: 1 };
  if (dimIndices?.has(index)) return { fill: DEFAULTS.dimColor, stroke: DEFAULTS.dimColor, opacity: 0.4 };
  return { fill: DEFAULTS.bar, stroke: DEFAULTS.bar, opacity: 0.85 };
}

/**
 * Equal-width bins over raw samples.
 *
 * Exported so a caller that needs the counts without the chart — a summary
 * line, a test — can reuse exactly the binning the picture shows.
 */
export function binSamples(spec: BarBinning): { counts: number[]; labels: string[] } {
  const samples = spec.samples.filter((v) => Number.isFinite(v));
  const requested = Math.trunc(Number(spec.binCount ?? 10));
  const count = Number.isFinite(requested) ? Math.max(1, Math.min(200, requested)) : 10;
  if (samples.length === 0) {
    return { counts: new Array(count).fill(0), labels: new Array(count).fill("") };
  }
  // A loop rather than Math.min(...samples): spreading a few hundred thousand
  // samples overflows the argument limit.
  let sampleMin = Infinity;
  let sampleMax = -Infinity;
  for (const v of samples) {
    if (v < sampleMin) sampleMin = v;
    if (v > sampleMax) sampleMax = v;
  }
  const lo = spec.min != null && Number.isFinite(spec.min) ? spec.min : sampleMin;
  const hi = spec.max != null && Number.isFinite(spec.max) ? spec.max : sampleMax;
  const span = hi - lo || 1;
  const counts = new Array(count).fill(0);
  for (const v of samples) {
    // The last bin is closed on the right, so the maximum sample lands in it
    // instead of falling off the end.
    const slot = v >= hi ? count - 1 : Math.floor(((v - lo) / span) * count);
    if (slot >= 0 && slot < count) counts[slot] += 1;
  }
  const labelBins = spec.labelBins ?? true;
  const round = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));
  const labels = counts.map((_, i) =>
    labelBins ? round(lo + (span * i) / count) : String(i),
  );
  return { counts, labels };
}

export function BarView({
  values: valuesIn,
  from,
  comparePair,
  swapPair,
  accessIndices: accessIndicesIn,
  labels: labelsIn,
  valueLabels = true,
  activeIndices: activeIndicesIn,
  highlightIndices: highlightIndicesIn,
  dimIndices: dimIndicesIn,
  barColors,
  pointers = [],
  overlays = [],
  guides = [],
  maxValue,
  minValue,
  chartHeight = DEFAULTS.chartHeight,
  barWidth = DEFAULTS.barWidth,
  gap = DEFAULTS.gap,
  activeColor = DEFAULTS.activeColor,
  highlightColor = DEFAULTS.highlightColor,
  overlayColor = DEFAULTS.overlay,
  ariaLabel,
}: BarViewProps) {
  const binned = from ? binSamples(from) : null;
  const values = binned ? binned.counts : (valuesIn ?? []);
  const labels = binned?.labels ?? labelsIn;
  const accessIndices = toSet(accessIndicesIn);
  const activeIndices = toSet(activeIndicesIn);
  const highlightIndices = toSet(highlightIndicesIn);
  const dimIndices = toSet(dimIndicesIn);
  if (!values || values.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 16, color: DEFAULTS.dimColor, fontSize: "0.8rem" }}>
        (no data)
      </div>
    );
  }

  const n = values.length;
  const topPad = 34; // room for value labels + pointers
  const bottomPad = 24; // room for index labels
  const sidePad = 12;

  const dataMax = Math.max(...values);
  const dataMin = Math.min(...values);
  const overlayMax = overlays.length ? Math.max(...overlays.map((o) => o.toValue)) : -Infinity;
  const guideMax = guides.length ? Math.max(...guides.map((g) => g.value)) : -Infinity;

  const hasPointers = pointers.length > 0;
  const pointerRows = hasPointers
    ? Math.max(
        ...Array.from(
          pointers.reduce((m, p) => m.set(p.index, (m.get(p.index) ?? 0) + 1), new Map<number, number>()).values(),
        ),
      )
    : 0;
  const pointerPad = pointerRows * 16;
  // Value labels sit just above each bar, so pointers have to clear them or
  // they collide on whichever bar reaches the top of the plot.
  const valueLabelPad = valueLabels === false ? 0 : 14;

  let axisMax = maxValue ?? Math.max(dataMax, overlayMax, guideMax, 0);
  let axisMin = minValue ?? Math.min(dataMin, 0);
  if (axisMax === axisMin) axisMax = axisMin + 1; // avoid zero range
  const range = axisMax - axisMin;

  const plotTop = topPad + pointerPad + (hasPointers ? valueLabelPad : 0);
  const chartWidth = n * barWidth + (n - 1) * gap;
  const svgWidth = chartWidth + sidePad * 2;
  const svgHeight = plotTop + chartHeight + bottomPad;

  const yFor = (v: number) => plotTop + ((axisMax - v) / range) * chartHeight;
  const plotBottom = plotTop + chartHeight;
  const xFor = (i: number) => sidePad + i * (barWidth + gap);
  const baselineY = yFor(0);

  const pointerBuckets = new Map<number, BarPointer[]>();
  for (const p of pointers) {
    const list = pointerBuckets.get(p.index) ?? [];
    list.push(p);
    pointerBuckets.set(p.index, list);
  }

  const showValue = (i: number): string | null => {
    if (valueLabels === false) return null;
    if (valueLabels === true) return String(values[i]);
    const v = valueLabels[i];
    return v == null ? null : String(v);
  };

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "0.5rem 0", overflowX: "auto" }}>
      <svg
        width={svgWidth}
        height={svgHeight}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        style={{ fontVariantNumeric: "tabular-nums", maxWidth: "100%" }}
        role="img"
        aria-label={ariaLabel ?? summarizeBars({ values, labels, activeIndices })}
      >
        {/* Zero baseline (only if we have negatives) */}
        {axisMin < 0 && (
          <line
            x1={sidePad}
            y1={baselineY}
            x2={sidePad + chartWidth}
            y2={baselineY}
            stroke={DEFAULTS.border}
            strokeWidth={1}
          />
        )}

        {/* Horizontal guide lines */}
        {guides.map((g, gi) => {
          const gy = yFor(g.value);
          const color = g.color ?? DEFAULTS.dimColor;
          return (
            <g key={`guide-${gi}`}>
              <line
                x1={sidePad}
                y1={gy}
                x2={sidePad + chartWidth}
                y2={gy}
                stroke={color}
                strokeWidth={1}
                strokeDasharray="4 4"
                opacity={0.8}
              />
              {g.label && (
                <SvgLabel x={sidePad + chartWidth} y={gy - 3} text={g.label} anchor="end" fontSize={10} fill={color} />
              )}
            </g>
          );
        })}

        {/* Overlays (water fills, chosen rectangles) — behind bars */}
        {overlays.map((o, oi) => {
          const start = o.startIndex;
          const end = o.endIndex ?? o.startIndex;
          const from = o.fromValue ?? 0;
          const x = xFor(start);
          const x2 = xFor(end) + barWidth;
          const yTop = yFor(o.toValue);
          const yBot = yFor(from);
          const color = o.color ?? overlayColor;
          const oh = Math.abs(yBot - yTop);
          return (
            <g key={`ov-${oi}`}>
              <rect
                x={x}
                y={Math.min(yTop, yBot)}
                width={x2 - x}
                height={oh}
                fill={color}
                opacity={o.opacity ?? 0.28}
                rx={2}
              />
              {o.label && oh > 12 && (
                <SvgLabel
                  x={(x + x2) / 2}
                  y={(yTop + yBot) / 2 + 4}
                  text={o.label}
                  anchor="middle"
                  fontSize={11}
                  fontWeight={600}
                  fill={color}
                />
              )}
            </g>
          );
        })}

        {/* Bars */}
        {values.map((v, i) => {
          const { fill, stroke, opacity } = resolveBarColor(
            i,
            activeIndices,
            highlightIndices,
            dimIndices,
            barColors,
            activeColor,
            highlightColor,
          );
          const x = xFor(i);
          const yTop = v >= 0 ? yFor(v) : baselineY;
          const barH = Math.max(1, Math.abs(baselineY - yFor(v)));
          const label = showValue(i);
          const labelY = v >= 0 ? yTop - 5 : yTop + barH + 12;
          return (
            <g key={`bar-${i}`}>
              <rect
                x={x}
                y={yTop}
                width={barWidth}
                height={barH}
                fill={fill}
                stroke={stroke}
                strokeWidth={1}
                opacity={opacity}
                rx={3}
              />
              {label != null && (
                <SvgLabel
                  x={x + barWidth / 2}
                  y={labelY}
                  text={label}
                  anchor="middle"
                  fontSize={11}
                  fontWeight={600}
                  fill={DEFAULTS.text}
                />
              )}
            </g>
          );
        })}

        {/* Accessed columns — a softer mark than active, for a read */}
        {[...accessIndices].map((i) =>
          i >= 0 && i < values.length ? (
            <rect
              key={`acc-${i}`}
              x={xFor(i) - 1}
              y={plotTop}
              width={barWidth + 2}
              height={plotBottom - plotTop}
              fill={activeColor}
              opacity={0.08}
            />
          ) : null,
        )}

        {/* The comparison this step: a brace under the two columns */}
        {comparePair && (() => {
          const [a, b] = comparePair;
          if (a < 0 || b < 0 || a >= values.length || b >= values.length) return null;
          const x1 = xFor(Math.min(a, b)) + barWidth / 2;
          const x2 = xFor(Math.max(a, b)) + barWidth / 2;
          const y = plotBottom + 8;
          return (
            <g>
              <path
                d={`M ${x1} ${y - 5} V ${y} H ${x2} V ${y - 5}`}
                fill="none"
                stroke={highlightColor}
                strokeWidth={1.75}
              />
              <SvgLabel
                x={(x1 + x2) / 2}
                y={y + 10}
                text="compare"
                anchor="middle"
                fontSize={9}
                fontWeight={600}
                fill={highlightColor}
              />
            </g>
          );
        })()}

        {/* The swap this step: crossed arrows over the two columns */}
        {swapPair && (() => {
          const [a, b] = swapPair;
          if (a < 0 || b < 0 || a >= values.length || b >= values.length) return null;
          const x1 = xFor(Math.min(a, b)) + barWidth / 2;
          const x2 = xFor(Math.max(a, b)) + barWidth / 2;
          const y = plotTop - 4 - valueLabelPad;
          const lift = Math.min(16, Math.max(8, (x2 - x1) * 0.18));
          return (
            <g stroke={activeColor} strokeWidth={2} fill="none">
              <path d={`M ${x1} ${y} Q ${(x1 + x2) / 2} ${y - lift} ${x2} ${y}`} />
              <path d={`M ${x2 - 5} ${y - 4} L ${x2} ${y} L ${x2 - 5} ${y + 4}`} />
              <path d={`M ${x1 + 5} ${y - 4} L ${x1} ${y} L ${x1 + 5} ${y + 4}`} />
            </g>
          );
        })()}

        {/* Pointers above their column */}
        {Array.from(pointerBuckets.entries()).map(([idx, ptrs]) =>
          ptrs.map((p, j) => (
            <SvgLabel
              key={`ptr-${idx}-${j}`}
              x={xFor(idx) + barWidth / 2}
              y={plotTop - 6 - valueLabelPad - j * 16}
              text={p.label}
              anchor="middle"
              fontSize={12}
              fontWeight={700}
              fill={p.color ?? activeColor}
            />
          )),
        )}

        {/* Index / custom labels below */}
        {values.map((_, i) => {
          const lbl = labels ? labels[i] : i;
          if (lbl == null) return null;
          return (
            <SvgLabel
              key={`idx-${i}`}
              x={xFor(i) + barWidth / 2}
              y={svgHeight - 8}
              text={lbl}
              anchor="middle"
              fontSize={10}
              fill={DEFAULTS.dimColor}
            />
          );
        })}
      </svg>
    </div>
  );
}
