import { useRef } from "react";
import { alpha } from "./colors";
import { toSet, type Many } from "./sets";
import { WidgetText } from "./WidgetText";
import { CellOverlay, linkPath, useCellRects, type OverlayShape } from "./cellOverlay";
import { canvasAria, objectsOf, sentence, shortText } from "./widgetA11y";
import { partHandlers, useInspect, whyFor, type InspectRef } from "./inspect";
import {
  describeHeapObject,
  formatValue,
  frameOrder,
  heapGet,
  heapOrder,
  isRef,
  refTarget,
  slotKey,
  varsOf,
  type HeapEntry,
  type HeapId,
  type HeapObject,
  type StackFrame,
  type TraceValue,
} from "./memoryTrace";

export type {
  HeapId,
  HeapObject,
  StackFrame,
  TraceValue,
} from "./memoryTrace";

/**
 * Frames on the left, heap on the right, pointers drawn between them.
 *
 * The missing primitive for anything about aliasing, mutation, closures, or
 * "why did changing `b` change `a`". `widget:code` can show a value; only this
 * can show that two names are the same object.
 *
 * The props are Python Tutor's trace format rather than a tidier shape of our
 * own, so a recorded trace drops straight in and a tracer could drive this
 * later without an API change.
 */

export interface MemoryViewProps {
  /** Call stack, outermost first. */
  frames?: StackFrame[];
  /** Heap objects by id. Values reference them as `["REF", id]`. */
  heap?: Record<string, HeapObject>;
  /**
   * Which frame is executing: a frame `id` (or `name#index`), or a number for
   * its position in `frames`. Defaults to the last, as a call stack does.
   */
  activeFrame?: string | number;
  /** Heap ids to emphasise this step. */
  activeIds?: Many<HeapId>;
  /** Secondary-highlighted heap ids. */
  highlightIds?: Many<HeapId>;
  /** Dimmed heap ids — garbage, or a frame about to return. */
  dimIds?: Many<HeapId>;
  /**
   * Draw a frame variable's primitive inside its slot rather than as a
   * separate box. Default true: a diagram where `3` gets its own heap object
   * teaches the wrong thing about Python, and the right thing about nothing.
   * `false` is Python Tutor's "render all objects on the heap", for when the
   * lesson is that a name always holds a reference.
   */
  inlinePrimitives?: boolean;
  /** Caption above the frames column. Default "Frames". */
  framesLabel?: string;
  /** Caption above the heap column. Default "Objects". */
  heapLabel?: string;
  /** Reported when the reader selects a variable or heap object. */
  onSelect?: (ref: InspectRef) => void;
  /** Heap id or variable → explanation, revealed on select. */
  why?: Record<string, string>;
  /** Name for the inspect bus, so a `link:` can address this view. */
  widgetId?: string;
  /** Primary highlight color. */
  activeColor?: string;
  /** Secondary highlight color. */
  highlightColor?: string;
  /** Accessible name. Defaults to a summary of the frames and heap. */
  ariaLabel?: string;
}

const DEFAULTS = {
  activeColor: "var(--kw-widget-active, #a78bfa)",
  highlightColor: "var(--kw-widget-highlight, #22c55e)",
  dimColor: "var(--kw-widget-dim, #64748b)",
  border: "var(--kw-widget-border, #3f3f46)",
  text: "var(--kw-widget-text, #e5e7eb)",
  surface: "var(--kw-widget-surface, #18181b)",
};

const MONO = "ui-monospace, SFMono-Regular, monospace";

/** Python's name for a primitive's type, as the boxed heap object's tag. */
function typeName(value: TraceValue): string {
  if (value === null || value === undefined) return "NONETYPE";
  if (typeof value === "boolean") return "BOOL";
  if (typeof value === "number") return Number.isInteger(value) ? "INT" : "FLOAT";
  if (typeof value === "string") return "STR";
  if (Array.isArray(value) && value[0] === "SPECIAL_FLOAT") return "FLOAT";
  return "VALUE";
}

function summarize(frames: StackFrame[], heapCount: number): string {
  const names = frames.map((f, i) => shortText(f.name ?? `frame ${i}`));
  return sentence(
    frames.length ? `call stack ${names.join(" → ")}` : "no frames",
    `${heapCount} heap ${heapCount === 1 ? "object" : "objects"}`,
  );
}

export function MemoryView({
  frames: framesIn,
  heap: heapIn,
  activeFrame,
  activeIds,
  highlightIds,
  dimIds,
  inlinePrimitives = true,
  framesLabel = "Frames",
  heapLabel = "Objects",
  onSelect,
  why,
  widgetId = "memory",
  activeColor = DEFAULTS.activeColor,
  highlightColor = DEFAULTS.highlightColor,
  ariaLabel,
}: MemoryViewProps) {
  const bus = useInspect();
  const mergedWhy = { ...bus.why, ...(why ?? {}) };
  const linked = bus.linkedKeys(widgetId);
  const boxRef = useRef<HTMLDivElement>(null);
  const rects = useCellRects(boxRef, true);

  const frames = objectsOf<StackFrame>(framesIn);
  const heap: Record<string, HeapObject> =
    typeof heapIn === "object" && heapIn !== null && !Array.isArray(heapIn) ? heapIn : {};

  const active = new Set([...toSet(activeIds)].map(String));
  const highlight = new Set([...toSet(highlightIds)].map(String));
  const dim = new Set([...toSet(dimIds)].map(String));

  const frameId = (frame: StackFrame, i: number) => String(frame.id ?? `${frame.name ?? "frame"}#${i}`);
  const activeIndex = (() => {
    if (typeof activeFrame === "number") return Number.isInteger(activeFrame) ? activeFrame : -1;
    if (activeFrame != null) return frames.findIndex((f, i) => frameId(f, i) === String(activeFrame));
    const flagged = frames.findIndex((f) => f.active);
    return flagged >= 0 ? flagged : frames.length - 1;
  })();
  const activeFrameId = frames[activeIndex] ? frameId(frames[activeIndex]!, activeIndex) : "";

  const heapEntries = heapOrder(frames, heap)
    .map((id) => {
      const raw = heapGet(heap, id);
      return raw === undefined ? null : describeHeapObject(id, raw);
    })
    .filter((e): e is HeapEntry => e !== null);

  // Boxed primitives for "render all objects on the heap". Their ids cannot
  // collide with an author's, and they are not inspectable parts.
  const boxed = new Map<string, HeapEntry>();
  if (!inlinePrimitives) {
    frames.forEach((frame, i) => {
      const scope = frameId(frame, i);
      const vars = varsOf(frame);
      const box = (name: string, value: TraceValue) => {
        if (isRef(value)) return;
        const id = `prim:${slotKey(scope, name)}`;
        boxed.set(id, { id, kind: typeName(value), slots: [{ value }] });
      };
      for (const name of frameOrder(frame)) box(name, vars[name]!);
      if (frame.returned !== undefined) box("return", frame.returned);
    });
  }
  const entries = [...boxed.values(), ...heapEntries];
  const isBoxed = (id: HeapId) => boxed.has(String(id));

  const selectable = (key: string) =>
    !boxed.has(key) &&
    (onSelect !== undefined || whyFor(mergedWhy, { widget: widgetId, kind: "node", key }) !== undefined);
  const firstSelectable = entries.map((e) => String(e.id)).find(selectable);

  /** The heap box a frame slot points at, if it points anywhere. */
  const pointee = (scope: string, name: string, value: TraceValue): HeapId | null => {
    const target = refTarget(value);
    if (target != null) return target;
    const id = `prim:${slotKey(scope, name)}`;
    return boxed.has(id) ? id : null;
  };

  // Every pointer, drawn from the slot that holds it to the object it names.
  const shapes: OverlayShape[] = [];
  const box = boxRef.current;
  if (box) {
    const arrow = (fromKey: string, target: HeapId, lit: boolean) => {
      const a = rects.get(fromKey);
      const b = rects.get(`obj:${target}`);
      if (!a || !b) return;
      const { d } = linkPath(a, b, { labelAt: 0.5, labelOffset: 0 });
      shapes.push({
        d,
        color: lit ? activeColor : DEFAULTS.dimColor,
        width: lit ? 2 : 1.25,
        arrow: true,
      });
    };
    frames.forEach((frame, i) => {
      const scope = frameId(frame, i);
      const lit = scope === activeFrameId;
      const vars = varsOf(frame);
      for (const name of frameOrder(frame)) {
        const target = pointee(scope, name, vars[name]!);
        if (target != null) arrow(`var:${slotKey(scope, name)}`, target, lit);
      }
      if (frame.returned !== undefined) {
        const returned = pointee(scope, "return", frame.returned);
        if (returned != null) arrow(`var:${slotKey(scope, "return")}`, returned, lit);
      }
    });
    for (const entry of heapEntries) {
      entry.slots.forEach((slot, j) => {
        const target = refTarget(slot.value);
        if (target != null) {
          arrow(`slot:${entry.id}:${j}`, target, active.has(String(entry.id)));
        }
      });
    }
  }

  const toneOf = (id: HeapId) => {
    const key = String(id);
    if (active.has(key)) return { border: activeColor, bg: alpha(activeColor, 14), opacity: 1 };
    if (highlight.has(key) || linked.has(key)) {
      return { border: highlightColor, bg: alpha(highlightColor, 12), opacity: 1 };
    }
    if (dim.has(key)) return { border: DEFAULTS.dimColor, bg: "transparent", opacity: 0.45 };
    return { border: DEFAULTS.border, bg: DEFAULTS.surface, opacity: 1 };
  };

  if (frames.length === 0 && entries.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 16, color: DEFAULTS.dimColor, fontSize: "0.8rem" }}>
        (nothing allocated)
      </div>
    );
  }

  const slotValue = (value: TraceValue, pointer = isRef(value)) => {
    if (pointer) {
      // The arrow says where it points; the text says it is a pointer at all,
      // which matters when the target has scrolled out of view.
      return <span style={{ color: DEFAULTS.dimColor }}>→</span>;
    }
    return <span style={{ color: DEFAULTS.text }}>{formatValue(value)}</span>;
  };

  return (
    <div
      {...canvasAria(ariaLabel ?? summarize(frames, heapEntries.length), firstSelectable !== undefined)}
      style={{ padding: "0.5rem 0", overflowX: "auto" }}
    >
      <div
        ref={boxRef}
        style={{
          position: "relative",
          display: "flex",
          gap: 48,
          alignItems: "flex-start",
          width: "max-content",
          minWidth: "100%",
          fontSize: "0.75rem",
          fontFamily: MONO,
        }}
      >
        {/* Frames */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 150 }}>
          <ColumnLabel text={framesLabel} />
          {frames.map((frame, i) => {
            const scope = frameId(frame, i);
            const isActive = scope === activeFrameId;
            const rows = frameOrder(frame);
            const vars = varsOf(frame);
            return (
              <div
                key={`${scope}-${i}`}
                style={{
                  borderRadius: 6,
                  border: `2px solid ${isActive ? activeColor : DEFAULTS.border}`,
                  background: isActive ? alpha(activeColor, 10) : "transparent",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    padding: "2px 8px",
                    fontWeight: 700,
                    color: isActive ? activeColor : DEFAULTS.dimColor,
                    borderBottom: `1px solid ${DEFAULTS.border}`,
                  }}
                >
                  <WidgetText text={shortText(frame.name ?? `frame ${i}`)} />
                </div>
                {rows.length === 0 && frame.returned === undefined && (
                  <div style={{ padding: "2px 8px", color: DEFAULTS.dimColor }}>(no locals)</div>
                )}
                {rows.map((name) => (
                  <div
                    key={name}
                    style={{ display: "flex", gap: 8, padding: "2px 8px", alignItems: "center" }}
                  >
                    <span style={{ color: DEFAULTS.dimColor }}>{name}</span>
                    <span
                      data-cell={`var:${slotKey(scope, name)}`}
                      style={{ marginLeft: "auto", minWidth: 18, textAlign: "right" }}
                    >
                      {slotValue(vars[name]!, pointee(scope, name, vars[name]!) != null)}
                    </span>
                  </div>
                ))}
                {frame.returned !== undefined && (
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      padding: "2px 8px",
                      alignItems: "center",
                      borderTop: `1px solid ${DEFAULTS.border}`,
                    }}
                  >
                    <span style={{ color: DEFAULTS.dimColor, fontStyle: "italic" }}>return</span>
                    <span
                      data-cell={`var:${slotKey(scope, "return")}`}
                      style={{ marginLeft: "auto", minWidth: 18, textAlign: "right" }}
                    >
                      {slotValue(frame.returned, pointee(scope, "return", frame.returned) != null)}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Heap */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 150 }}>
          <ColumnLabel text={heapLabel} />
          {entries.map((entry, index) => {
            const key = String(entry.id);
            const tone = toneOf(entry.id);
            const isTuple = entry.kind === "TUPLE";
            const isRow = entry.kind === "LIST" || entry.kind === "TUPLE";
            return (
              <div
                key={`${key}-${index}`}
                data-cell={`obj:${entry.id}`}
                {...(selectable(key)
                  ? partHandlers(widgetId, "node", key, bus, {
                      onSelect,
                      why: mergedWhy,
                      tabbable: key === firstSelectable,
                    })
                  : {})}
                style={{
                  borderRadius: isTuple ? 12 : 6,
                  border: `2px solid ${tone.border}`,
                  background: tone.bg,
                  opacity: tone.opacity,
                  overflow: "hidden",
                  cursor: selectable(key) ? "pointer" : undefined,
                  transition: "border-color 0.25s ease, background 0.25s ease, opacity 0.25s ease",
                  outline: "none",
                  alignSelf: isBoxed(entry.id) ? "flex-start" : undefined,
                }}
              >
                <div
                  style={{
                    padding: "1px 8px",
                    fontSize: "0.64rem",
                    letterSpacing: "0.06em",
                    color: DEFAULTS.dimColor,
                    borderBottom: entry.slots.length ? `1px solid ${DEFAULTS.border}` : undefined,
                  }}
                >
                  {entry.title ? `${entry.kind.toLowerCase()} ${entry.title}` : entry.kind.toLowerCase()}
                </div>
                {entry.slots.length === 0 && (
                  <div style={{ padding: "2px 8px", color: DEFAULTS.dimColor }}>(empty)</div>
                )}
                {/* A list lays its slots out in a row, which is what makes an
                    index visible; a dict or instance reads better as rows. */}
                <div style={{ display: "flex", flexDirection: isRow ? "row" : "column" }}>
                  {entry.slots.map((slot, j) => (
                    <div
                      key={j}
                      style={{
                        display: "flex",
                        flexDirection: isRow ? "column" : "row",
                        gap: isRow ? 0 : 8,
                        alignItems: "center",
                        padding: "2px 8px",
                        borderRight: isRow && j < entry.slots.length - 1 ? `1px solid ${DEFAULTS.border}` : undefined,
                        minWidth: 24,
                      }}
                    >
                      {slot.label != null && (
                        <span style={{ color: DEFAULTS.dimColor, fontSize: "0.62rem" }}>{slot.label}</span>
                      )}
                      <span data-cell={`slot:${entry.id}:${j}`}>{slotValue(slot.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {shapes.length > 0 && (
          <CellOverlay shapes={shapes} width={box?.offsetWidth || 1} height={box?.offsetHeight || 1} />
        )}
      </div>
    </div>
  );
}

function ColumnLabel({ text }: { text: string }) {
  return (
    <div
      style={{
        fontSize: "0.62rem",
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: DEFAULTS.dimColor,
      }}
    >
      {shortText(text)}
    </div>
  );
}
