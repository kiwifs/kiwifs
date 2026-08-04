import { useState } from "react";
import type { Matcher } from "react-day-picker";
import { Calendar } from "@kw/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@kw/components/ui/popover";

export interface DateFieldProps {
  /** Selected day as an ISO date (`YYYY-MM-DD`), or `""` when nothing is set. */
  value?: string;
  /** Called with the new ISO date, or `""` when the day is cleared. */
  onChange?: (value: string) => void;
  /** Trigger text while no day is selected. Default `"Pick a date"`. */
  placeholder?: string;
  /** Earliest selectable day. ISO date. */
  min?: string;
  /** Latest selectable day. ISO date. */
  max?: string;
  /** Weekday a week starts on: 0 = Sunday (default), 1 = Monday. */
  weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** Builds the trigger label. Default: `"Aug 4, 2026"`. */
  format?: (value: string) => string;
  /** Offer a "Clear" button inside the popover. Default false. */
  clearable?: boolean;
  disabled?: boolean;
  /** Which edge of the trigger the popover lines up with. Default `"start"`. */
  align?: "start" | "center" | "end";
  /** Accessible name for the trigger, e.g. `"Start date"`. */
  ariaLabel?: string;
}

const DEFAULTS = {
  border: "var(--kw-widget-border, #3f3f46)",
  text: "var(--kw-widget-text, #e5e7eb)",
  dim: "var(--kw-widget-dim, #94a3b8)",
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * ISO dates are parsed field by field. `new Date("2026-08-04")` is parsed as
 * UTC midnight, which lands on the previous day for anyone west of Greenwich.
 */
function parseISO(value: string): Date | undefined {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!parts) return undefined;
  const date = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function toISO(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function defaultFormat(value: string): string {
  const date = parseISO(value);
  if (!date) return value;
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/**
 * A date input backed by a calendar popover, for widgets that need a day picked
 * rather than typed. `<input type="date">` renders differently in every browser
 * and offers no control over what is selectable; this looks the same everywhere
 * and speaks ISO dates in both directions.
 */
export function DateField({
  value = "",
  onChange,
  placeholder = "Pick a date",
  min,
  max,
  weekStartsOn = 0,
  format = defaultFormat,
  clearable = false,
  disabled = false,
  align = "start",
  ariaLabel,
}: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const selected = parseISO(value);
  const lower = min ? parseISO(min) : undefined;
  const upper = max ? parseISO(max) : undefined;
  // `startMonth`/`endMonth` only bound navigation; the days themselves still
  // need excluding, or the edge months stay clickable.
  const outOfRange: Matcher[] = [];
  if (lower) outOfRange.push({ before: lower });
  if (upper) outOfRange.push({ after: upper });

  function commit(next: string) {
    setOpen(false);
    if (onChange) onChange(next);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 9px",
            borderRadius: 6,
            border: `1px solid ${DEFAULTS.border}`,
            background: "transparent",
            color: selected ? DEFAULTS.text : DEFAULTS.dim,
            font: "inherit",
            fontSize: "0.8rem",
            fontVariantNumeric: "tabular-nums",
            cursor: disabled ? "default" : "pointer",
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <span>{selected ? format(value) : placeholder}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected ?? lower}
          startMonth={lower}
          endMonth={upper}
          disabled={outOfRange}
          weekStartsOn={weekStartsOn}
          autoFocus
          onSelect={(day) => commit(day ? toISO(day) : "")}
        />
        {clearable && value && (
          <div className="border-t border-border p-2">
            <button
              type="button"
              className="w-full rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
              onClick={() => commit("")}
            >
              Clear
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
