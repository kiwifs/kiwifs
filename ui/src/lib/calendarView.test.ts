import { describe, expect, it, vi } from "vitest";
import type { QueryResponse } from "./api";
import {
  buildCalendarQuery,
  calendarDayKey,
  calendarDays,
  calendarFieldOptions,
  calendarLegend,
  CALENDAR_MAX_ROWS,
  CALENDAR_PAGE_SIZE,
  discoverDateFields,
  entryColorKey,
  fetchCalendarRows,
  formatDayKey,
  groupCalendarRows,
  isCalendarField,
  parseTags,
  pickCalendarField,
} from "./calendarView";

describe("calendarDayKey", () => {
  it("takes the day from dates and datetimes", () => {
    expect(calendarDayKey("2026-06-05")).toBe("2026-06-05");
    expect(calendarDayKey("2026-06-30T23:00:00Z")).toBe("2026-06-30");
    expect(calendarDayKey("2026-06-30 08:15")).toBe("2026-06-30");
    expect(calendarDayKey(" 2026-06-05 ")).toBe("2026-06-05");
  });

  it("rejects values that are not ISO dates", () => {
    expect(calendarDayKey("TBD")).toBeNull();
    expect(calendarDayKey("2026-06")).toBeNull();
    expect(calendarDayKey("2026-06-051")).toBeNull();
    expect(calendarDayKey("June 5, 2026")).toBeNull();
    expect(calendarDayKey(20260605)).toBeNull();
    expect(calendarDayKey(null)).toBeNull();
  });
});

describe("calendarDays", () => {
  it("pads a month to whole Monday-first weeks", () => {
    // June 2026 starts on a Monday and ends on a Tuesday.
    const days = calendarDays(new Date(2026, 5, 17), "month");
    expect(formatDayKey(days[0])).toBe("2026-06-01");
    expect(formatDayKey(days[days.length - 1])).toBe("2026-07-05");
    expect(days.length % 7).toBe(0);
  });

  it("includes the trailing days of the previous month", () => {
    const days = calendarDays(new Date(2026, 6, 1), "month");
    expect(formatDayKey(days[0])).toBe("2026-06-29");
    expect(formatDayKey(days[days.length - 1])).toBe("2026-08-02");
  });

  it("returns the seven days of the anchor's week", () => {
    const days = calendarDays(new Date(2026, 5, 21), "week");
    expect(days.map(formatDayKey)).toEqual([
      "2026-06-15",
      "2026-06-16",
      "2026-06-17",
      "2026-06-18",
      "2026-06-19",
      "2026-06-20",
      "2026-06-21",
    ]);
  });
});

describe("buildCalendarQuery", () => {
  it("bounds the range with an exclusive next-day upper limit", () => {
    expect(buildCalendarQuery("due", new Date(2026, 5, 1), new Date(2026, 6, 5))).toBe(
      'TABLE title, tags, state, status, due WHERE due >= DATE("2026-06-01") AND due < DATE("2026-07-06") SORT due ASC',
    );
  });

  it("does not repeat a column already selected", () => {
    expect(buildCalendarQuery("status", new Date(2026, 0, 1), new Date(2026, 0, 31))).toMatch(
      /^TABLE title, tags, state, status WHERE/,
    );
  });

  it("refuses field names that would not parse as identifiers", () => {
    const d = new Date(2026, 0, 1);
    expect(() => buildCalendarQuery("due-date", d, d)).toThrow(/invalid date field/);
    expect(() => buildCalendarQuery('date") OR (1', d, d)).toThrow(/invalid date field/);
    expect(isCalendarField("last_executed")).toBe(true);
    expect(isCalendarField("2nd")).toBe(false);
  });
});

describe("parseTags", () => {
  it("accepts arrays, JSON-encoded arrays and comma lists", () => {
    expect(parseTags(["ops", " release "])).toEqual(["ops", "release"]);
    expect(parseTags('["ops","release"]')).toEqual(["ops", "release"]);
    expect(parseTags("ops, #release")).toEqual(["ops", "release"]);
    expect(parseTags("[ops, release]")).toEqual(["ops", "release"]);
    expect(parseTags(null)).toEqual([]);
    expect(parseTags("")).toEqual([]);
  });
});

describe("entryColorKey", () => {
  it("colors by the first tag", () => {
    expect(entryColorKey({ tags: '["adr","infra"]' }, "tag")).toBe("adr");
    expect(entryColorKey({ tags: null }, "tag")).toBeNull();
  });

  it("colors by workflow state, falling back to status", () => {
    expect(entryColorKey({ state: "accepted", status: "draft" }, "state")).toBe("accepted");
    expect(entryColorKey({ state: null, status: "proposed" }, "state")).toBe("proposed");
    expect(entryColorKey({ state: " ", status: null }, "state")).toBeNull();
  });

  it("leaves entries uncolored when color is off", () => {
    expect(entryColorKey({ tags: ["adr"], state: "accepted" }, "none")).toBeNull();
  });
});

describe("groupCalendarRows", () => {
  const rows = [
    { _path: "adr/001-sqlite.md", title: "Use SQLite", date: "2026-06-05", tags: '["adr"]' },
    { _path: "notes/standup.md", title: null, date: "2026-06-05T09:00:00Z", tags: null },
    { _path: "notes/later.md", title: "Later", date: "2026-06-30" },
    { _path: "notes/undated.md", title: "Undated", date: "TBD" },
    { title: "No path", date: "2026-06-05" },
  ];

  it("groups pages by day and falls back to a titleized path", () => {
    const byDay = groupCalendarRows(rows, "date", "tag");
    expect([...byDay.keys()]).toEqual(["2026-06-05", "2026-06-30"]);
    expect(byDay.get("2026-06-05")).toEqual([
      { path: "adr/001-sqlite.md", title: "Use SQLite", day: "2026-06-05", colorKey: "adr" },
      { path: "notes/standup.md", title: "Standup", day: "2026-06-05", colorKey: null },
    ]);
  });

  it("orders a day's pages by time, then title", () => {
    const byDay = groupCalendarRows(
      [
        { _path: "s10.md", title: "Standup 10", date: "2026-06-05" },
        { _path: "late.md", title: "A late call", date: "2026-06-05T17:00:00Z" },
        { _path: "s2.md", title: "Standup 2", date: "2026-06-05" },
        { _path: "early.md", title: "Z early call", date: "2026-06-05T08:00:00Z" },
      ],
      "date",
      "none",
    );
    expect(byDay.get("2026-06-05")?.map((e) => e.title)).toEqual([
      "Standup 2",
      "Standup 10",
      "Z early call",
      "A late call",
    ]);
  });

  it("builds a sorted legend of the color keys in view", () => {
    const byDay = groupCalendarRows(
      [
        { _path: "a.md", date: "2026-06-01", state: "proposed" },
        { _path: "b.md", date: "2026-06-02", state: "accepted" },
        { _path: "c.md", date: "2026-06-03", state: "accepted" },
        { _path: "d.md", date: "2026-06-04" },
      ],
      "date",
      "state",
    );
    expect(calendarLegend(byDay)).toEqual(["accepted", "proposed"]);
  });
});

describe("date field selection", () => {
  const results = [
    {
      path: "a.md",
      frontmatter: {
        title: "A",
        verified_at: "2026-01-01",
        due: "2026-06-01T10:00:00Z",
        _last_modified: "2026-06-01",
        "due-date": "2026-06-01",
        review_interval: 90,
      },
    },
    { path: "b.md", frontmatter: { date: "2026-02-02", owner: "team" } },
  ];

  it("discovers date-valued fields with common names first", () => {
    expect(discoverDateFields(results)).toEqual(["date", "due", "verified_at"]);
    expect(discoverDateFields([])).toEqual([]);
  });

  it("prefers a stored choice, then date, then the first discovered field", () => {
    expect(pickCalendarField(["date", "due"], "due")).toBe("due");
    expect(pickCalendarField(["due", "verified_at"], null)).toBe("due");
    expect(pickCalendarField(["date", "due"], null)).toBe("date");
    expect(pickCalendarField([], null)).toBe("date");
    expect(pickCalendarField(["due"], "bad-name")).toBe("due");
  });

  it("drops a stored choice this space has no pages for", () => {
    expect(pickCalendarField(["date", "verified_at"], "due")).toBe("date");
    expect(pickCalendarField([], "due")).toBe("due");
  });

  it("keeps the current field in the options even when it was not sampled", () => {
    expect(calendarFieldOptions(["due"], "date")).toEqual(["date", "due"]);
    expect(calendarFieldOptions(["date", "due"], "due")).toEqual(["date", "due"]);
  });
});

describe("fetchCalendarRows", () => {
  function page(n: number, hasMore: boolean): QueryResponse {
    const rows = Array.from({ length: n }, (_, i) => ({ _path: `p${i}.md` }));
    return { columns: ["_path"], rows, total: hasMore ? -1 : n, has_more: hasMore };
  }

  it("follows has_more across pages", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(page(CALENDAR_PAGE_SIZE, true))
      .mockResolvedValueOnce(page(3, false));
    const res = await fetchCalendarRows(query, "TABLE x");
    expect(res.rows).toHaveLength(CALENDAR_PAGE_SIZE + 3);
    expect(res.truncated).toBe(false);
    expect(query.mock.calls.map((c) => c[1])).toEqual([
      { limit: CALENDAR_PAGE_SIZE, offset: 0 },
      { limit: CALENDAR_PAGE_SIZE, offset: CALENDAR_PAGE_SIZE },
    ]);
  });

  it("stops at the row cap and reports truncation", async () => {
    const query = vi.fn().mockResolvedValue(page(CALENDAR_PAGE_SIZE, true));
    const res = await fetchCalendarRows(query, "TABLE x");
    expect(res.rows).toHaveLength(CALENDAR_MAX_ROWS);
    expect(res.truncated).toBe(true);
    expect(query).toHaveBeenCalledTimes(CALENDAR_MAX_ROWS / CALENDAR_PAGE_SIZE);
  });
});
