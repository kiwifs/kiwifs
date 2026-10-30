import { ArrayStack, type ArrayArrow, type ArrayPointer } from "./ArrayView";
import { toSet, type Many } from "./sets";
import { summarizeBits } from "./widgetA11y";
import { useInspect, type InspectRef } from "./inspect";
import {
  decodeBits,
  fieldValue,
  toBigBits,
  toggleBit,
  type BitField,
  type BitsDecoding,
  type BitsValue,
} from "./bitsDecode";

export type { BitField, BitsDecoding, BitsValue } from "./bitsDecode";

export interface BitsViewProps {
  /**
   * The mask. A number, or — for patterns wider than 53 bits, such as a real
   * float64 — a bigint or a `"0x…"` / `"0b…"` string. Negative numbers are
   * shown as their two's complement bits.
   */
  value: BitsValue;
  /** Number of bits shown. Defaults to the mask's bit length (at least 1). */
  bits?: number;
  /** What each bit stands for, indexed by bit position (bit 0 = least significant). */
  labels?: (string | number | null | undefined)[];
  /** Row title, e.g. `mask`. */
  label?: string;
  /** Bit positions being set or tested this step. */
  activeBits?: Many<number>;
  /** Bit positions read by the current step. */
  readBits?: Many<number>;
  /** Secondary highlight, by bit position. */
  highlightBits?: Many<number>;
  /** Pointers by bit position. */
  pointers?: { bit: number; label: string; color?: string; side?: "top" | "bottom" }[];
  /** Arcs between bit positions. */
  arrows?: { from: number; to: number; label?: string; color?: string; dashed?: boolean; side?: "top" | "bottom" }[];
  /**
   * Named bit ranges, drawn as brackets under the row: a float's sign,
   * exponent and mantissa; a flags register; a packed struct. This plus
   * `decode` is why there is no FloatView and no TwosComplementView.
   */
  fields?: BitField[];
  /** How to read the pattern in the summary row. Default `uint`. */
  decode?: BitsDecoding | BitsDecoding[];
  /** Show bit 0 on the left instead of the right. Default false (most significant first). */
  lsbFirst?: boolean;
  /** Show the decimal value and popcount beside the bits. Default true. */
  showSummary?: boolean;
  /**
   * Let the reader flip a bit. Receives the new value and the bit flipped: a
   * number when `value` is a number, a bigint when it is a bigint or string.
   */
  onBitToggle?: (value: number | bigint, bit: number) => void;
  /** Reported when the reader selects a bit. */
  onSelect?: (ref: InspectRef) => void;
  /** Bit position → explanation. */
  why?: Record<string, string>;
  /** Name for the inspect bus. */
  widgetId?: string;
  /** Side of one bit cell in px. Default 40. */
  cellSize?: number;
  /** Primary highlight color. */
  activeColor?: string;
  /** Secondary highlight color. */
  highlightColor?: string;
  /** Accessible name. Defaults to a summary of the value and set bits. */
  ariaLabel?: string;
}

const DIM = "var(--kw-widget-dim, #94a3b8)";
const TEXT = "var(--kw-widget-text, #e5e7eb)";

/** A bitmask as a row of 0/1 cells labelled by bit position. */
export function BitsView({
  value,
  bits,
  labels,
  label,
  activeBits,
  readBits,
  highlightBits,
  pointers = [],
  arrows,
  fields,
  decode,
  lsbFirst = false,
  showSummary = true,
  onBitToggle,
  onSelect,
  why,
  widgetId = "bits",
  cellSize,
  activeColor,
  highlightColor,
  ariaLabel,
}: BitsViewProps) {
  const bus = useInspect();
  const big = toBigBits(value ?? 0);
  // A negative value without `bits` gets one sign bit above its magnitude, so
  // -5 reads as 1011 rather than collapsing to a single 0.
  const natural = big < 0n ? (-big).toString(2).length + 1 : big.toString(2).length;
  const width = Math.max(1, bits ?? natural);
  // The low `width` bits, as two's complement would store them: -5 at 8 bits
  // is 11111011.
  const masked = BigInt.asUintN(width, big);
  const v = Number(masked);
  const order = Array.from({ length: width }, (_, i) => (lsbFirst ? i : width - 1 - i));
  const col = new Map(order.map((bit, i) => [bit, i]));
  const at = (bitSet: Set<number>) => new Set(Array.from(bitSet, (b) => col.get(b)).filter((i): i is number => i != null));

  const set = order.map((bit) => Number((masked >> BigInt(bit)) & 1n));
  const ones = set.reduce<number>((a, b) => a + b, 0);
  const hasLabels = !!labels?.some((l) => l != null && l !== "");

  const ptrs: ArrayPointer[] = pointers
    .filter((p) => col.has(p.bit))
    .map((p) => ({ index: col.get(p.bit)!, label: p.label, color: p.color, side: p.side }));
  const arcs: ArrayArrow[] | undefined = arrows
    ?.filter((a) => col.has(a.from) && col.has(a.to))
    .map((a) => ({ ...a, from: col.get(a.from)!, to: col.get(a.to)! }));

  // A field covers contiguous bit positions, which are contiguous columns in
  // either direction — but which end is the bracket's start depends on which
  // way the row was drawn.
  const ranges = (fields ?? [])
    .map((f) => {
      const lo = Math.min(f.from, f.to);
      const hi = Math.max(f.from, f.to);
      const a = col.get(lo);
      const b = col.get(hi);
      if (a == null || b == null) return null;
      return {
        start: Math.min(a, b),
        end: Math.max(a, b),
        label: `${f.label} = ${fieldValue(masked, f)}`,
        color: f.color,
        side: "bottom" as const,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const decodings = decode == null ? [] : Array.isArray(decode) ? decode : [decode];
  const readings = decodings.map((as) => decodeBits(masked, width, as));

  // Selecting a bit is how a reader flips it, so cells become selectable as
  // soon as either a toggle handler or an explanation exists.
  const interactive = onBitToggle !== undefined || onSelect !== undefined;
  const selectHandler = interactive
    ? (ref: InspectRef) => {
        const bit = order[Number(ref.key)];
        if (bit != null) onBitToggle?.(toggleBit(value ?? 0, bit), bit);
        onSelect?.(ref);
      }
    : undefined;

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
      <ArrayStack
        rows={[{
          label,
          values: set,
          activeIndices: at(toSet(activeBits)),
          readIndices: at(toSet(readBits)),
          highlightIndices: new Set([...at(toSet(highlightBits))]),
          dimIndices: new Set(set.flatMap((b, i) => (b ? [] : [i]))),
          sublabels: hasLabels ? order.map((bit) => labels?.[bit]) : undefined,
          pointers: ptrs,
          arrows: arcs,
          ranges: ranges.length ? ranges : undefined,
        }]}
        indexLabels={order}
        ariaLabel={ariaLabel ?? summarizeBits({ value: v, bits: width, label, activeBits })}
        showIndices
        cellSize={cellSize ?? 40}
        activeColor={activeColor}
        highlightColor={highlightColor}
        widgetId={widgetId}
        why={why}
        onSelect={selectHandler}
      />
      {showSummary && (
        <div style={{ fontSize: "0.75rem", color: DIM, fontVariantNumeric: "tabular-nums", lineHeight: 1.6 }}>
          <div><span style={{ color: TEXT, fontWeight: 700 }}>{masked.toString()}</span> = 0b{masked.toString(2).padStart(width, "0")}</div>
          <div>{ones} bit{ones === 1 ? "" : "s"} set</div>
          {readings.map((reading, i) => (
            <div key={i}>
              {reading.label}: <span style={{ color: TEXT, fontWeight: 700 }}>{reading.text}</span>
              {reading.detail && (
                <div style={{ fontSize: "0.68rem", opacity: 0.75, fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
                  {reading.detail.join(" · ")}
                </div>
              )}
            </div>
          ))}
          {onBitToggle && bus.selected?.widget === widgetId && (
            <div style={{ fontSize: "0.68rem", opacity: 0.7 }}>Enter or click flips a bit</div>
          )}
        </div>
      )}
    </div>
  );
}
