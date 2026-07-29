import { useMemo } from "react";

export interface ActivityGridProps {
  /** Map of ISO date (`YYYY-MM-DD`) to a numeric value for that day. */
  data: Record<string, number>;
  /** Last day rendered. ISO date. Default: today. */
  endDate?: string;
  /** First day rendered. ISO date. Takes precedence over `weeks`. */
  startDate?: string;
  /** Number of week columns when `startDate` is omitted. Default 53. */
  weeks?: number;
  /** Weekday a column starts on: 0 = Sunday (default), 1 = Monday. */
  startDay?: number;
  /** Ascending value thresholds for intensity levels 1..4. Derived from the data when omitted. */
  levels?: number[];
  /** Base color for filled cells. Intensity is applied as opacity. */
  color?: string;
  /** Explicit ramp of 5 colors, index 0 = empty day. Overrides `color`. */
  colors?: string[];
  cellSize?: number;
  cellGap?: number;
  showWeekdayLabels?: boolean;
  showMonthLabels?: boolean;
  showLegend?: boolean;
  /** Builds the hover text for a day. Default: `"<value> on <date>"`. */
  tooltip?: (date: string, value: number) => string;
  onDayClick?: (date: string, value: number) => void;
  /** ISO date drawn with a selection ring. */
  selectedDate?: string;
  /** Text shown beside the legend, e.g. `"142 problems in the last year"`. */
  summary?: string;
}

const DEFAULTS = {
  color: "var(--kw-widget-highlight, #22c55e)",
  empty: "var(--kw-widget-border, #3f3f46)",
  dim: "var(--kw-widget-dim, #94a3b8)",
  text: "var(--kw-widget-text, #e5e7eb)",
  cellSize: 12,
  cellGap: 3,
  weeks: 53,
};

const LEVEL_OPACITY = [0.35, 0.3, 0.5, 0.72, 1];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parseISO(s: string): Date | null {
  const parts = s.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function toISO(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  copy.setDate(copy.getDate() + n);
  return copy;
}

/** Days from the start of the column-week containing `d`. */
function weekOffset(d: Date, startDay: number): number {
  return (d.getDay() - startDay + 7) % 7;
}

function deriveLevels(max: number): number[] {
  if (max <= 4) return [1, 2, 3, 4];
  return [1, Math.ceil(max * 0.25), Math.ceil(max * 0.5), Math.ceil(max * 0.75)];
}

function levelOf(value: number, thresholds: number[]): number {
  if (!(value > 0)) return 0;
  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (value >= thresholds[i]) return i + 1;
  }
  return 1;
}

interface Day {
  date: string;
  value: number;
  level: number;
}

export function ActivityGrid({
  data,
  endDate,
  startDate,
  weeks = DEFAULTS.weeks,
  startDay = 0,
  levels,
  color = DEFAULTS.color,
  colors,
  cellSize = DEFAULTS.cellSize,
  cellGap = DEFAULTS.cellGap,
  showWeekdayLabels = true,
  showMonthLabels = true,
  showLegend = true,
  tooltip,
  onDayClick,
  selectedDate,
  summary,
}: ActivityGridProps) {
  const grid = useMemo(() => {
    const today = new Date();
    const end = (endDate && parseISO(endDate)) || new Date(today.getFullYear(), today.getMonth(), today.getDate());
    // Pad the final column out to a full week so rows stay aligned.
    const gridEnd = addDays(end, 6 - weekOffset(end, startDay));

    const explicitStart = startDate ? parseISO(startDate) : null;
    const start = explicitStart
      ? addDays(explicitStart, -weekOffset(explicitStart, startDay))
      : addDays(gridEnd, -(Math.max(1, weeks) * 7 - 1));

    const max = Object.values(data).reduce((m, v) => (v > m ? v : m), 0);
    const thresholds = levels && levels.length === 4 ? levels : deriveLevels(max);

    const columns: (Day | null)[][] = [];
    let cursor = start;
    while (cursor <= gridEnd) {
      const column: (Day | null)[] = [];
      for (let row = 0; row < 7; row++) {
        if (cursor > end) {
          column.push(null);
        } else {
          const date = toISO(cursor);
          const value = data[date] ?? 0;
          column.push({ date, value, level: levelOf(value, thresholds) });
        }
        cursor = addDays(cursor, 1);
      }
      columns.push(column);
    }

    return { columns };
  }, [data, endDate, startDate, weeks, startDay, levels]);

  const ramp = useMemo(() => {
    if (colors && colors.length >= 5) return colors.slice(0, 5);
    return null;
  }, [colors]);

  const cellStyle = (level: number): { background: string; opacity: number } => {
    if (ramp) return { background: ramp[level], opacity: 1 };
    return {
      background: level === 0 ? DEFAULTS.empty : color,
      opacity: LEVEL_OPACITY[level],
    };
  };

  const monthLabels = useMemo(() => {
    const labels: { col: number; label: string }[] = [];
    let lastMonth = -1;
    grid.columns.forEach((column, col) => {
      const first = column.find((d) => d !== null);
      if (!first) return;
      const month = parseISO(first.date)!.getMonth();
      if (month !== lastMonth) {
        // Skip a label that would collide with the previous one.
        if (labels.length === 0 || col - labels[labels.length - 1].col >= 3) {
          labels.push({ col, label: MONTH_NAMES[month] });
        }
        lastMonth = month;
      }
    });
    return labels;
  }, [grid.columns]);

  const step = cellSize + cellGap;
  const gutter = showWeekdayLabels ? 30 : 0;
  const labelColor = DEFAULTS.dim;

  return (
    <div style={{ fontSize: "0.75rem", color: DEFAULTS.text }}>
      <div style={{ overflowX: "auto", paddingBottom: 4 }}>
        <div style={{ display: "inline-block", minWidth: gutter + grid.columns.length * step }}>
          {showMonthLabels && (
            <div style={{ position: "relative", height: 14, marginLeft: gutter }}>
              {monthLabels.map(({ col, label }) => (
                <span
                  key={`${label}-${col}`}
                  style={{
                    position: "absolute",
                    left: col * step,
                    fontSize: "0.65rem",
                    color: labelColor,
                    whiteSpace: "nowrap",
                  }}
                >
                  {label}
                </span>
              ))}
            </div>
          )}

          <div style={{ display: "flex" }}>
            {showWeekdayLabels && (
              <div style={{ width: gutter, display: "flex", flexDirection: "column", gap: cellGap, flexShrink: 0 }}>
                {Array.from({ length: 7 }, (_, row) => (
                  <div
                    key={row}
                    style={{
                      height: cellSize,
                      lineHeight: `${cellSize}px`,
                      fontSize: "0.6rem",
                      color: labelColor,
                    }}
                  >
                    {row % 2 === 1 ? WEEKDAY_NAMES[(row + startDay) % 7] : ""}
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: cellGap }}>
              {grid.columns.map((column, col) => (
                <div key={col} style={{ display: "flex", flexDirection: "column", gap: cellGap }}>
                  {column.map((day, row) => {
                    if (!day) {
                      return <div key={row} style={{ width: cellSize, height: cellSize }} />;
                    }
                    const { background, opacity } = cellStyle(day.level);
                    const isSelected = selectedDate === day.date;
                    const label = tooltip
                      ? tooltip(day.date, day.value)
                      : `${day.value} on ${day.date}`;
                    return (
                      <div
                        key={row}
                        title={label}
                        aria-label={label}
                        role={onDayClick ? "button" : undefined}
                        tabIndex={onDayClick ? 0 : undefined}
                        onClick={onDayClick ? () => onDayClick(day.date, day.value) : undefined}
                        onKeyDown={
                          onDayClick
                            ? (e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  onDayClick(day.date, day.value);
                                }
                              }
                            : undefined
                        }
                        style={{
                          width: cellSize,
                          height: cellSize,
                          borderRadius: Math.max(2, Math.round(cellSize * 0.2)),
                          background,
                          opacity,
                          cursor: onDayClick ? "pointer" : "default",
                          outline: isSelected ? `1.5px solid ${DEFAULTS.text}` : undefined,
                          outlineOffset: 1,
                        }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {showLegend && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 6,
            marginLeft: gutter,
            fontSize: "0.65rem",
            color: labelColor,
          }}
        >
          {summary && <span style={{ marginRight: "auto" }}>{summary}</span>}
          <span>Less</span>
          <div style={{ display: "flex", gap: cellGap }}>
            {[0, 1, 2, 3, 4].map((level) => {
              const { background, opacity } = cellStyle(level);
              return (
                <div
                  key={level}
                  style={{
                    width: cellSize,
                    height: cellSize,
                    borderRadius: Math.max(2, Math.round(cellSize * 0.2)),
                    background,
                    opacity,
                  }}
                />
              );
            })}
          </div>
          <span>More</span>
        </div>
      )}
    </div>
  );
}
