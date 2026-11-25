// KiwiCalendar — Pages placed on a month grid by a frontmatter date field.
// Compact screens get a week list instead of the grid.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  addMonths,
  addWeeks,
  format,
  isSameMonth,
  isToday,
} from "date-fns";
import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { api } from "@kw/lib/api";
import { cn } from "@kw/lib/cn";
import { tagColor } from "@kw/lib/kanbanUi";
import {
  buildCalendarQuery,
  calendarDays,
  calendarFieldOptions,
  calendarLegend,
  discoverDateFields,
  fetchCalendarRows,
  formatDayKey,
  groupCalendarRows,
  pickCalendarField,
  type CalendarColorMode,
  type CalendarEntry,
  type CalendarLayout,
} from "@kw/lib/calendarView";
import { Badge } from "@kw/components/ui/badge";
import { Button } from "@kw/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@kw/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@kw/components/ui/select";

type Props = {
  onClose: () => void;
  onNavigate: (path: string) => void;
  /** Show a week list instead of the month grid (small screens). */
  compact?: boolean;
  /** Date the view opens on; defaults to today. */
  initialDate?: Date;
};

const FIELD_STORAGE_KEY = "kiwifs-calendar-field";
const COLOR_STORAGE_KEY = "kiwifs-calendar-color";
const META_SAMPLE_SIZE = 500;
const MAX_CELL_ENTRIES = 3;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

function readColorMode(): CalendarColorMode {
  const v = readStored(COLOR_STORAGE_KEY);
  return v === "state" || v === "none" ? v : "tag";
}

function entryStyle(entry: CalendarEntry) {
  if (!entry.colorKey) return undefined;
  const c = tagColor(entry.colorKey);
  return { backgroundColor: c.bg, color: c.fg };
}

export function KiwiCalendar({ onClose, onNavigate, compact = false, initialDate }: Props) {
  const layout: CalendarLayout = compact ? "week" : "month";
  const [anchor, setAnchor] = useState(() => initialDate ?? new Date());
  const [storedField] = useState(() => readStored(FIELD_STORAGE_KEY));
  const [discovered, setDiscovered] = useState<string[]>([]);
  const [field, setField] = useState(() => pickCalendarField([], storedField));
  // A field picked while discovery is in flight must not be overridden by it.
  const fieldPicked = useRef(false);
  const [colorMode, setColorMode] = useState<CalendarColorMode>(readColorMode);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .meta({ limit: META_SAMPLE_SIZE })
      .then((res) => {
        if (cancelled) return;
        const fields = discoverDateFields(res.results ?? []);
        setDiscovered(fields);
        if (!fieldPicked.current) setField(pickCalendarField(fields, storedField));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [storedField]);

  const days = useMemo(() => calendarDays(anchor, layout), [anchor, layout]);
  const first = days[0];
  const last = days[days.length - 1];
  const rangeKey = `${formatDayKey(first)}..${formatDayKey(last)}`;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchCalendarRows(
      (dql, opts) => api.query(dql, opts),
      buildCalendarQuery(field, first, last),
    )
      .then((res) => {
        if (cancelled) return;
        setRows(res.rows);
        setTruncated(res.truncated);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setRows([]);
        setTruncated(false);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // rangeKey stands in for first/last, which are new Date objects each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, rangeKey]);

  const byDay = useMemo(() => groupCalendarRows(rows, field, colorMode), [rows, field, colorMode]);
  const legend = useMemo(() => calendarLegend(byDay), [byDay]);
  const total = useMemo(() => {
    let n = 0;
    for (const list of byDay.values()) n += list.length;
    return n;
  }, [byDay]);

  const step = (dir: 1 | -1) => {
    setOpenDay(null);
    setAnchor((a) => (layout === "week" ? addWeeks(a, dir) : addMonths(a, dir)));
  };

  const changeField = (next: string) => {
    fieldPicked.current = true;
    setField(next);
    writeStored(FIELD_STORAGE_KEY, next);
  };

  const changeColorMode = (next: CalendarColorMode) => {
    setColorMode(next);
    writeStored(COLOR_STORAGE_KEY, next);
  };

  const open = (path: string) => {
    setOpenDay(null);
    onNavigate(path);
  };

  const heading =
    layout === "week"
      ? `${format(first, "MMM d")} – ${format(last, "MMM d, yyyy")}`
      : format(anchor, "MMMM yyyy");

  return (
    <div className="h-full flex flex-col">
      <div className="flex flex-wrap items-center gap-2 px-3 sm:px-6 py-3 border-b border-border bg-card">
        <Button variant="outline" size="sm" onClick={onClose}>
          <ArrowLeft className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Back</span>
        </Button>
        <div className="font-semibold text-sm">Calendar</div>
        <div className="text-xs text-muted-foreground hidden sm:block">
          {total} page{total !== 1 ? "s" : ""}
        </div>

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <Select value={field} onValueChange={changeField}>
            <SelectTrigger className="h-8 w-36 text-sm" aria-label="Date field">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {calendarFieldOptions(discovered, field).map((f) => (
                <SelectItem key={f} value={f}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={colorMode} onValueChange={(v) => changeColorMode(v as CalendarColorMode)}>
            <SelectTrigger className="h-8 w-36 text-sm" aria-label="Color by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tag">Color by tag</SelectItem>
              <SelectItem value="state">Color by state</SelectItem>
              <SelectItem value="none">No color</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              aria-label={layout === "week" ? "Previous week" : "Previous month"}
              onClick={() => step(-1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setOpenDay(null);
                setAnchor(new Date());
              }}
            >
              Today
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              aria-label={layout === "week" ? "Next week" : "Next month"}
              onClick={() => step(1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <MonthPicker
            anchor={anchor}
            label={heading}
            onPick={(d) => {
              setOpenDay(null);
              setAnchor(d);
            }}
          />
        </div>
      </div>

      {(legend.length > 0 || truncated) && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 sm:px-6 py-2 border-b border-border text-xs">
          {legend.map((key) => {
            const c = tagColor(key);
            return (
              <span
                key={key}
                className="rounded px-1.5 py-0.5 font-medium"
                style={{ backgroundColor: c.bg, color: c.fg }}
              >
                {key}
              </span>
            );
          })}
          {truncated && (
            <span className="text-muted-foreground ml-auto">
              Showing the first {rows.length} pages in this range.
            </span>
          )}
        </div>
      )}

      <div className="flex-1 overflow-auto kiwi-scroll relative">
        {error ? (
          <div className="flex items-center justify-center h-64 px-6 text-center text-sm text-destructive">
            Could not load the calendar: {error}
          </div>
        ) : (
          <>
            {loading && (
              <div className="absolute right-3 top-3 z-10 text-muted-foreground" aria-label="Loading">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            )}
            {layout === "week" ? (
              <WeekList days={days} byDay={byDay} onOpen={open} />
            ) : (
              <MonthGrid
                days={days}
                anchor={anchor}
                byDay={byDay}
                openDay={openDay}
                onOpenDay={setOpenDay}
                onOpen={open}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function MonthPicker({
  anchor,
  label,
  onPick,
}: {
  anchor: Date;
  label: string;
  onPick: (d: Date) => void;
}) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(anchor.getFullYear());

  useEffect(() => {
    if (open) setYear(anchor.getFullYear());
  }, [open, anchor]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="font-semibold">
          <CalendarDays className="h-3.5 w-3.5" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3">
        <div className="flex items-center justify-between mb-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Previous year"
            onClick={() => setYear((y) => y - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold">{year}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Next year"
            onClick={() => setYear((y) => y + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-1">
          {MONTHS.map((m, i) => {
            const active = anchor.getFullYear() === year && anchor.getMonth() === i;
            return (
              <Button
                key={m}
                variant={active ? "default" : "ghost"}
                size="sm"
                onClick={() => {
                  onPick(new Date(year, i, 1));
                  setOpen(false);
                }}
              >
                {m}
              </Button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function EntryButton({
  entry,
  onOpen,
  className,
}: {
  entry: CalendarEntry;
  onOpen: (path: string) => void;
  className?: string;
}) {
  const style = entryStyle(entry);
  return (
    <button
      type="button"
      title={entry.path}
      className={cn(
        "w-full truncate rounded px-1.5 py-0.5 text-left text-xs hover:opacity-80",
        !style && "bg-muted text-foreground",
        className,
      )}
      style={style}
      onClick={() => onOpen(entry.path)}
    >
      {entry.title}
    </button>
  );
}

function MonthGrid({
  days,
  anchor,
  byDay,
  openDay,
  onOpenDay,
  onOpen,
}: {
  days: Date[];
  anchor: Date;
  byDay: Map<string, CalendarEntry[]>;
  openDay: string | null;
  onOpenDay: (day: string | null) => void;
  onOpen: (path: string) => void;
}) {
  return (
    <div className="min-w-[640px] h-full flex flex-col p-3 sm:p-4">
      <div className="grid grid-cols-7 border-b border-border">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1.5 text-center text-xs font-medium text-muted-foreground">
            {d}
          </div>
        ))}
      </div>
      <div
        className="grid grid-cols-7 flex-1 border-l border-border"
        style={{ gridAutoRows: "minmax(6.5rem, 1fr)" }}
      >
        {days.map((day) => {
          const key = formatDayKey(day);
          const entries = byDay.get(key) ?? [];
          const hidden = entries.length - MAX_CELL_ENTRIES;
          const inMonth = isSameMonth(day, anchor);
          return (
            <Popover
              key={key}
              open={openDay === key}
              onOpenChange={(o) => onOpenDay(o ? key : null)}
            >
              <PopoverAnchor asChild>
                <div
                  data-day={key}
                  className={cn(
                    "flex min-w-0 flex-col gap-0.5 border-b border-r border-border p-1",
                    !inMonth && "bg-muted/40",
                  )}
                >
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label={`${format(day, "EEEE, MMMM d")}: ${entries.length} page${entries.length !== 1 ? "s" : ""}`}
                      className={cn(
                        "self-end grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs hover:bg-accent",
                        !inMonth && "text-muted-foreground",
                        isToday(day) && "bg-primary text-primary-foreground hover:bg-primary/90",
                      )}
                    >
                      {format(day, "d")}
                    </button>
                  </PopoverTrigger>
                  {entries.slice(0, MAX_CELL_ENTRIES).map((e) => (
                    <EntryButton key={e.path} entry={e} onOpen={onOpen} />
                  ))}
                  {hidden > 0 && (
                    <button
                      type="button"
                      className="self-start rounded px-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                      onClick={() => onOpenDay(key)}
                    >
                      +{hidden} more
                    </button>
                  )}
                </div>
              </PopoverAnchor>
              <PopoverContent align="start" className="w-72 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold">{format(day, "EEEE, MMMM d")}</span>
                  <Badge variant="secondary">{entries.length}</Badge>
                </div>
                {entries.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No pages on this day.</div>
                ) : (
                  <div className="flex max-h-72 flex-col gap-1 overflow-auto kiwi-scroll">
                    {entries.map((e) => (
                      <EntryButton key={e.path} entry={e} onOpen={onOpen} className="py-1 text-sm" />
                    ))}
                  </div>
                )}
              </PopoverContent>
            </Popover>
          );
        })}
      </div>
    </div>
  );
}

function WeekList({
  days,
  byDay,
  onOpen,
}: {
  days: Date[];
  byDay: Map<string, CalendarEntry[]>;
  onOpen: (path: string) => void;
}) {
  return (
    <div className="divide-y divide-border">
      {days.map((day) => {
        const key = formatDayKey(day);
        const entries = byDay.get(key) ?? [];
        return (
          <div key={key} data-day={key} className="flex gap-3 px-3 py-2">
            <div
              className={cn(
                "w-12 shrink-0 text-center",
                isToday(day) ? "text-primary font-semibold" : "text-muted-foreground",
              )}
            >
              <div className="text-[11px] uppercase">{format(day, "EEE")}</div>
              <div className="text-lg leading-tight">{format(day, "d")}</div>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1 py-0.5">
              {entries.length === 0 ? (
                <span className="text-xs text-muted-foreground/70">—</span>
              ) : (
                entries.map((e) => (
                  <EntryButton key={e.path} entry={e} onOpen={onOpen} className="py-1 text-sm" />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
