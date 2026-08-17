import yaml from "js-yaml";

export type TrackerMode = {
  id: string;
  label: string;
  /** Frontmatter keys to collect filter chips from. Default `["tags"]`. */
  fields: string[];
};

export type TrackerConfig = {
  stateName: string;
  modes: TrackerMode[];
};

export type CompanyHit = {
  slug: string;
  hits: number;
};

export type TrackerPageMeta = {
  title?: string;
  difficulty?: string;
  premium?: boolean;
  tags?: string[];
  companies?: CompanyHit[];
  freq?: number;
  extras?: Record<string, string[]>;
};

const DEFAULT_MODE: TrackerMode = { id: "tags", label: "Tags", fields: ["tags"] };

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

export function parseCompanies(value: unknown): CompanyHit[] {
  const out: CompanyHit[] = [];
  if (typeof value === "string") {
    const re = /\[\s*([^[\],]+?)\s*,\s*(\d+)\s*\]/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(value))) {
      out.push({ slug: match[1].trim(), hits: Number(match[2]) });
    }
    return out;
  }
  if (!Array.isArray(value)) return out;
  for (const item of value) {
    if (Array.isArray(item) && item[0] != null) {
      out.push({ slug: String(item[0]).trim(), hits: Number(item[1]) || 0 });
    } else if (typeof item === "string" && item.trim()) {
      out.push({ slug: item.trim(), hits: 0 });
    }
  }
  return out.filter((row) => row.slug.length > 0);
}

export function parseTrackerPageMeta(fm: Record<string, unknown>): TrackerPageMeta {
  const meta: TrackerPageMeta = {};
  if (typeof fm.title === "string") meta.title = fm.title;
  if (typeof fm.difficulty === "string") meta.difficulty = fm.difficulty.toLowerCase();
  const tags = asStringList(fm.tags);
  if (tags.length > 0) meta.tags = tags;
  if (fm.premium === true || fm.premium === "true" || tags.includes("premium")) {
    meta.premium = true;
  }
  const companies = parseCompanies(fm.companies);
  if (companies.length > 0) meta.companies = companies;
  if (typeof fm.freq === "number" && Number.isFinite(fm.freq)) meta.freq = fm.freq;
  if (typeof fm.freq === "string" && fm.freq.trim() && !Number.isNaN(Number(fm.freq))) {
    meta.freq = Number(fm.freq);
  }

  const reserved = new Set(["title", "difficulty", "premium", "tags", "companies", "freq"]);
  const extras: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(fm)) {
    if (reserved.has(key)) continue;
    const list = asStringList(value);
    if (list.length > 0) extras[key] = list;
  }
  if (Object.keys(extras).length > 0) meta.extras = extras;
  return meta;
}

/** Filter chips for the active mode. `tags` also includes difficulty, matching the original tracker. */
export function chipsForMeta(meta: TrackerPageMeta | undefined, fields: string[]): string[] {
  if (!meta) return [];
  const chips = new Set<string>();
  for (const field of fields) {
    if (field === "tags") {
      for (const tag of meta.tags ?? []) chips.add(tag);
      if (meta.difficulty) chips.add(meta.difficulty);
    } else if (field === "difficulty" && meta.difficulty) {
      chips.add(meta.difficulty);
    } else if (field === "premium" && meta.premium) {
      chips.add("premium");
    } else if (field === "companies") {
      for (const company of meta.companies ?? []) chips.add(company.slug);
    } else if (field === "freq" && meta.freq != null) {
      chips.add(`freq ${meta.freq}`);
    } else if (meta.extras?.[field]) {
      for (const item of meta.extras[field]) chips.add(item);
    }
  }
  return [...chips];
}

export function parseTrackerConfig(raw: string): TrackerConfig {
  const trimmed = raw.trim();
  if (!trimmed) return { stateName: "progress", modes: [DEFAULT_MODE] };

  const looksYaml = trimmed.includes(":") || trimmed.startsWith("-");
  if (!looksYaml) {
    return { stateName: trimmed, modes: [DEFAULT_MODE] };
  }

  try {
    const parsed = yaml.load(trimmed);
    if (typeof parsed === "string") {
      return { stateName: parsed.trim() || "progress", modes: [DEFAULT_MODE] };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { stateName: "progress", modes: [DEFAULT_MODE] };
    }
    const obj = parsed as Record<string, unknown>;
    const stateName =
      (typeof obj.state === "string" && obj.state.trim()) ||
      (typeof obj.stateName === "string" && obj.stateName.trim()) ||
      "progress";
    const modes = parseModes(obj.modes);
    return { stateName, modes };
  } catch {
    return { stateName: trimmed, modes: [DEFAULT_MODE] };
  }
}

function parseModes(raw: unknown): TrackerMode[] {
  if (!Array.isArray(raw) || raw.length === 0) return [DEFAULT_MODE];
  const modes: TrackerMode[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const label = typeof row.label === "string" ? row.label.trim() : "";
    const id =
      (typeof row.id === "string" && row.id.trim()) ||
      label.toLowerCase().replace(/\s+/g, "-") ||
      `mode-${modes.length}`;
    const fields = asStringList(row.fields);
    modes.push({
      id,
      label: label || id,
      fields: fields.length > 0 ? fields : ["tags"],
    });
  }
  return modes.length > 0 ? modes : [DEFAULT_MODE];
}
