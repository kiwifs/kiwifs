import { alpha } from "./colors";
import { toSet, type Many } from "./sets";
import { WidgetText } from "./WidgetText";
import { canvasAria, objectsOf, sentence, shortText } from "./widgetA11y";
import { partHandlers, useInspect, whyFor, type InspectRef } from "./inspect";

/**
 * FIFO: BFS frontiers, work queues, sliding windows, ring buffers.
 *
 * A separate widget rather than a `mode` on StackView, because the two differ
 * in exactly the thing the reader is watching. A stack has one open end and
 * grows; a queue has two ends and a wrap-around, and `front`/`back` crossing
 * the end of the buffer *is* the lesson in a ring. StackView stays LIFO.
 */

export interface QueuePointer {
  index: number;
  label: string;
  color?: string;
}

export interface QueueViewProps {
  /**
   * Slot contents. In `ring` layout this is the whole buffer, including empty
   * slots as `null`; in `horizontal` it is the items in order.
   */
  values: (string | number | null)[];
  /** Index of the head. Defaults to 0. */
  front?: number;
  /** Index one past the tail — where the next enqueue lands. */
  back?: number;
  /** Buffer size. Defaults to `values.length`. Ring layout uses it as the circumference. */
  capacity?: number;
  /** `"horizontal"` (default) for a plain queue, `"ring"` for a circular buffer. */
  layout?: "horizontal" | "ring";
  /**
   * How many slots currently hold data, counted from `front`. Tells a full
   * ring from an empty one when `front === back`, and marks the slots outside
   * that window as stale rather than live.
   */
  size?: number;
  /** Slots being enqueued or dequeued this step. */
  activeIndices?: Many<number>;
  /** Secondary-highlighted slots. */
  highlightIndices?: Many<number>;
  /** Dimmed slots. */
  dimIndices?: Many<number>;
  /** Named markers beside slots, beyond `front` and `back`. */
  pointers?: QueuePointer[];
  /** Show slot indices. Default true. */
  showIndices?: boolean;
  /** Label on the head end. Default "front". */
  frontLabel?: string;
  /** Label on the tail end. Default "back". */
  backLabel?: string;
  /** Caption above the queue. */
  title?: string;
  /** Text shown when the queue is empty. Default "(empty)". */
  empty?: string;
  /** Side of one slot in px. Default 44. */
  slotSize?: number;
  /** Ring radius in px. Defaults to whatever fits the slots, at least 86. */
  radius?: number;
  /** Reported when the reader selects a slot. */
  onSelect?: (ref: InspectRef) => void;
  /** Slot index → explanation, revealed on select. */
  why?: Record<string, string>;
  /** Controlled selection, as slot indices. */
  selected?: Many<string | number>;
  /** Name for the inspect bus. Defaults to "queue". */
  widgetId?: string;
  /** Primary highlight color. */
  activeColor?: string;
  /** Secondary highlight color. */
  highlightColor?: string;
  /** Accessible name. Defaults to a summary of the slots. */
  ariaLabel?: string;
}

const DEFAULTS = {
  activeColor: "var(--kw-widget-active, #a78bfa)",
  highlightColor: "var(--kw-widget-highlight, #22c55e)",
  dimColor: "var(--kw-widget-dim, #64748b)",
  border: "var(--kw-widget-border, #3f3f46)",
  text: "var(--kw-widget-text, #e5e7eb)",
  surface: "var(--kw-widget-surface, #18181b)",
  slotSize: 44,
  radius: 86,
};

const MAX_SLOTS = 1024;

type Slot = string | number | boolean | null | object;

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function wrap(index: number, n: number): number {
  return ((Math.trunc(index) % n) + n) % n;
}

function summarize(opts: {
  values: Slot[];
  live: (i: number) => boolean;
  front: number;
  back?: number;
  layout: string;
  state?: "full" | "empty";
}): string {
  const filled = opts.values.filter((_, i) => opts.live(i)).map((v) => shortText(v));
  return sentence(
    `${opts.layout === "ring" ? "circular " : ""}queue of ${opts.values.length} slots`,
    opts.state === "full" ? "full" : filled.length ? `holding ${filled.join(", ")}` : "empty",
    `front at ${opts.front}`,
    opts.back != null ? `back at ${opts.back}` : "",
  );
}

export function QueueView({
  values: valuesIn,
  front: frontIn,
  back: backIn,
  capacity,
  layout = "horizontal",
  size,
  activeIndices,
  highlightIndices,
  dimIndices,
  pointers: pointersIn,
  showIndices = true,
  frontLabel = "front",
  backLabel = "back",
  title,
  empty = "(empty)",
  slotSize: slotSizeIn = DEFAULTS.slotSize,
  radius: radiusIn,
  onSelect,
  why,
  selected,
  widgetId = "queue",
  activeColor = DEFAULTS.activeColor,
  highlightColor = DEFAULTS.highlightColor,
  ariaLabel,
}: QueueViewProps) {
  const bus = useInspect();
  const mergedWhy = { ...bus.why, ...(why ?? {}) };
  const linked = bus.linkedKeys(widgetId);
  const values: Slot[] = Array.isArray(valuesIn) ? valuesIn : [];
  const requested = finite(capacity) ? capacity : values.length;
  const n = Math.max(1, Math.min(MAX_SLOTS, Math.trunc(requested)));
  const slots = Array.from({ length: n }, (_, i) => values[i] ?? null);
  const slotSize = finite(slotSizeIn) && slotSizeIn > 0 ? slotSizeIn : DEFAULTS.slotSize;
  const active = toSet(activeIndices);
  const highlight = toSet(highlightIndices);
  const dim = toSet(dimIndices);
  const selectedKeys = new Set([...toSet(selected)].map(String));
  const isSelected = (i: number) =>
    selectedKeys.has(String(i)) ||
    (bus.selected?.widget === widgetId && bus.selected.kind === "slot" && bus.selected.key === String(i));
  const selectable = (i: number) =>
    onSelect !== undefined ||
    whyFor(mergedWhy, { widget: widgetId, kind: "slot", key: String(i) }) !== undefined;
  const firstSelectable = slots.findIndex((_, i) => selectable(i));

  const front = finite(frontIn) ? wrap(frontIn, n) : 0;
  const back = finite(backIn) ? wrap(backIn, n) : undefined;
  const count = finite(size) ? Math.max(0, Math.min(n, Math.trunc(size))) : undefined;
  const live = (i: number) => (count == null ? slots[i] != null : wrap(i - front, n) < count);
  const state: "full" | "empty" | undefined =
    count == null ? undefined : count === 0 ? "empty" : count === n ? "full" : undefined;

  const markers = new Map<number, QueuePointer[]>();
  const addMarker = (slot: number, marker: QueuePointer) => {
    const list = markers.get(slot) ?? [];
    list.push(marker);
    markers.set(slot, list);
  };
  addMarker(front, { index: front, label: frontLabel });
  if (back != null) addMarker(back, { index: back, label: backLabel });
  for (const p of objectsOf<QueuePointer>(pointersIn)) {
    if (!finite(p.index)) continue;
    // In a ring every index lands on a slot; a horizontal queue has no slot
    // past its end to point at.
    const slot = layout === "ring" ? wrap(p.index, n) : Math.trunc(p.index);
    addMarker(slot, { ...p, index: slot, label: shortText(p.label ?? "") });
  }

  const styleFor = (i: number) => {
    const filled = live(i);
    if (active.has(i)) {
      return { bg: activeColor, border: activeColor, color: "var(--kw-widget-active-foreground, #111827)", opacity: 1 };
    }
    if (isSelected(i)) {
      return { bg: alpha(activeColor, 18), border: activeColor, color: DEFAULTS.text, opacity: 1 };
    }
    if (highlight.has(i) || linked.has(String(i))) {
      return { bg: alpha(highlightColor, 18), border: highlightColor, color: DEFAULTS.text, opacity: 1 };
    }
    if (dim.has(i)) {
      return { bg: "transparent", border: DEFAULTS.dimColor, color: DEFAULTS.dimColor, opacity: 0.5 };
    }
    return {
      bg: filled ? alpha(DEFAULTS.border, 35) : "transparent",
      border: DEFAULTS.border,
      color: filled ? DEFAULTS.text : DEFAULTS.dimColor,
      opacity: 1,
    };
  };

  const label = ariaLabel ?? summarize({ values: slots, live, front, back, layout, state });
  const aria = canvasAria(label, firstSelectable >= 0);

  const slotContent = (i: number) => {
    const v = slots[i];
    return v == null ? "·" : shortText(v, 12);
  };

  const partProps = (i: number) =>
    selectable(i)
      ? {
          ...partHandlers(widgetId, "slot", String(i), bus, {
            onSelect,
            why: mergedWhy,
            tabbable: i === firstSelectable,
          }),
          "aria-selected": isSelected(i) || undefined,
        }
      : {};

  if (layout === "ring") {
    // A ring makes the wrap-around visible, which is the one thing a
    // horizontal row of a circular buffer cannot show. The default radius
    // grows with the slot count so neighbours never overlap.
    const radius =
      finite(radiusIn) && radiusIn > 0
        ? radiusIn
        : Math.max(DEFAULTS.radius, (slots.length * (slotSize + 8)) / (2 * Math.PI));
    const box = (radius + slotSize) * 2 + 24;
    const centre = box / 2;
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "0.5rem 0" }}>
        {title && <Title text={shortText(title)} />}
        <svg width={box} height={box} {...aria} style={{ display: "block", maxWidth: "100%" }}>
          <circle cx={centre} cy={centre} r={radius} fill="none" stroke={DEFAULTS.border} strokeWidth={1} opacity={0.4} />
          {count != null && (
            <text
              x={centre}
              y={centre}
              textAnchor="middle"
              dominantBaseline="central"
              fill={DEFAULTS.dimColor}
              fontSize={11}
              fontWeight={700}
              fontFamily="ui-monospace, SFMono-Regular, monospace"
            >
              {state ?? `${count}/${n}`}
            </text>
          )}
          {slots.map((_, i) => {
            const angle = (i / slots.length) * Math.PI * 2 - Math.PI / 2;
            const cx = centre + Math.cos(angle) * radius;
            const cy = centre + Math.sin(angle) * radius;
            const st = styleFor(i);
            const marks = markers.get(i);
            const half = slotSize / 2;
            return (
              <g
                key={i}
                {...partProps(i)}
                opacity={st.opacity}
                style={{ cursor: selectable(i) ? "pointer" : undefined }}
              >
                <rect
                  x={cx - half}
                  y={cy - half}
                  width={slotSize}
                  height={slotSize}
                  rx={6}
                  fill={st.bg === "transparent" ? DEFAULTS.surface : st.bg}
                  stroke={st.border}
                  strokeWidth={2}
                />
                <text
                  x={cx}
                  y={cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={st.color}
                  fontSize={13}
                  fontWeight={700}
                  fontFamily="ui-monospace, SFMono-Regular, monospace"
                >
                  {slotContent(i)}
                </text>
                {showIndices && (
                  <text
                    x={centre + Math.cos(angle) * (radius - slotSize * 0.85)}
                    y={centre + Math.sin(angle) * (radius - slotSize * 0.85)}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={DEFAULTS.dimColor}
                    fontSize={9}
                    fontFamily="ui-monospace, SFMono-Regular, monospace"
                  >
                    {i}
                  </text>
                )}
                {marks?.map((m, j) => (
                  <text
                    key={j}
                    x={centre + Math.cos(angle) * (radius + slotSize * 0.9 + j * 12)}
                    y={centre + Math.sin(angle) * (radius + slotSize * 0.9 + j * 12)}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={m.color ?? activeColor}
                    fontSize={10}
                    fontWeight={700}
                    fontFamily="ui-monospace, SFMono-Regular, monospace"
                  >
                    {m.label}
                  </text>
                ))}
              </g>
            );
          })}
        </svg>
      </div>
    );
  }

  const isEmpty = count != null ? count === 0 : slots.every((v) => v == null);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "0.5rem 0" }}>
      {title && <Title text={shortText(title)} />}
      <div {...aria} style={{ display: "flex", alignItems: "flex-start", gap: 2, overflowX: "auto", maxWidth: "100%" }}>
        {isEmpty && (
          <span style={{ color: DEFAULTS.dimColor, fontSize: "0.7rem", padding: "12px 8px" }}>{shortText(empty)}</span>
        )}
        {slots.map((_, i) => {
          const st = styleFor(i);
          const marks = markers.get(i);
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
              <div style={{ height: 14, fontSize: "0.65rem", fontWeight: 700, whiteSpace: "nowrap", display: "flex", gap: 3 }}>
                {marks?.map((m, j) => (
                  <span key={j} style={{ color: m.color ?? activeColor }}>
                    <WidgetText text={m.label} />
                  </span>
                ))}
              </div>
              <div
                {...partProps(i)}
                style={{
                  width: slotSize,
                  height: slotSize,
                  borderRadius: 6,
                  border: `2px solid ${st.border}`,
                  background: st.bg,
                  color: st.color,
                  opacity: st.opacity,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: "0.8rem",
                  fontVariantNumeric: "tabular-nums",
                  fontFamily: "ui-monospace, SFMono-Regular, monospace",
                  cursor: selectable(i) ? "pointer" : undefined,
                  transition: "all 0.2s ease",
                  outline: "none",
                  overflow: "hidden",
                }}
              >
                <WidgetText text={slotContent(i)} />
              </div>
              {showIndices && (
                <span style={{ fontSize: "0.6rem", color: DEFAULTS.dimColor, fontVariantNumeric: "tabular-nums" }}>
                  {i}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Title({ text }: { text: string }) {
  return (
    <div
      style={{
        fontSize: "0.7rem",
        fontWeight: 700,
        color: DEFAULTS.dimColor,
        letterSpacing: "0.04em",
        marginBottom: 4,
      }}
    >
      <WidgetText text={text} />
    </div>
  );
}
