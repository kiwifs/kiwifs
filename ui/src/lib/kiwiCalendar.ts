import type { QueryResponse } from "./api";

export type CalendarPageEntry = {
  path: string;
  date: string;
  title?: string;
  status?: string;
  state?: string;
  tags?: unknown;
};

export const DEFAULT_DATE_FIELD = "date";

/** Common frontmatter keys that often hold ISO dates. */
export const COMMON_DATE_FIELDS = [
  "date",
  "due",
  "created",
  "last_executed",
  "reviewed",
  "last-reviewed",
  "next-review",
  "updated",
] as const;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const STATUS_DOT_COLORS: Record<string, string> = {
  accepted: "bg-emerald-500",
  proposed: "bg-amber-400",
  draft: "bg-slate-400",
  published: "bg-blue-500",
  superseded: "bg-muted-foreground/60",
  resolved: "bg-emerald-500",
  active: "bg-emerald-500",
  review: "bg-amber-400",
};

const TAG_DOT_COLORS = [
  "bg-violet-500",
  "bg-cyan-500",
  "bg-orange-500",
  "bg-pink-500",
  "bg-teal-500",
];

export function escapeDqlField(field: string): string {
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field)) return field;
  return `\`${field.replace(/`/g, "``")}\``;
}

export function normalizeDateValue(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const dateStr = raw.slice(0, 10);
  return ISO_DATE_RE.test(dateStr) ? dateStr : null;
}

export function isDateLikeValue(value: unknown): boolean {
  return normalizeDateValue(value) != null;
}

export function discoverDateFields(
  frontmatterSamples: Record<string, unknown>[],
): string[] {
  const found = new Set<string>();
  for (const fm of frontmatterSamples) {
    for (const [key, value] of Object.entries(fm)) {
      if (key.startsWith("_")) continue;
      if (isDateLikeValue(value)) found.add(key);
    }
  }
  const ordered: string[] = [];
  if (found.has(DEFAULT_DATE_FIELD)) ordered.push(DEFAULT_DATE_FIELD);
  for (const key of COMMON_DATE_FIELDS) {
    if (key !== DEFAULT_DATE_FIELD && found.has(key)) ordered.push(key);
  }
  const rest = [...found]
    .filter((k) => !ordered.includes(k))
    .sort((a, b) => a.localeCompare(b));
  ordered.push(...rest);
  return ordered.length > 0 ? ordered : [DEFAULT_DATE_FIELD];
}

export function monthRange(year: number, month: number): {
  start: string;
  endExclusive: string;
} {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const endExclusive = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
  return { start, endExclusive };
}

export function buildMonthQuery(
  dateField: string,
  year: number,
  month: number,
): string {
  const field = escapeDqlField(dateField);
  const { start, endExclusive } = monthRange(year, month);
  return `TABLE _path, title, status, state, tags, ${field} WHERE ${field} >= "${start}" AND ${field} < "${endExclusive}" LIMIT 200`;
}

export function parseCalendarRows(
  data: QueryResponse,
  dateField: string,
): CalendarPageEntry[] {
  const fieldKey =
    data.columns?.find((c) => c === dateField) ??
    data.columns?.find((c) => c !== "_path" && c !== "path" && c !== "title") ??
    dateField;

  const entries: CalendarPageEntry[] = [];
  for (const row of data.rows ?? []) {
    const date = normalizeDateValue(row[fieldKey]);
    if (!date) continue;
    const path = String(row["_path"] ?? row["path"] ?? "");
    if (!path) continue;
    entries.push({
      path,
      date,
      title: typeof row.title === "string" ? row.title : undefined,
      status: typeof row.status === "string" ? row.status : undefined,
      state: typeof row.state === "string" ? row.state : undefined,
      tags: row.tags,
    });
  }
  return entries;
}

export function groupEntriesByDate(
  entries: CalendarPageEntry[],
): Map<string, CalendarPageEntry[]> {
  const byDate = new Map<string, CalendarPageEntry[]>();
  for (const entry of entries) {
    const list = byDate.get(entry.date);
    if (list) list.push(entry);
    else byDate.set(entry.date, [entry]);
  }
  return byDate;
}

export function dotColorForEntry(entry: CalendarPageEntry): string {
  const status = (entry.status ?? entry.state ?? "").toLowerCase();
  if (status && STATUS_DOT_COLORS[status]) return STATUS_DOT_COLORS[status];

  const tags = entry.tags;
  if (Array.isArray(tags) && tags.length > 0) {
    const first = String(tags[0]);
    let hash = 0;
    for (let i = 0; i < first.length; i++) {
      hash = (hash + first.charCodeAt(i) * (i + 1)) % TAG_DOT_COLORS.length;
    }
    return TAG_DOT_COLORS[hash] ?? "bg-primary";
  }

  return "bg-primary";
}

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function monthGridCells(year: number, month: number): (number | null)[] {
  const firstDay = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  let startDow = firstDay.getDay() - 1;
  if (startDow < 0) startDow = 6;

  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function todayKey(): string {
  const now = new Date();
  return dateKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** ISO week start (Monday) for a given calendar day. */
export function weekStartFromDate(year: number, month: number, day: number): Date {
  const d = new Date(year, month - 1, day);
  let dow = d.getDay() - 1;
  if (dow < 0) dow = 6;
  d.setDate(d.getDate() - dow);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function weekDates(start: Date): { year: number; month: number; day: number }[] {
  const out: { year: number; month: number; day: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    out.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
    });
  }
  return out;
}
