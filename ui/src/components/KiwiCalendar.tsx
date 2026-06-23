// KiwiCalendar — Monthly grid of pages keyed by frontmatter date fields.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addMonths,
  format,
  startOfMonth,
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
import {
  buildDateRangeQuery,
  buildMonthQuery,
  DEFAULT_DATE_FIELD,
  discoverDateFields,
  dotColorForEntry,
  groupEntriesByDate,
  MONTH_NAMES,
  monthGridCells,
  dateKey,
  todayKey,
  type CalendarPageEntry,
  WEEKDAY_LABELS,
  weekDates,
  weekRange,
  weekStartFromDate,
  parseCalendarRows,
} from "@kw/lib/kiwiCalendar";
import { titleize } from "@kw/lib/paths";
import { Button } from "@kw/components/ui/button";
import { Badge } from "@kw/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@kw/components/ui/card";
import {
  Popover,
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
  isMobile?: boolean;
};

const MAX_VISIBLE_DOTS = 3;

function DayDetailList({
  entries,
  onNavigate,
}: {
  entries: CalendarPageEntry[];
  onNavigate: (path: string) => void;
}) {
  return (
    <div className="space-y-2 max-h-72 overflow-auto kiwi-scroll">
      {entries.map((entry) => (
        <Card key={entry.path} className="shadow-none">
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-sm font-medium leading-snug">
              <button
                type="button"
                className="text-left hover:underline w-full"
                onClick={() => onNavigate(entry.path)}
              >
                {entry.title || titleize(entry.path)}
              </button>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground truncate">{entry.path}</span>
            {(entry.status || entry.state) && (
              <Badge variant="outline" className="text-[10px] capitalize">
                {entry.status ?? entry.state}
              </Badge>
            )}
            <span
              className={cn("h-2 w-2 rounded-full shrink-0", dotColorForEntry(entry))}
              aria-hidden
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function DayCell({
  dateStr,
  entries,
  isToday,
  onNavigate,
}: {
  dateStr: string;
  entries: CalendarPageEntry[];
  isToday: boolean;
  onNavigate: (path: string) => void;
}) {
  const count = entries.length;
  const visible = entries.slice(0, MAX_VISIBLE_DOTS);
  const overflow = count - visible.length;

  if (count === 0) {
    return (
      <div
        className={cn(
          "min-h-[4.5rem] rounded-md border border-transparent p-1 text-center text-xs text-muted-foreground",
          isToday && "ring-1 ring-primary/60 bg-accent/20",
        )}
      >
        {Number(dateStr.slice(-2))}
      </div>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "min-h-[4.5rem] w-full rounded-md border border-border/60 p-1 text-left text-xs transition-colors hover:bg-accent/40",
            isToday && "ring-1 ring-primary bg-primary/5",
          )}
          aria-label={`${count} page${count === 1 ? "" : "s"} on ${dateStr}`}
        >
          <div className="flex items-center justify-between gap-1">
            <span className="font-medium">{Number(dateStr.slice(-2))}</span>
            {overflow > 0 && (
              <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                +{overflow}
              </Badge>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-0.5">
            {visible.map((entry) => (
              <span
                key={entry.path}
                className={cn("h-1.5 w-1.5 rounded-full", dotColorForEntry(entry))}
                title={entry.title || entry.path}
              />
            ))}
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" align="start">
        <div className="mb-2 text-xs font-medium text-muted-foreground">{dateStr}</div>
        <DayDetailList
          entries={entries}
          onNavigate={(path) => {
            onNavigate(path);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export function KiwiCalendar({ onClose, onNavigate, isMobile = false }: Props) {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [dateField, setDateField] = useState(DEFAULT_DATE_FIELD);
  const [dateFields, setDateFields] = useState<string[]>([DEFAULT_DATE_FIELD]);
  const [entries, setEntries] = useState<CalendarPageEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekAnchor, setWeekAnchor] = useState(() =>
    weekStartFromDate(
      new Date().getFullYear(),
      new Date().getMonth() + 1,
      new Date().getDate(),
    ),
  );

  const year = cursor.getFullYear();
  const month = cursor.getMonth() + 1;
  const byDate = useMemo(() => groupEntriesByDate(entries), [entries]);
  const today = todayKey();

  useEffect(() => {
    api
      .meta({ limit: 500 })
      .then((res) => {
        const samples = (res.results ?? []).map((r) => r.frontmatter ?? {});
        const fields = discoverDateFields(samples);
        setDateFields(fields);
        setDateField((prev) => (fields.includes(prev) ? prev : fields[0] ?? DEFAULT_DATE_FIELD));
      })
      .catch(() => {
        setDateFields([DEFAULT_DATE_FIELD]);
      });
  }, []);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const dql = isMobile
        ? (() => {
            const { start, endExclusive } = weekRange(weekAnchor);
            return buildDateRangeQuery(dateField, start, endExclusive);
          })()
        : buildMonthQuery(dateField, year, month);
      const data = await api.query(dql, { limit: 200 });
      setEntries(parseCalendarRows(data, dateField));
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [dateField, isMobile, weekAnchor, year, month]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const goToday = () => {
    const now = new Date();
    setCursor(startOfMonth(now));
    setWeekAnchor(
      weekStartFromDate(now.getFullYear(), now.getMonth() + 1, now.getDate()),
    );
  };

  const monthCells = monthGridCells(year, month);
  const weekDays = weekDates(weekAnchor);

  return (
    <div className="h-full flex flex-col">
      <div className="flex flex-wrap items-center gap-2 px-3 sm:px-6 py-3 border-b border-border bg-card">
        <Button variant="outline" size="sm" onClick={onClose}>
          <ArrowLeft className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Back</span>
        </Button>
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <div className="font-semibold text-sm">Calendar</div>
        </div>
        <div className="text-xs text-muted-foreground hidden sm:block">
          {entries.length} page{entries.length === 1 ? "" : "s"}{" "}
          {isMobile ? "this week" : "this month"}
        </div>

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <Select value={dateField} onValueChange={setDateField}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue placeholder="Date field" />
            </SelectTrigger>
            <SelectContent>
              {dateFields.map((field) => (
                <SelectItem key={field} value={field}>
                  {field}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              aria-label={isMobile ? "Previous week" : "Previous month"}
              onClick={() => {
                if (isMobile) {
                  const next = new Date(weekAnchor);
                  next.setDate(next.getDate() - 7);
                  setWeekAnchor(next);
                  setCursor(startOfMonth(next));
                  return;
                }
                setCursor((c) => addMonths(c, -1));
              }}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={goToday}>
              Today
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              aria-label={isMobile ? "Next week" : "Next month"}
              onClick={() => {
                if (isMobile) {
                  const next = new Date(weekAnchor);
                  next.setDate(next.getDate() + 7);
                  setWeekAnchor(next);
                  setCursor(startOfMonth(next));
                  return;
                }
                setCursor((c) => addMonths(c, 1));
              }}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <Select
            value={`${year}-${String(month).padStart(2, "0")}`}
            onValueChange={(value) => {
              const [y, m] = value.split("-").map(Number);
              if (!y || !m) return;
              setCursor(new Date(y, m - 1, 1));
            }}
          >
            <SelectTrigger className="h-8 w-40 text-xs hidden sm:flex">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 24 }, (_, i) => {
                const d = addMonths(startOfMonth(new Date()), i - 12);
                const y = d.getFullYear();
                const m = d.getMonth() + 1;
                const key = `${y}-${String(m).padStart(2, "0")}`;
                return (
                  <SelectItem key={key} value={key}>
                    {MONTH_NAMES[m - 1]} {y}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex-1 overflow-auto kiwi-scroll p-4">
        {loading ? (
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading...
          </div>
        ) : isMobile ? (
          <div>
            <div className="mb-3 text-sm font-semibold">
              Week of {format(weekAnchor, "MMM d, yyyy")}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {WEEKDAY_LABELS.map((label) => (
                <div
                  key={label}
                  className="text-center text-[10px] font-medium text-muted-foreground py-1"
                >
                  {label}
                </div>
              ))}
              {weekDays.map(({ year: y, month: mo, day }) => {
                const key = dateKey(y, mo, day);
                return (
                  <DayCell
                    key={key}
                    dateStr={key}
                    entries={byDate.get(key) ?? []}
                    isToday={key === today}
                    onNavigate={onNavigate}
                  />
                );
              })}
            </div>
          </div>
        ) : (
          <div className="max-w-5xl mx-auto">
            <div className="mb-3 text-base font-semibold">
              {MONTH_NAMES[month - 1]} {year}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {WEEKDAY_LABELS.map((label) => (
                <div
                  key={label}
                  className="text-center text-xs font-medium text-muted-foreground py-1"
                >
                  {label}
                </div>
              ))}
              {monthCells.map((day, idx) => {
                if (day == null) {
                  return <div key={`empty-${idx}`} className="min-h-[4.5rem]" />;
                }
                const key = dateKey(year, month, day);
                return (
                  <DayCell
                    key={key}
                    dateStr={key}
                    entries={byDate.get(key) ?? []}
                    isToday={key === today}
                    onNavigate={onNavigate}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
