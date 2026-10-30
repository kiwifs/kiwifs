import { useId } from "react";
import { alpha } from "./colors";
import { toSet, type Many } from "./sets";
import { WidgetText } from "./WidgetText";
import { canvasAria, shortText, summarizeMap } from "./widgetA11y";
import { partHandlers, useInspect, whyFor, type InspectRef } from "./inspect";

/**
 * Slots, chains and probe paths: hash tables, caches, symbol tables, routing
 * tables, and the unordered `{key: value}` panel that two-sum walkthroughs
 * have been drawing out of ad-hoc chips.
 *
 * Three modes, because the three pictures differ in what the reader must see:
 *   chain — buckets of entries (separate chaining)
 *   open  — one entry per slot, with `DEL` tombstones and a probe path
 *   map   — an unordered dictionary, no slots at all
 *
 * Probe conventions (`DEL`, the load factor readout, the arrow path) follow
 * VisuAlgo, so a reader who learned there recognises this.
 */

export interface MapEntry {
  key: string | number;
  value?: string | number | null;
}

export type MapSlot = null | "DEL" | MapEntry | MapEntry[];

export interface MapViewProps {
  /** Default "chain" when `slots` is given, "map" when `entries` is. */
  mode?: "chain" | "open" | "map";
  /** Slot count, at most 1024. Defaults to `slots.length`. */
  capacity?: number;
  /** One entry per slot, a list for a chain, `null` for empty, `"DEL"` for a tombstone. */
  slots?: MapSlot[];
  /** Unordered dictionary form — what a frequency map or seen-set actually is. A plain object works too. */
  entries?: MapEntry[] | Record<string, unknown>;
  /** Shows an `h(k)=i` badge beside the key. */
  hashOf?: Record<string, number>;
  /** Secondary-highlighted slot indices. */
  highlightSlots?: Many<number>;
  /** Slots being written or read this step. */
  activeSlots?: Many<number>;
  /** Dimmed slot indices. */
  dimSlots?: Many<number>;
  /** The key being inserted or looked up this step. */
  activeKey?: string | number;
  /** Slots visited in order, numbered and joined by arrows. */
  probePath?: number[];
  /** Slot indices holding a tombstone, if not already `"DEL"` in `slots`. */
  tombstones?: Many<number>;
  /** Show α = n/m. Default true when slots are given. */
  showLoadFactor?: boolean;
  /** Index captions under the slots. Default true. */
  showIndices?: boolean;
  /** Widget id for the inspect bus. */
  widgetId?: string;
  /** Reported when the reader selects a slot or entry. */
  onSelect?: (ref: InspectRef) => void;
  /** Slot index (or key in `map` mode) → explanation, revealed on select. */
  why?: Record<string, string>;
  /** Controlled selection: slot indices, or keys in `map` mode. */
  selected?: Many<string | number>;
  /** Width of one slot in px. Default 54. */
  slotWidth?: number;
  /** Primary highlight color. */
  activeColor?: string;
  /** Secondary highlight color. */
  highlightColor?: string;
  /** Accessible name. Defaults to a summary of the slots or entries. */
  ariaLabel?: string;
}

const DEFAULTS = {
  activeColor: "var(--kw-widget-active, #a78bfa)",
  highlightColor: "var(--kw-widget-highlight, #22c55e)",
  dimColor: "var(--kw-widget-dim, #64748b)",
  border: "var(--kw-widget-border, #3f3f46)",
  text: "var(--kw-widget-text, #e5e7eb)",
  surface: "var(--kw-widget-surface, #18181b)",
  tombstone: "var(--kw-widget-accent-rose, #f43f5e)",
  slotWidth: 54,
};

const MAX_SLOTS = 1024;
const MAX_CHAIN = 32;
const SLOT_GAP = 2;
const PROBE_H = 22;

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isEntry(v: unknown): v is MapEntry {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** An entry from whatever was written: `{key, value}`, or a bare key. */
function toEntry(v: unknown): MapEntry | null {
  if (v == null) return null;
  if (isEntry(v)) return v;
  if (Array.isArray(v)) return null;
  return { key: v as string | number };
}

function entriesOf(slot: unknown): MapEntry[] {
  if (slot == null || slot === "DEL") return [];
  if (Array.isArray(slot)) return slot.map(toEntry).filter((e): e is MapEntry => e !== null);
  const e = toEntry(slot);
  return e ? [e] : [];
}

/** `entries` as a list, accepting the `{apple: 3, pear: 1}` an author naturally writes. */
export function normalizeEntries(entries: unknown): MapEntry[] {
  if (Array.isArray(entries)) return entries.map(toEntry).filter((e): e is MapEntry => e !== null);
  if (isEntry(entries)) {
    return Object.entries(entries).map(([key, value]) => ({ key, value: value as MapEntry["value"] }));
  }
  return [];
}

function keyText(e: MapEntry): string {
  return shortText(e.key);
}

function entryText(e: MapEntry): string {
  return e.value == null || e.value === "" ? keyText(e) : `${keyText(e)}: ${shortText(e.value)}`;
}

function ownNumber(record: unknown, key: string): number | undefined {
  if (typeof record !== "object" || record === null || !Object.prototype.hasOwnProperty.call(record, key)) {
    return undefined;
  }
  const v = (record as Record<string, unknown>)[key];
  return finite(v) ? v : undefined;
}

export function MapView({
  mode,
  capacity,
  slots: slotsIn,
  entries: entriesIn,
  hashOf,
  highlightSlots,
  activeSlots,
  dimSlots,
  activeKey,
  probePath,
  tombstones,
  showLoadFactor,
  showIndices = true,
  widgetId = "map",
  onSelect,
  why,
  selected,
  slotWidth: slotWidthIn = DEFAULTS.slotWidth,
  activeColor = DEFAULTS.activeColor,
  highlightColor = DEFAULTS.highlightColor,
  ariaLabel,
}: MapViewProps) {
  const bus = useInspect();
  const uid = useId().replace(/:/g, "");
  const slots = Array.isArray(slotsIn) ? slotsIn : undefined;
  const resolved = mode ?? (slots ? "chain" : "map");
  const mergedWhy = { ...bus.why, ...(why ?? {}) };
  const linked = bus.linkedKeys(widgetId);
  const selectedKeys = new Set([...toSet(selected)].map(String));
  const slotWidth = finite(slotWidthIn) && slotWidthIn > 0 ? slotWidthIn : DEFAULTS.slotWidth;
  const isSelected = (key: string) =>
    selectedKeys.has(key) ||
    (bus.selected?.widget === widgetId && bus.selected.kind === "slot" && bus.selected.key === key);
  const selectable = (key: string) =>
    onSelect !== undefined || whyFor(mergedWhy, { widget: widgetId, kind: "slot", key }) !== undefined;
  const partProps = (key: string, tabbable: boolean) =>
    selectable(key)
      ? {
          ...partHandlers(widgetId, "slot", key, bus, { onSelect, why: mergedWhy, tabbable }),
          "aria-selected": isSelected(key) || undefined,
        }
      : {};
  const hashBadge = (e: MapEntry) => {
    const h = ownNumber(hashOf, String(e.key));
    return h == null ? null : (
      <span style={{ fontSize: "0.62rem", color: DEFAULTS.dimColor, marginLeft: 4 }}>h={h}</span>
    );
  };

  if (resolved === "map" || (!slots && entriesIn != null)) {
    const list = normalizeEntries(entriesIn);
    const keys = list.map((e) => String(e.key));
    const firstSelectable = keys.findIndex(selectable);
    return (
      <div
        {...canvasAria(ariaLabel ?? summarizeMap({ mode: "map", entries: list }), firstSelectable >= 0)}
        style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0.5rem 0", justifyContent: "center" }}
      >
        {list.length === 0 && (
          <span style={{ color: DEFAULTS.dimColor, fontSize: "0.8rem" }}>(empty map)</span>
        )}
        {list.map((e, i) => {
          const key = keys[i]!;
          const active = (activeKey != null && String(activeKey) === key) || isSelected(key);
          const lit = linked.has(key);
          return (
            <span
              key={`${key}-${i}`}
              {...partProps(key, i === firstSelectable)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "3px 9px",
                borderRadius: 999,
                fontSize: "0.75rem",
                fontFamily: "ui-monospace, SFMono-Regular, monospace",
                border: `1.5px solid ${active ? activeColor : lit ? highlightColor : DEFAULTS.border}`,
                background: active ? activeColor : lit ? alpha(highlightColor, 18) : "transparent",
                color: active ? "var(--kw-widget-active-foreground, #111827)" : DEFAULTS.text,
                cursor: selectable(key) ? "pointer" : undefined,
                outline: "none",
                transition: "background 0.25s ease, border-color 0.25s ease",
              }}
            >
              <WidgetText text={entryText(e)} />
              {hashBadge(e)}
            </span>
          );
        })}
      </div>
    );
  }

  const list = slots ?? [];
  const m = Math.max(0, Math.min(MAX_SLOTS, Math.trunc(finite(capacity) ? capacity : list.length)));
  const cells: unknown[] = Array.from({ length: m }, (_, i) => list[i] ?? null);
  const tombSet = toSet(tombstones);
  const activeSet = toSet(activeSlots);
  const highlightSet = toSet(highlightSlots);
  const dimSet = toSet(dimSlots);
  const path = (Array.isArray(probePath) ? probePath : []).filter(
    (slot): slot is number => finite(slot) && slot >= 0 && slot < m,
  );
  const probeOrder = new Map<number, number>();
  path.forEach((slot, i) => {
    if (!probeOrder.has(slot)) probeOrder.set(slot, i + 1);
  });

  const items = cells.map(entriesOf);
  // Chaining counts entries, since a bucket holds many; open addressing counts
  // occupied slots, since each holds at most one.
  const used =
    resolved === "chain"
      ? items.reduce((n, list, i) => n + (tombSet.has(i) ? 0 : list.length), 0)
      : items.filter((list, i) => list.length > 0 && !tombSet.has(i)).length;
  const load = m > 0 ? used / m : 0;
  const showLoad = showLoadFactor ?? true;
  const rowsOf = (list: unknown[]) => (list.length > MAX_CHAIN ? MAX_CHAIN + 1 : list.length);
  const maxChain = items.reduce((hi, list) => Math.max(hi, rowsOf(list)), 1);
  const firstSelectable = cells.findIndex((_, i) => selectable(String(i)));

  const centreOf = (i: number) => i * (slotWidth + SLOT_GAP) + slotWidth / 2;
  const rowWidth = Math.max(0, m * (slotWidth + SLOT_GAP) - SLOT_GAP);
  const arrowId = `kw-map-probe-${uid}`;

  return (
    <div
      {...canvasAria(ariaLabel ?? summarizeMap({ mode: resolved, capacity: m, slots: cells }), firstSelectable >= 0)}
      style={{ padding: "0.5rem 0", overflowX: "auto" }}
    >
      {path.length > 1 && (
        <svg
          aria-hidden
          width={rowWidth}
          height={PROBE_H}
          style={{ display: "block", margin: "0 auto", overflow: "visible" }}
        >
          <defs>
            <marker id={arrowId} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={6} markerHeight={6} orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={activeColor} />
            </marker>
          </defs>
          {path.slice(1).map((to, i) => {
            const from = path[i]!;
            if (from === to) return null;
            const xa = centreOf(from);
            const xb = centreOf(to);
            return (
              <path
                key={i}
                d={`M ${xa} ${PROBE_H - 2} Q ${(xa + xb) / 2} ${-4} ${xb} ${PROBE_H - 2}`}
                fill="none"
                stroke={activeColor}
                strokeWidth={1.5}
                markerEnd={`url(#${arrowId})`}
              />
            );
          })}
        </svg>
      )}
      <div style={{ display: "flex", gap: SLOT_GAP, width: "max-content", margin: "0 auto", alignItems: "flex-start" }}>
        {cells.map((slot, i) => {
          const key = String(i);
          const isTomb = slot === "DEL" || tombSet.has(i);
          const entries = items[i]!;
          const active = activeSet.has(i) || isSelected(key);
          const lit = highlightSet.has(i) || entries.some((e) => linked.has(String(e.key)));
          const dim = dimSet.has(i);
          const probe = probeOrder.get(i);
          const border = active ? activeColor : lit ? highlightColor : isTomb ? DEFAULTS.tombstone : DEFAULTS.border;
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, width: slotWidth }}>
              {/* Every slot reserves the label row so probed slots stay level with the rest. */}
              {path.length > 0 && (
                <span
                  title={probe != null ? `probe ${probe}` : undefined}
                  aria-hidden={probe == null || undefined}
                  style={{
                    fontSize: "0.6rem",
                    fontWeight: 700,
                    color: activeColor,
                    fontFamily: "ui-monospace, SFMono-Regular, monospace",
                    visibility: probe != null ? "visible" : "hidden",
                  }}
                >
                  {probe != null ? `${probe}↓` : "0↓"}
                </span>
              )}
              <div
                {...partProps(key, i === firstSelectable)}
                style={{
                  width: slotWidth,
                  minHeight: 30,
                  display: "flex",
                  flexDirection: "column",
                  gap: 1,
                  padding: 2,
                  borderRadius: 4,
                  border: `1.5px solid ${border}`,
                  background: active
                    ? alpha(activeColor, 22)
                    : lit
                      ? alpha(highlightColor, 16)
                      : DEFAULTS.surface,
                  opacity: dim ? 0.45 : 1,
                  cursor: selectable(key) ? "pointer" : undefined,
                  outline: "none",
                  transition: "background 0.25s ease, border-color 0.25s ease, opacity 0.25s ease",
                }}
              >
                {isTomb && entries.length === 0 && (
                  <span
                    style={{
                      fontSize: "0.62rem",
                      fontWeight: 700,
                      color: DEFAULTS.tombstone,
                      textAlign: "center",
                      fontFamily: "ui-monospace, SFMono-Regular, monospace",
                    }}
                  >
                    DEL
                  </span>
                )}
                {entries.length === 0 && !isTomb && (
                  <span style={{ fontSize: "0.68rem", color: DEFAULTS.dimColor, textAlign: "center" }}>·</span>
                )}
                {entries.slice(0, MAX_CHAIN).map((e, j) => {
                  const entryKey = String(e.key);
                  const isActiveKey = activeKey != null && String(activeKey) === entryKey;
                  return (
                    <span
                      key={`${entryKey}-${j}`}
                      style={{
                        fontSize: "0.66rem",
                        fontFamily: "ui-monospace, SFMono-Regular, monospace",
                        textAlign: "center",
                        padding: "1px 2px",
                        borderRadius: 3,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        background: isActiveKey ? activeColor : alpha(DEFAULTS.border, 45),
                        color: isActiveKey ? "var(--kw-widget-active-foreground, #111827)" : DEFAULTS.text,
                      }}
                      title={entryText(e)}
                    >
                      {entryText(e)}
                      {hashBadge(e)}
                    </span>
                  );
                })}
                {entries.length > MAX_CHAIN && (
                  <span style={{ fontSize: "0.62rem", color: DEFAULTS.dimColor, textAlign: "center" }}>
                    +{entries.length - MAX_CHAIN} more
                  </span>
                )}
                {/* Reserve the tallest chain's height so the row does not jump
                    as entries move between buckets. */}
                {resolved === "chain" && rowsOf(entries) < maxChain && (
                  <span aria-hidden style={{ height: (maxChain - rowsOf(entries)) * 15 }} />
                )}
              </div>
              {showIndices && (
                <span
                  style={{
                    fontSize: "0.6rem",
                    color: DEFAULTS.dimColor,
                    fontFamily: "ui-monospace, SFMono-Regular, monospace",
                  }}
                >
                  {i}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {showLoad && (
        <div
          style={{
            textAlign: "center",
            marginTop: 6,
            fontSize: "0.7rem",
            color: DEFAULTS.dimColor,
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
          }}
        >
          α = {used}/{m} = {load.toFixed(2)}
          {load > 0.75 && <span style={{ color: DEFAULTS.tombstone }}> · resize soon</span>}
        </div>
      )}
    </div>
  );
}

export { isEntry as isMapEntry };
