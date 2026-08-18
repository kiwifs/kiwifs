export type FrontmatterChip = {
  key: string;
  /** Stable lookup for colours (`google`, `easy`). */
  colorKey: string;
  label: string;
  count?: number;
};

export type UITagsConfig = {
  banner: string[];
  hide: string[];
  colors: Record<string, string>;
};

export const DEFAULT_UI_TAGS: UITagsConfig = {
  banner: ["tags"],
  hide: [],
  colors: {},
};

export function resolveUITags(raw?: Partial<UITagsConfig> | null): UITagsConfig {
  return {
    banner: raw?.banner ? [...raw.banner] : [...DEFAULT_UI_TAGS.banner],
    hide: raw?.hide ? [...raw.hide] : [],
    colors: raw?.colors ? { ...raw.colors } : {},
  };
}

const TUPLE_RE = /\[\s*([^[\],]+?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/g;

function isNumericCount(value: unknown): value is number {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string") return false;
  return /^-?\d+(?:\.\d+)?$/.test(value.trim());
}

function cleanLabel(value: unknown): string {
  return String(value ?? "").trim().replace(/^["']|["']$/g, "");
}

/** `[name, n]` pairs only — two strings like `[easy, blind75]` are not a pair. */
export function labeledCount(value: unknown): { label: string; count?: number } | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) return null;
  if (value.some((item) => Array.isArray(item) || (typeof item === "object" && item != null))) {
    return null;
  }
  const label = cleanLabel(value[0]);
  if (!label) return null;
  if (value.length === 1) return { label };
  if (!isNumericCount(value[1])) return null;
  return { label, count: Number(value[1]) };
}

/** Nested YAML flow lists: `[[facebook, 2], [google, 210]]`. */
export function parseFlowList(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return trimmed;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  const items: unknown[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "[") depth += 1;
    else if (ch === "]") depth -= 1;
    else if (ch === "," && depth === 0) {
      items.push(parseFlowValue(inner.slice(start, i)));
      start = i + 1;
    }
  }
  items.push(parseFlowValue(inner.slice(start)));
  return items;
}

function parseFlowValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) return parseFlowList(trimmed);
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function tuplesFromString(raw: string): { label: string; count: number }[] {
  const matches = [...raw.matchAll(TUPLE_RE)];
  return matches.map((match) => ({
    label: cleanLabel(match[1]),
    count: Number(match[2]),
  })).filter((row) => row.label.length > 0);
}

/**
 * Company hits, vote tallies, and similar `[name, n]` lists — including the
 * string / comma-split shapes naive YAML fallbacks produce.
 */
export function parseLabeledCounts(value: unknown): { label: string; count?: number }[] {
  if (value == null) return [];
  if (typeof value === "string") {
    const fromText = tuplesFromString(value);
    if (fromText.length > 0) return fromText;
    const flowed = parseFlowList(value);
    if (Array.isArray(flowed)) return parseLabeledCounts(flowed);
    return [];
  }
  if (!Array.isArray(value)) return [];

  const nested = value.map(labeledCount);
  if (value.length > 0 && nested.every((row) => row != null)) {
    return nested as { label: string; count?: number }[];
  }

  const single = labeledCount(value);
  if (single) return [single];

  if (value.every((item) => typeof item === "string" || typeof item === "number")) {
    return tuplesFromString(value.map(String).join(", "));
  }
  return [];
}

export function chipsFromField(key: string, value: unknown): FrontmatterChip[] {
  if (value == null) return [];
  if (typeof value === "boolean") {
    return value ? [{ key, colorKey: key, label: key }] : [];
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return [{ key, colorKey: key, label: `${key} ${value}` }];
  }

  const pairs = parseLabeledCounts(value);
  if (pairs.length > 0) {
    return pairs.map((pair) => ({
      key,
      colorKey: pair.label,
      label: pair.label,
      count: pair.count,
    }));
  }

  if (typeof value === "string") {
    const text = value.trim();
    return text ? [{ key, colorKey: text, label: text }] : [];
  }
  if (!Array.isArray(value)) return [];

  const chips: FrontmatterChip[] = [];
  for (const item of value) {
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      const text = String(item).trim();
      if (text) chips.push({ key, colorKey: text, label: text });
    }
  }
  return chips;
}

export function bannerChips(meta: Record<string, unknown>, banner: string[]): FrontmatterChip[] {
  const difficulty = typeof meta.difficulty === "string" ? meta.difficulty.toLowerCase() : "";
  const chips: FrontmatterChip[] = [];
  for (const key of banner) {
    if (!key || key === "title" || key === "status") continue;
    for (const chip of chipsFromField(key, meta[key])) {
      if (key === "tags" && difficulty && chip.colorKey.toLowerCase() === difficulty) continue;
      chips.push(chip);
    }
  }
  return chips;
}

export function propertyHiddenKeys(banner: string[], hide: string[]): Set<string> {
  return new Set(["title", "status", "tags", ...banner, ...hide]);
}
