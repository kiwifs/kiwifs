/**
 * Highlight props accept whatever an author naturally writes: a Set, an
 * array, or a single value. Widgets normalise once with `toSet`.
 */
export type Many<T> = Set<T> | readonly T[] | T | null | undefined;

export function toSet<T>(value: Many<T>): Set<T> {
  if (value == null) return new Set();
  if (value instanceof Set) return value;
  if (Array.isArray(value)) return new Set(value as readonly T[]);
  return new Set([value as T]);
}

/** A matrix cell as `"r,c"`, `[r, c]`, or `{ r, c }`. */
export type CellRef = string | readonly [number, number] | { r: number; c: number };

export function cellKey(cell: CellRef): string {
  if (typeof cell === "string") return cell.replace(/\s+/g, "");
  if (Array.isArray(cell)) return `${cell[0]},${cell[1]}`;
  const rc = cell as { r: number; c: number };
  return `${rc.r},${rc.c}`;
}

export function parseCell(cell: CellRef): [number, number] {
  const [r, c] = cellKey(cell).split(",").map(Number);
  return [r ?? 0, c ?? 0];
}

function isSingleCell(value: unknown): value is CellRef {
  if (typeof value === "string") return true;
  if (Array.isArray(value)) return value.length === 2 && typeof value[0] === "number" && typeof value[1] === "number";
  return typeof value === "object" && value !== null && "r" in value && "c" in value;
}

export type ManyCells = Set<string> | readonly CellRef[] | CellRef | null | undefined;

export function toCellSet(value: ManyCells): Set<string> {
  if (value == null) return new Set();
  if (value instanceof Set) {
    const out = new Set<string>();
    for (const v of value) out.add(cellKey(v));
    return out;
  }
  if (isSingleCell(value)) return new Set([cellKey(value)]);
  return new Set((value as readonly CellRef[]).map(cellKey));
}
