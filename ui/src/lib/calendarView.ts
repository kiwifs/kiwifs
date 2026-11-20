// Helpers for the full-screen calendar view: which frontmatter fields hold
// dates, the DQL that fetches a visible range, and how rows land on days.

import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import type { MetaResult, QueryResponse } from "./api";
import { titleize } from "./paths";

export const DEFAULT_CALENDAR_FIELD = "date";

/** Common date fields, listed first in the field picker when present. */
export const PREFERRED_CALENDAR_FIELDS = [
  "date",
  "due",
  "created",
  "updated",
  "published_at",
  "last_executed",
];

export type CalendarColorMode = "tag" | "state" | "none";

export type CalendarLayout = "month" | "week";

export type CalendarEntry = {
  path: string;
  title: string;
  /** yyyy-MM-dd the page lands on. */
  day: string;
  /** Tag or workflow state the entry is colored by; null when uncolored. */
  colorKey: string | null;
};

/** Monday first, matching the inline CALENDAR query block. */
const WEEK_STARTS_ON = 1;

const DAY_KEY_RE = /^(\d{4}-\d{2}-\d{2})(?:$|[T ])/;

// The field is interpolated into DQL, so only plain identifiers are allowed:
// a name like `due-date` would parse as subtraction.
const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isCalendarField(name: string): boolean {
  return FIELD_RE.test(name);
}

/** The yyyy-MM-dd prefix of an ISO date or datetime, or null. */
export function calendarDayKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = DAY_KEY_RE.exec(value.trim());
  return m ? m[1] : null;
}

export function formatDayKey(day: Date): string {
  return format(day, "yyyy-MM-dd");
}

/** The days a layout shows around `anchor`, padded to whole weeks. */
export function calendarDays(anchor: Date, layout: CalendarLayout): Date[] {
  const opts = { weekStartsOn: WEEK_STARTS_ON } as const;
  const start = layout === "week" ? startOfWeek(anchor, opts) : startOfWeek(startOfMonth(anchor), opts);
  const end = layout === "week" ? endOfWeek(anchor, opts) : endOfWeek(endOfMonth(anchor), opts);
  return eachDayOfInterval({ start, end });
}

/**
 * DQL for every page whose `field` falls in [first, last]. The upper bound is
 * exclusive on the following day so datetimes late on the last day still match.
 */
export function buildCalendarQuery(field: string, first: Date, last: Date): string {
  if (!isCalendarField(field)) {
    throw new Error(`invalid date field: ${field}`);
  }
  const columns = ["title", "tags", "state", "status", field].filter(
    (c, i, all) => all.indexOf(c) === i,
  );
  const from = formatDayKey(first);
  const until = formatDayKey(addDays(last, 1));
  return (
    `TABLE ${columns.join(", ")} ` +
    `WHERE ${field} >= DATE("${from}") AND ${field} < DATE("${until}") ` +
    `SORT ${field} ASC`
  );
}

/** Tags arrive as an array, a JSON-encoded array, or a comma-separated string. */
export function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((t) => String(t).trim()).filter(Boolean);
  }
  if (typeof value !== "string") return [];
  const raw = value.trim();
  if (raw.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parseTags(parsed);
    } catch {
      // Not JSON; fall through to the comma split.
    }
  }
  return raw
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((t) => t.trim().replace(/^#/, ""))
    .filter(Boolean);
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  return s ? s : null;
}

export function entryColorKey(
  row: Record<string, unknown>,
  mode: CalendarColorMode,
): string | null {
  if (mode === "tag") return parseTags(row.tags)[0] ?? null;
  if (mode === "state") return nonEmptyString(row.state) ?? nonEmptyString(row.status);
  return null;
}

/** Group query rows by the day their `field` value falls on. */
export function groupCalendarRows(
  rows: Record<string, unknown>[],
  field: string,
  mode: CalendarColorMode,
): Map<string, CalendarEntry[]> {
  const byDay = new Map<string, CalendarEntry[]>();
  for (const row of rows) {
    const day = calendarDayKey(row[field]);
    const path = nonEmptyString(row._path) ?? nonEmptyString(row.path);
    if (!day || !path) continue;
    const entry: CalendarEntry = {
      path,
      title: nonEmptyString(row.title) ?? titleize(path),
      day,
      colorKey: entryColorKey(row, mode),
    };
    const list = byDay.get(day);
    if (list) list.push(entry);
    else byDay.set(day, [entry]);
  }
  return byDay;
}

/** Distinct color keys in display order, for the legend. */
export function calendarLegend(byDay: Map<string, CalendarEntry[]>): string[] {
  const seen = new Set<string>();
  for (const entries of byDay.values()) {
    for (const e of entries) {
      if (e.colorKey) seen.add(e.colorKey);
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/**
 * Frontmatter fields holding an ISO date in at least one sampled page,
 * preferred names first. Index-computed `_` fields are skipped.
 */
export function discoverDateFields(results: MetaResult[]): string[] {
  const found = new Set<string>();
  for (const r of results) {
    for (const [key, value] of Object.entries(r.frontmatter ?? {})) {
      if (key.startsWith("_") || found.has(key) || !isCalendarField(key)) continue;
      if (calendarDayKey(value)) found.add(key);
    }
  }
  const preferred = PREFERRED_CALENDAR_FIELDS.filter((f) => found.has(f));
  const rest = [...found]
    .filter((f) => !PREFERRED_CALENDAR_FIELDS.includes(f))
    .sort((a, b) => a.localeCompare(b));
  return [...preferred, ...rest];
}

/**
 * The field to show: a remembered choice wins, then `date`, then the first
 * discovered date field.
 */
export function pickCalendarField(discovered: string[], stored: string | null): string {
  if (stored && isCalendarField(stored)) return stored;
  if (discovered.length === 0 || discovered.includes(DEFAULT_CALENDAR_FIELD)) {
    return DEFAULT_CALENDAR_FIELD;
  }
  return discovered[0];
}

/** Picker options: discovered fields plus the current one if it is missing. */
export function calendarFieldOptions(discovered: string[], current: string): string[] {
  return discovered.includes(current) ? discovered : [current, ...discovered];
}

export const CALENDAR_PAGE_SIZE = 200;
export const CALENDAR_MAX_ROWS = 2000;

/**
 * Fetch every row of a range query. The query endpoint caps a page at 200
 * rows, so follow `has_more` up to CALENDAR_MAX_ROWS.
 */
export async function fetchCalendarRows(
  query: (dql: string, opts: { limit: number; offset: number }) => Promise<QueryResponse>,
  dql: string,
): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; offset < CALENDAR_MAX_ROWS; offset += CALENDAR_PAGE_SIZE) {
    const page = await query(dql, { limit: CALENDAR_PAGE_SIZE, offset });
    rows.push(...(page.rows ?? []));
    if (!page.has_more) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}
