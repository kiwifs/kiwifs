import { useId } from "react";
import { alpha } from "./colors";
import { toSet, type Many } from "./sets";
import { SvgLabel } from "./WidgetText";
import { expandRange, niceTicks, sampleRegion } from "./plotLayout";
import { objectsOf, shortText, summarizePlane } from "./widgetA11y";
import { partHandlers, useInspect, whyFor, type InspectRef } from "./inspect";

/**
 * A coordinate plane in data units.
 *
 * Geometry, sweep lines, hulls, vectors, Red Blob–style tile maps, plain
 * worked coordinate examples. Not `GraphView`, whose positions are pixels and
 * whose job is connectivity; not `PlotView`, which is a chart of series.
 *
 * It draws what it is given and computes nothing: a convex hull is a polygon
 * the author supplies, step by step. Putting the algorithm in the widget is
 * how you end up with a ConvexHullView that fits one lecture.
 *
 * Param names follow Manim's `NumberPlane` and the Desmos API.
 */

export type XY = readonly [number, number];
/** A point by id, or a literal coordinate pair. */
export type PointRef = string | number | XY;

export interface PlanePoint {
  /** Defaults to `pt<index>`, which is also how other shapes refer to it. */
  id?: string | number;
  x: number;
  y: number;
  label?: string;
  style?: "dot" | "open" | "cross" | "square";
  color?: string;
}

export interface PlaneSegment {
  id?: string | number;
  from: PointRef;
  to: PointRef;
  label?: string;
  color?: string;
  dashed?: boolean;
  /** Arrowhead at `to`. */
  arrow?: boolean;
}

export interface PlanePolygon {
  id?: string | number;
  points: PointRef[];
  label?: string;
  color?: string;
  /** Leave the ring open — a hull still being built. */
  open?: boolean;
  fill?: boolean;
}

export interface PlaneCircle {
  id?: string | number;
  at: PointRef;
  r: number;
  label?: string;
  color?: string;
  dashed?: boolean;
}

export interface PlaneVector {
  id?: string | number;
  from?: PointRef;
  to: PointRef;
  label?: string;
  color?: string;
}

export interface PlaneLabel {
  at: PointRef;
  text: string;
  color?: string;
  dx?: number;
  dy?: number;
}

export interface PlaneSweep {
  axis: "x" | "y" | "angle";
  at: number;
  /** Origin for `axis: "angle"`, in data units. Default [0, 0]. */
  origin?: XY;
  label?: string;
}

/** A shaded area where a formula in `x` and `y` holds — a feasible region. */
export interface PlaneRegion {
  id?: string | number;
  when: string;
  label?: string;
  color?: string;
  opacity?: number;
  /** Grid cells per axis. Default 40, at most 60. */
  resolution?: number;
}

export interface PlaneViewProps {
  /** Left edge of the visible x range. */
  xMin?: number;
  /** Right edge of the visible x range. */
  xMax?: number;
  /** Bottom edge of the visible y range. */
  yMin?: number;
  /** Top edge of the visible y range. */
  yMax?: number;
  /** `[min, max]`, an alias for the pair above. */
  xRange?: readonly [number, number];
  /** `[min, max]`, an alias for `yMin` and `yMax`. */
  yRange?: readonly [number, number];
  /** Draw the unit grid. Default true. */
  grid?: boolean;
  /** Draw the axes through the origin. Default true. */
  axes?: boolean;
  /** `"equal"` (default) keeps circles round; `"auto"` fills the box. */
  aspect?: "equal" | "auto";
  /** Named points, which segments and polygons can refer to. */
  points?: PlanePoint[];
  /** Line segments between two points. */
  segments?: PlaneSegment[];
  /** Closed shapes through a list of points. */
  polygons?: PlanePolygon[];
  /** Circles by center and radius. */
  circles?: PlaneCircle[];
  /** Arrows from a tail to a head. */
  vectors?: PlaneVector[];
  /** Free-standing captions at a coordinate. */
  labels?: PlaneLabel[];
  /** Areas shaded where a formula in `x` and `y` holds. */
  regions?: PlaneRegion[];
  /** A sweep cursor: a vertical or horizontal line, or a ray turning about `origin`. */
  sweep?: PlaneSweep;
  /** Shape ids emphasised this step. */
  activeIds?: Many<string | number>;
  /** Secondary-highlighted shape ids. */
  highlightIds?: Many<string | number>;
  /** Dimmed shape ids. */
  dimIds?: Many<string | number>;
  /** Caption on the x axis. */
  xLabel?: string;
  /** Caption on the y axis. */
  yLabel?: string;
  /** Canvas width in px. Default 440. */
  width?: number;
  /** Canvas height in px. Default 340. */
  height?: number;
  /** Reported when the reader selects a point. */
  onSelect?: (ref: InspectRef) => void;
  /** Point id → explanation, revealed on select. */
  why?: Record<string, string>;
  /** Controlled selection, as point ids. */
  selected?: Many<string | number>;
  /** Name for the inspect bus. Defaults to "plane". */
  widgetId?: string;
  /** Primary highlight color. */
  activeColor?: string;
  /** Secondary highlight color. */
  highlightColor?: string;
  /** Accessible name. Defaults to a summary of the shapes. */
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
  width: 440,
  height: 340,
};

const PAD = { left: 34, right: 16, top: 16, bottom: 28 };
const MAX_REGION_RESOLUTION = 60;

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function stringSet(value: Many<string | number>): Set<string> {
  return new Set([...toSet(value)].map(String));
}

/** One axis's extent, ordered and non-empty whatever the author wrote. */
export function planeRange(
  range: readonly unknown[] | undefined,
  min: unknown,
  max: unknown,
): { min: number; max: number } {
  const r = Array.isArray(range) ? range : [];
  let lo = finite(r[0]) ? r[0] : finite(min) ? min : 0;
  let hi = finite(r[1]) ? r[1] : finite(max) ? max : lo + 10;
  if (lo > hi) [lo, hi] = [hi, lo];
  return expandRange(lo, hi);
}

export function PlaneView({
  xMin,
  xMax,
  yMin,
  yMax,
  xRange,
  yRange,
  grid = true,
  axes = true,
  aspect = "equal",
  points: pointsIn,
  segments: segmentsIn,
  polygons: polygonsIn,
  circles: circlesIn,
  vectors: vectorsIn,
  labels: labelsIn,
  regions: regionsIn,
  sweep,
  activeIds: activeIdsIn,
  highlightIds: highlightIdsIn,
  dimIds: dimIdsIn,
  xLabel,
  yLabel,
  width: widthIn = DEFAULTS.width,
  height: heightIn = DEFAULTS.height,
  onSelect,
  why,
  selected,
  widgetId = "plane",
  activeColor = DEFAULTS.activeColor,
  highlightColor = DEFAULTS.highlightColor,
  ariaLabel,
}: PlaneViewProps) {
  const bus = useInspect();
  const mergedWhy = { ...bus.why, ...(why ?? {}) };
  const activeIds = stringSet(activeIdsIn);
  const highlightIds = stringSet(highlightIdsIn);
  const dimIds = stringSet(dimIdsIn);
  const selectedKeys = stringSet(selected);
  const uid = useId().replace(/:/g, "");

  const points = objectsOf<PlanePoint>(pointsIn).filter((p) => finite(p.x) && finite(p.y));
  const segments = objectsOf<PlaneSegment>(segmentsIn);
  const polygons = objectsOf<PlanePolygon>(polygonsIn).filter((p) => Array.isArray(p.points));
  const circles = objectsOf<PlaneCircle>(circlesIn).filter((c) => finite(c.r));
  const vectors = objectsOf<PlaneVector>(vectorsIn);
  const labels = objectsOf<PlaneLabel>(labelsIn);
  const regions = objectsOf<PlaneRegion>(regionsIn).filter((r) => typeof r.when === "string");

  const xr = planeRange(xRange, xMin, xMax);
  const yr = planeRange(yRange, yMin, yMax);
  const x0 = xr.min;
  const x1 = xr.max;
  const y0 = yr.min;
  const y1 = yr.max;

  const width = finite(widthIn) ? Math.max(PAD.left + PAD.right + 1, widthIn) : DEFAULTS.width;
  const height = finite(heightIn) ? Math.max(PAD.top + PAD.bottom + 1, heightIn) : DEFAULTS.height;
  const boxW = Math.max(1, width - PAD.left - PAD.right);
  const boxH = Math.max(1, height - PAD.top - PAD.bottom);
  const spanX = x1 - x0;
  const spanY = y1 - y0;

  // Equal aspect means one data unit is the same number of pixels on both
  // axes — without it a circle is an ellipse and a right angle is a lie.
  const unit = aspect === "equal" ? Math.min(boxW / spanX, boxH / spanY) : 0;
  const scaleX = aspect === "equal" ? unit : boxW / spanX;
  const scaleY = aspect === "equal" ? unit : boxH / spanY;
  const drawW = scaleX * spanX;
  const drawH = scaleY * spanY;
  const offX = PAD.left + (boxW - drawW) / 2;
  const offY = PAD.top + (boxH - drawH) / 2;

  const px = (x: number) => offX + (x - x0) * scaleX;
  const py = (y: number) => offY + drawH - (y - y0) * scaleY;

  const pointId = (p: PlanePoint, i: number) => String(p.id ?? `pt${i}`);
  const byId = new Map<string, PlanePoint>();
  points.forEach((p, i) => byId.set(pointId(p, i), p));

  /** A ref is a named point, a literal `[x, y]`, or a bare point index. */
  const resolve = (ref: unknown): XY | null => {
    if (Array.isArray(ref)) return finite(ref[0]) && finite(ref[1]) ? [ref[0], ref[1]] : null;
    if (typeof ref !== "string" && typeof ref !== "number") return null;
    const p = byId.get(String(ref)) ?? (/^\d+$/.test(String(ref)) ? points[Number(ref)] : undefined);
    return p ? [p.x, p.y] : null;
  };

  const idOf = (item: { id?: string | number }, kind: string, i: number) => String(item.id ?? `${kind}${i}`);
  const toneOf = (id: string, base?: string) => {
    if (activeIds.has(id) || selectedKeys.has(id)) return { color: activeColor, opacity: 1, weight: 2.5 };
    if (highlightIds.has(id)) return { color: highlightColor, opacity: 1, weight: 2.25 };
    if (dimIds.has(id)) return { color: DEFAULTS.dimColor, opacity: 0.35, weight: 1.25 };
    return { color: base ?? DEFAULTS.bar, opacity: 1, weight: 1.75 };
  };

  // One arrowhead marker per colour: a marker cannot inherit its line's stroke
  // everywhere `context-stroke` is unsupported.
  const arrowColors: string[] = [];
  const arrowFor = (color: string) => {
    let i = arrowColors.indexOf(color);
    if (i < 0) i = arrowColors.push(color) - 1;
    return `url(#kw-pl-arrow-${uid}-${i})`;
  };
  segments.forEach((seg, i) => {
    if (seg.arrow) arrowFor(toneOf(idOf(seg, "seg", i), seg.color).color);
  });
  vectors.forEach((v, i) => arrowFor(toneOf(idOf(v, "vec", i), v.color).color));

  const xTicks = niceTicks(x0, x1, 6).filter((t) => t >= x0 && t <= x1);
  const yTicks = niceTicks(y0, y1, 5).filter((t) => t >= y0 && t <= y1);

  const originX = x0 <= 0 && x1 >= 0 ? px(0) : null;
  const originY = y0 <= 0 && y1 >= 0 ? py(0) : null;

  const regionCells = regions.map((region) =>
    sampleRegion(
      region.when,
      { xMin: x0, xMax: x1, yMin: y0, yMax: y1 },
      undefined,
      Math.min(MAX_REGION_RESOLUTION, finite(region.resolution) ? region.resolution : 40),
    ),
  );
  const regionErrors = regionCells.map((r) => r.error).filter((e): e is string => Boolean(e));

  const isSelected = (key: string) =>
    selectedKeys.has(key) ||
    (bus.selected?.widget === widgetId && bus.selected.kind === "point" && bus.selected.key === key);
  const selectable = (key: string) =>
    onSelect !== undefined || whyFor(mergedWhy, { widget: widgetId, kind: "point", key }) !== undefined;
  const firstSelectable = points.map(pointId).find(selectable);

  const pointMarker = (p: PlanePoint, x: number, y: number, color: string) => {
    switch (p.style) {
      case "open":
        return <circle cx={x} cy={y} r={4.5} fill={DEFAULTS.surface} stroke={color} strokeWidth={2} />;
      case "square":
        return <rect x={x - 4} y={y - 4} width={8} height={8} fill={color} />;
      case "cross":
        return (
          <g stroke={color} strokeWidth={2}>
            <line x1={x - 4.5} y1={y - 4.5} x2={x + 4.5} y2={y + 4.5} />
            <line x1={x - 4.5} y1={y + 4.5} x2={x + 4.5} y2={y - 4.5} />
          </g>
        );
      default:
        return <circle cx={x} cy={y} r={4} fill={color} />;
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "0.5rem 0", overflow: "auto" }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role={firstSelectable !== undefined ? "graphics-document" : "img"}
        aria-label={
          ariaLabel ??
          summarizePlane({ points, segments, polygons, circles, xMin: x0, xMax: x1, yMin: y0, yMax: y1 })
        }
        style={{ display: "block", maxWidth: "100%", fontVariantNumeric: "tabular-nums" }}
      >
        <defs>
          {arrowColors.map((color, i) => (
            <marker
              key={i}
              id={`kw-pl-arrow-${uid}-${i}`}
              viewBox="0 0 10 10"
              refX={9}
              refY={5}
              markerWidth={7}
              markerHeight={7}
              orient="auto"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
            </marker>
          ))}
        </defs>

        {/* Predicate regions — the furthest back, since they are a backdrop */}
        {regionCells.map(({ cells }, i) => {
          const region = regions[i]!;
          const tone = region.color ?? highlightColor;
          const dim = dimIds.has(idOf(region, "region", i));
          return (
            <g key={`rg${i}`} opacity={dim ? 0.3 : 1}>
              {cells.map((cell, j) => (
                <rect
                  key={j}
                  x={px(cell.x0)}
                  y={py(cell.y1)}
                  width={Math.max(0.5, px(cell.x1) - px(cell.x0))}
                  height={Math.max(0.5, py(cell.y0) - py(cell.y1))}
                  fill={tone}
                  opacity={finite(region.opacity) ? region.opacity : 0.16}
                />
              ))}
              {region.label && cells[0] && (
                <SvgLabel
                  x={px(cells[Math.floor(cells.length / 2)]!.x0)}
                  y={py(cells[Math.floor(cells.length / 2)]!.y1) + 12}
                  text={shortText(region.label)}
                  fill={tone}
                  fontSize={10}
                  fontWeight={600}
                  halo={DEFAULTS.surface}
                />
              )}
            </g>
          );
        })}

        {grid && (
          <g stroke={DEFAULTS.border} strokeWidth={0.75} opacity={0.35}>
            {xTicks.map((t) => (
              <line key={`gx${t}`} x1={px(t)} y1={offY} x2={px(t)} y2={offY + drawH} />
            ))}
            {yTicks.map((t) => (
              <line key={`gy${t}`} x1={offX} y1={py(t)} x2={offX + drawW} y2={py(t)} />
            ))}
          </g>
        )}

        <rect x={offX} y={offY} width={drawW} height={drawH} fill="none" stroke={DEFAULTS.border} strokeWidth={1} />

        {axes && (
          <g stroke={DEFAULTS.bar} strokeWidth={1.5}>
            {originY != null && <line x1={offX} y1={originY} x2={offX + drawW} y2={originY} />}
            {originX != null && <line x1={originX} y1={offY} x2={originX} y2={offY + drawH} />}
          </g>
        )}

        {/* Tick labels outside the box */}
        {xTicks.map((t) => (
          <text
            key={`tx${t}`}
            x={px(t)}
            y={offY + drawH + 14}
            textAnchor="middle"
            fill={DEFAULTS.dimColor}
            fontSize={9}
            fontFamily="ui-monospace, SFMono-Regular, monospace"
          >
            {Number.isInteger(t) ? t : Number(t.toFixed(2))}
          </text>
        ))}
        {yTicks.map((t) => (
          <text
            key={`ty${t}`}
            x={offX - 6}
            y={py(t)}
            textAnchor="end"
            dominantBaseline="central"
            fill={DEFAULTS.dimColor}
            fontSize={9}
            fontFamily="ui-monospace, SFMono-Regular, monospace"
          >
            {Number.isInteger(t) ? t : Number(t.toFixed(2))}
          </text>
        ))}

        {/* Polygons first, so points and segments land on top */}
        {polygons.map((poly, i) => {
          const id = idOf(poly, "poly", i);
          const tone = toneOf(id, poly.color);
          const pts = poly.points.map(resolve).filter((p): p is XY => p !== null);
          if (pts.length < 2) return null;
          const d =
            pts.map((p, j) => `${j === 0 ? "M" : "L"} ${px(p[0])} ${py(p[1])}`).join(" ") +
            (poly.open ? "" : " Z");
          const centroid = pts.reduce<[number, number]>((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0]);
          return (
            <g key={`poly${i}`} opacity={tone.opacity} style={{ transition: "opacity 0.25s ease" }}>
              <path
                d={d}
                fill={poly.fill === false || poly.open ? "none" : alpha(tone.color, 18)}
                stroke={tone.color}
                strokeWidth={tone.weight}
                strokeLinejoin="round"
              />
              {poly.label && !poly.open && (
                <SvgLabel
                  x={px(centroid[0])}
                  y={py(centroid[1])}
                  text={shortText(poly.label)}
                  anchor="middle"
                  dominantBaseline="central"
                  fill={tone.color}
                  fontSize={10}
                  fontWeight={600}
                  halo={DEFAULTS.surface}
                />
              )}
            </g>
          );
        })}

        {circles.map((c, i) => {
          const id = idOf(c, "circle", i);
          const tone = toneOf(id, c.color);
          const at = resolve(c.at);
          if (!at) return null;
          const r = Math.max(1, Math.abs(c.r) * scaleX);
          return (
            <g key={`circ${i}`} opacity={tone.opacity}>
              <circle
                cx={px(at[0])}
                cy={py(at[1])}
                r={r}
                fill="none"
                stroke={tone.color}
                strokeWidth={tone.weight}
                strokeDasharray={c.dashed ? "5 4" : undefined}
              />
              {c.label && (
                <SvgLabel
                  x={px(at[0])}
                  y={py(at[1]) - r - 5}
                  text={shortText(c.label)}
                  anchor="middle"
                  fill={tone.color}
                  fontSize={10}
                  fontWeight={600}
                  halo={DEFAULTS.surface}
                />
              )}
            </g>
          );
        })}

        {segments.map((seg, i) => {
          const id = idOf(seg, "seg", i);
          const tone = toneOf(id, seg.color);
          const a = resolve(seg.from);
          const b = resolve(seg.to);
          if (!a || !b) return null;
          return (
            <g key={`seg${i}`} opacity={tone.opacity} color={tone.color}>
              <line
                x1={px(a[0])}
                y1={py(a[1])}
                x2={px(b[0])}
                y2={py(b[1])}
                stroke={tone.color}
                strokeWidth={tone.weight}
                strokeDasharray={seg.dashed ? "5 4" : undefined}
                markerEnd={seg.arrow ? arrowFor(tone.color) : undefined}
              />
              {seg.label && (
                <SvgLabel
                  x={(px(a[0]) + px(b[0])) / 2}
                  y={(py(a[1]) + py(b[1])) / 2 - 6}
                  text={shortText(seg.label)}
                  anchor="middle"
                  fill={tone.color}
                  fontSize={10}
                  fontWeight={600}
                  halo={DEFAULTS.surface}
                />
              )}
            </g>
          );
        })}

        {vectors.map((v, i) => {
          const id = idOf(v, "vec", i);
          const tone = toneOf(id, v.color);
          const a = v.from != null ? resolve(v.from) : ([0, 0] as XY);
          const b = resolve(v.to);
          if (!a || !b) return null;
          return (
            <g key={`vec${i}`} opacity={tone.opacity} color={tone.color}>
              <line
                x1={px(a[0])}
                y1={py(a[1])}
                x2={px(b[0])}
                y2={py(b[1])}
                stroke={tone.color}
                strokeWidth={tone.weight + 0.5}
                markerEnd={arrowFor(tone.color)}
              />
              {v.label && (
                <SvgLabel
                  x={px(b[0]) + 7}
                  y={py(b[1]) - 7}
                  text={shortText(v.label)}
                  fill={tone.color}
                  fontSize={10}
                  fontWeight={700}
                  halo={DEFAULTS.surface}
                />
              )}
            </g>
          );
        })}

        {/* Sweep line or ray */}
        {sweep && typeof sweep === "object" && finite(sweep.at) && (
          <g stroke={activeColor} strokeWidth={2} strokeDasharray="4 3">
            {sweep.axis === "x" && <line x1={px(sweep.at)} y1={offY} x2={px(sweep.at)} y2={offY + drawH} />}
            {sweep.axis === "y" && <line x1={offX} y1={py(sweep.at)} x2={offX + drawW} y2={py(sweep.at)} />}
            {sweep.axis === "angle" &&
              (() => {
                const origin = resolve(sweep.origin) ?? ([0, 0] as XY);
                const len = Math.hypot(drawW, drawH);
                const rad = (sweep.at * Math.PI) / 180;
                return (
                  <line
                    x1={px(origin[0])}
                    y1={py(origin[1])}
                    x2={px(origin[0]) + Math.cos(rad) * len}
                    y2={py(origin[1]) - Math.sin(rad) * len}
                  />
                );
              })()}
            {sweep.label && (
              <SvgLabel
                x={sweep.axis === "y" ? offX + 6 : px(sweep.at) + 6}
                y={sweep.axis === "y" ? py(sweep.at) - 6 : offY + 10}
                text={shortText(sweep.label)}
                fill={activeColor}
                fontSize={10}
                fontWeight={700}
                halo={DEFAULTS.surface}
              />
            )}
          </g>
        )}

        {points.map((p, i) => {
          const id = pointId(p, i);
          const picked = isSelected(id);
          const tone = picked ? { color: activeColor, opacity: 1, weight: 2.5 } : toneOf(id, p.color);
          const x = px(p.x);
          const y = py(p.y);
          const handlers = selectable(id)
            ? {
                ...partHandlers(widgetId, "point", id, bus, {
                  onSelect,
                  why: mergedWhy,
                  tabbable: id === firstSelectable,
                }),
                "aria-selected": picked || undefined,
              }
            : {};
          return (
            <g
              key={`pt${i}`}
              opacity={tone.opacity}
              {...handlers}
              style={{
                transition: "opacity 0.25s ease",
                cursor: selectable(id) ? "pointer" : undefined,
                outline: "none",
              }}
            >
              {picked && <circle cx={x} cy={y} r={8} fill="none" stroke={activeColor} strokeWidth={1.5} />}
              {pointMarker(p, x, y, tone.color)}
              {p.label && (
                <SvgLabel
                  x={x + 7}
                  y={y - 7}
                  text={shortText(p.label)}
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

        {labels.map((l, i) => {
          const at = resolve(l.at);
          if (!at) return null;
          return (
            <SvgLabel
              key={`lbl${i}`}
              x={px(at[0]) + (finite(l.dx) ? l.dx : 0)}
              y={py(at[1]) + (finite(l.dy) ? l.dy : 0)}
              text={shortText(l.text ?? "")}
              anchor="middle"
              fill={l.color ?? DEFAULTS.text}
              fontSize={10}
              fontWeight={600}
              halo={DEFAULTS.surface}
            />
          );
        })}

        {xLabel && (
          <text
            x={offX + drawW / 2}
            y={height - 3}
            textAnchor="middle"
            fill={DEFAULTS.dimColor}
            fontSize={10}
            fontWeight={600}
          >
            {shortText(xLabel)}
          </text>
        )}
        {yLabel && (
          <text
            x={10}
            y={offY + drawH / 2}
            textAnchor="middle"
            transform={`rotate(-90 10 ${offY + drawH / 2})`}
            fill={DEFAULTS.dimColor}
            fontSize={10}
            fontWeight={600}
          >
            {shortText(yLabel)}
          </text>
        )}
      </svg>
      {regionErrors.length > 0 && (
        <div style={{ fontSize: "0.7rem", color: DEFAULTS.dimColor, marginTop: 4 }}>
          {regionErrors.map((e, i) => (
            <div key={i}>region: {e}</div>
          ))}
        </div>
      )}
    </div>
  );
}
