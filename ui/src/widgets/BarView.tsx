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

export interface BarViewProps {
  /** Bar heights. May include negatives (drawn below a zero baseline). */
  values: number[];
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
  activeIndices?: Set<number>;
  /** Secondary highlighted columns. */
  highlightIndices?: Set<number>;
  /** Dimmed / eliminated columns. */
  dimIndices?: Set<number>;
  /** Per-bar fill override (takes priority below active/highlight/dim). */
  barColors?: (string | undefined | null)[];
  /** Named pointers shown above their column. */
  pointers?: BarPointer[];
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
  activeColor?: string;
  highlightColor?: string;
  /** Default overlay color (water). */
  overlayColor?: string;
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
  if (highlightIndices?.has(index)) return { fill: highlightColor + "cc", stroke: highlightColor, opacity: 1 };
  if (dimIndices?.has(index)) return { fill: DEFAULTS.dimColor, stroke: DEFAULTS.dimColor, opacity: 0.4 };
  return { fill: DEFAULTS.bar, stroke: DEFAULTS.bar, opacity: 0.85 };
}

export function BarView({
  values,
  labels,
  valueLabels = true,
  activeIndices,
  highlightIndices,
  dimIndices,
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
}: BarViewProps) {
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

  let axisMax = maxValue ?? Math.max(dataMax, overlayMax, guideMax, 0);
  let axisMin = minValue ?? Math.min(dataMin, 0);
  if (axisMax === axisMin) axisMax = axisMin + 1; // avoid zero range
  const range = axisMax - axisMin;

  const plotTop = topPad + pointerPad;
  const chartWidth = n * barWidth + (n - 1) * gap;
  const svgWidth = chartWidth + sidePad * 2;
  const svgHeight = plotTop + chartHeight + bottomPad;

  const yFor = (v: number) => plotTop + ((axisMax - v) / range) * chartHeight;
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
                <text x={sidePad + chartWidth} y={gy - 3} textAnchor="end" fontSize={10} fill={color}>
                  {g.label}
                </text>
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
                <text
                  x={(x + x2) / 2}
                  y={(yTop + yBot) / 2 + 4}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={600}
                  fill={color}
                >
                  {o.label}
                </text>
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
                <text
                  x={x + barWidth / 2}
                  y={labelY}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={600}
                  fill={DEFAULTS.text}
                >
                  {label}
                </text>
              )}
            </g>
          );
        })}

        {/* Pointers above their column */}
        {Array.from(pointerBuckets.entries()).map(([idx, ptrs]) =>
          ptrs.map((p, j) => (
            <text
              key={`ptr-${idx}-${j}`}
              x={xFor(idx) + barWidth / 2}
              y={plotTop - 6 - j * 16}
              textAnchor="middle"
              fontSize={12}
              fontWeight={700}
              fill={p.color ?? activeColor}
            >
              {p.label}
            </text>
          )),
        )}

        {/* Index / custom labels below */}
        {values.map((_, i) => {
          const lbl = labels ? labels[i] : i;
          if (lbl == null) return null;
          return (
            <text
              key={`idx-${i}`}
              x={xFor(i) + barWidth / 2}
              y={svgHeight - 8}
              textAnchor="middle"
              fontSize={10}
              fill={DEFAULTS.dimColor}
            >
              {lbl}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
