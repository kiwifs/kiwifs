import { describe, expect, it } from "vitest";
import {
  buildDateRangeQuery,
  buildMonthQuery,
  dateKey,
  discoverDateFields,
  dotColorForEntry,
  groupEntriesByDate,
  monthGridCells,
  monthRange,
  normalizeDateValue,
  parseCalendarRows,
  weekDates,
  weekRange,
  weekStartFromDate,
  addDaysToDateKey,
} from "./kiwiCalendar";

describe("kiwiCalendar", () => {
  it("normalizes ISO date strings", () => {
    expect(normalizeDateValue("2026-06-20T14:30:00Z")).toBe("2026-06-20");
    expect(normalizeDateValue("bad")).toBeNull();
  });

  it("builds month range DQL with escaped field names", () => {
    expect(buildMonthQuery("date", 2026, 6)).toContain(
      'date >= DATE("2026-06-01") AND date < DATE("2026-07-01")',
    );
    expect(buildMonthQuery("last-reviewed", 2026, 12)).toContain(
      "`last-reviewed` >= DATE(\"2026-12-01\")",
    );
  });

  it("builds arbitrary date-range DQL", () => {
    expect(buildDateRangeQuery("due", "2026-06-29", "2026-07-06")).toContain(
      'due >= DATE("2026-06-29") AND due < DATE("2026-07-06")',
    );
  });

  it("computes month boundaries including year rollover", () => {
    expect(monthRange(2026, 12)).toEqual({
      start: "2026-12-01",
      endExclusive: "2027-01-01",
    });
  });

  it("discovers date fields with date first when present", () => {
    expect(
      discoverDateFields([
        { due: "2026-06-01", title: "Task" },
        { created: "2025-01-01", date: "2026-06-15" },
      ]),
    ).toEqual(["date", "due", "created"]);
  });

  it("falls back to date when no samples", () => {
    expect(discoverDateFields([])).toEqual(["date"]);
  });

  it("parses query rows into calendar entries", () => {
    const entries = parseCalendarRows(
      {
        columns: ["_path", "title", "status", "date"],
        rows: [
          { _path: "a.md", title: "A", status: "accepted", date: "2026-06-03" },
          { _path: "b.md", title: "B", status: "proposed", date: "2026-06-03T10:00:00Z" },
          { _path: "c.md", title: "C", status: "draft", date: "not-a-date" },
        ],
        total: 3,
        has_more: false,
      },
      "date",
    );
    expect(entries).toHaveLength(2);
    expect(groupEntriesByDate(entries).get("2026-06-03")).toHaveLength(2);
  });

  it("maps workflow status to dot colors", () => {
    expect(dotColorForEntry({ path: "a.md", date: "2026-06-01", status: "accepted" })).toContain(
      "emerald",
    );
    expect(dotColorForEntry({ path: "b.md", date: "2026-06-01", status: "proposed" })).toContain(
      "amber",
    );
  });

  it("builds Monday-first month grids", () => {
    // June 2026 starts on Monday
    const cells = monthGridCells(2026, 6);
    expect(cells[0]).toBe(1);
    expect(cells.filter(Boolean)).toHaveLength(30);
  });

  it("formats stable date keys", () => {
    expect(dateKey(2026, 6, 5)).toBe("2026-06-05");
  });

  it("lists seven days from week start", () => {
    const start = weekStartFromDate(2026, 6, 18); // Thu -> Mon 15
    const week = weekDates(start);
    expect(week).toHaveLength(7);
    expect(week[0]).toEqual({ year: 2026, month: 6, day: 15 });
    expect(week[6]).toEqual({ year: 2026, month: 6, day: 21 });
  });

  it("computes week range spanning month boundaries", () => {
    const start = weekStartFromDate(2026, 7, 1); // Wed Jul 1 -> Mon Jun 29
    expect(weekRange(start)).toEqual({
      start: "2026-06-29",
      endExclusive: "2026-07-06",
    });
    expect(addDaysToDateKey("2026-06-30", 1)).toBe("2026-07-01");
  });
});
