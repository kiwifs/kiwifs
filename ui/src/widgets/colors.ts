/**
 * Blend a color toward transparent.
 *
 * Widget colors are CSS custom properties, so the usual trick of appending a
 * hex alpha suffix produces invalid CSS (`var(--x, #22c55e)2e`) and the
 * declaration is dropped. color-mix works with any color value.
 */
export function alpha(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

const GROUP_FALLBACKS = ["#3b82f6", "#d97706", "#ec4899", "#14b8a6", "#f97316", "#6366f1"];

/** Number of distinct colors {@link groupColor} cycles through. */
export const GROUP_COLOR_COUNT = GROUP_FALLBACKS.length;

/**
 * The i-th color of the group palette — one color per connected component,
 * partition, or cluster. Cycles after {@link GROUP_COLOR_COUNT} groups.
 */
export function groupColor(i: number): string {
  const n = GROUP_FALLBACKS.length;
  const k = ((Math.trunc(i) % n) + n) % n;
  return `var(--kw-widget-group-${k}, ${GROUP_FALLBACKS[k]})`;
}

/** Per-key values: an array indexed by numeric key, or an object keyed by key. */
export type KeyedValues<T> = readonly (T | null | undefined)[] | Readonly<Record<string, T | null | undefined>>;

export function lookupKeyed<T>(values: KeyedValues<T> | undefined, key: string | number): T | undefined {
  if (!values) return undefined;
  const v = Array.isArray(values)
    ? (values as readonly (T | null | undefined)[])[Number(key)]
    : (values as Record<string, T | null | undefined>)[String(key)];
  return v ?? undefined;
}
