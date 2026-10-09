import { ArrayStack, type ArrayArrow, type ArrayPointer } from "./ArrayView";
import { toSet, type Many } from "./sets";

export interface BitsViewProps {
  /** The mask as a number. */
  value: number;
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
  /** Show bit 0 on the left instead of the right. Default false (most significant first). */
  lsbFirst?: boolean;
  /** Show the decimal value and popcount beside the bits. Default true. */
  showSummary?: boolean;
  cellSize?: number;
  activeColor?: string;
  highlightColor?: string;
}

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
  lsbFirst = false,
  showSummary = true,
  cellSize,
  activeColor,
  highlightColor,
}: BitsViewProps) {
  const v = Math.max(0, Math.trunc(value || 0));
  const width = Math.max(1, bits ?? v.toString(2).length);
  const order = Array.from({ length: width }, (_, i) => (lsbFirst ? i : width - 1 - i));
  const col = new Map(order.map((bit, i) => [bit, i]));
  const at = (bitSet: Set<number>) => new Set(Array.from(bitSet, (b) => col.get(b)).filter((i): i is number => i != null));

  const set = order.map((bit) => (v >> bit) & 1);
  const ones = set.reduce<number>((a, b) => a + b, 0);
  const hasLabels = !!labels?.some((l) => l != null && l !== "");

  const ptrs: ArrayPointer[] = pointers
    .filter((p) => col.has(p.bit))
    .map((p) => ({ index: col.get(p.bit)!, label: p.label, color: p.color, side: p.side }));
  const arcs: ArrayArrow[] | undefined = arrows
    ?.filter((a) => col.has(a.from) && col.has(a.to))
    .map((a) => ({ ...a, from: col.get(a.from)!, to: col.get(a.to)! }));

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
        }]}
        indexLabels={order}
        showIndices
        cellSize={cellSize ?? 40}
        activeColor={activeColor}
        highlightColor={highlightColor}
      />
      {showSummary && (
        <div style={{ fontSize: "0.75rem", color: "var(--kw-widget-dim, #94a3b8)", fontVariantNumeric: "tabular-nums", lineHeight: 1.6 }}>
          <div><span style={{ color: "var(--kw-widget-text, #e5e7eb)", fontWeight: 700 }}>{v}</span> = 0b{v.toString(2).padStart(width, "0")}</div>
          <div>{ones} bit{ones === 1 ? "" : "s"} set</div>
        </div>
      )}
    </div>
  );
}
