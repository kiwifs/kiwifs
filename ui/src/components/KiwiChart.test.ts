import { describe, expect, it } from "vitest";
import {
  ID_COLUMN,
  inferChartColumns,
  isNumericColumn,
  parseChartConfig,
  queryRowsToChartData,
} from "../lib/chartBlock";

describe("parseChartConfig", () => {
  it("keeps inline data blocks working unchanged", () => {
    const cfg = parseChartConfig(
      ["type: bar", "title: Revenue", "xKey: month", "data:", "  - month: Jan", "    revenue: 4000"].join("\n")
    );
    expect(cfg.type).toBe("bar");
    expect(cfg.title).toBe("Revenue");
    expect(cfg.xKey).toBe("month");
    expect(cfg.query).toBeUndefined();
    expect(cfg.data).toEqual([{ month: "Jan", revenue: 4000 }]);
  });

  it("reads a single-line query", () => {
    const cfg = parseChartConfig(['type: bar', 'query: TABLE title, score FROM "datasets"'].join("\n"));
    expect(cfg.query).toBe('TABLE title, score FROM "datasets"');
    expect(cfg.data).toEqual([]);
  });

  it("reads a multi-line block-scalar query verbatim", () => {
    const cfg = parseChartConfig(
      [
        "type: line",
        "query: |",
        '  TABLE title, missing-rate',
        '  FROM "datasets"',
        "  WHERE missing-rate > 0.1",
        "  SORT missing-rate DESC",
        "height: 400",
      ].join("\n")
    );
    expect(cfg.query).toBe(
      ['TABLE title, missing-rate', 'FROM "datasets"', "WHERE missing-rate > 0.1", "SORT missing-rate DESC"].join(
        "\n"
      )
    );
    // The key after the block must still be parsed — a block scalar that
    // swallows the rest of the document is the classic failure here.
    expect(cfg.height).toBe(400);
    expect(cfg.type).toBe("line");
  });

  it("folds a `>` block onto one line", () => {
    const cfg = parseChartConfig(["type: bar", "query: >", "  TABLE title", '  FROM "datasets"'].join("\n"));
    expect(cfg.query).toBe('TABLE title FROM "datasets"');
  });

  it("strips quotes from a quoted query", () => {
    const cfg = parseChartConfig(['type: bar', "query: 'TABLE title FROM \"x\"'"].join("\n"));
    expect(cfg.query).toBe('TABLE title FROM "x"');
  });

  it("reads query from JSON config", () => {
    const cfg = parseChartConfig('{"type":"pie","query":"TABLE title, n FROM \\"x\\""}');
    expect(cfg.query).toBe('TABLE title, n FROM "x"');
  });

  it("treats a blank query as absent so inline data still applies", () => {
    const cfg = parseChartConfig(["type: bar", "query:", "data:", "  - a: 1"].join("\n"));
    expect(cfg.query).toBeUndefined();
  });
});

describe("isNumericColumn", () => {
  const rows = [
    { title: "A", score: 1, rate: "0.5", mixed: 1, empty: null },
    { title: "B", score: 2, rate: "0.75", mixed: "nope", empty: null },
  ];

  it("accepts numbers and numeric strings", () => {
    expect(isNumericColumn(rows, "score")).toBe(true);
    expect(isNumericColumn(rows, "rate")).toBe(true);
  });

  it("rejects columns with any non-numeric value", () => {
    expect(isNumericColumn(rows, "title")).toBe(false);
    expect(isNumericColumn(rows, "mixed")).toBe(false);
  });

  it("rejects an all-null column rather than plotting nothing", () => {
    expect(isNumericColumn(rows, "empty")).toBe(false);
  });

  it("ignores nulls when other values are numeric", () => {
    expect(isNumericColumn([{ n: null }, { n: 3 }], "n")).toBe(true);
  });
});

describe("inferChartColumns", () => {
  it("skips the synthetic _path id in favour of a real categorical column", () => {
    const rows = [
      { _path: "datasets/a.md", title: "A", score: 3 },
      { _path: "datasets/b.md", title: "B", score: 5 },
    ];
    const { xKey, seriesKeys } = inferChartColumns(rows, [ID_COLUMN, "title", "score"]);
    expect(xKey).toBe("title");
    expect(seriesKeys).toEqual(["score"]);
  });

  it("falls back to _path when it is the only categorical column", () => {
    const rows = [
      { _path: "a.md", score: 3 },
      { _path: "b.md", score: 5 },
    ];
    expect(inferChartColumns(rows, [ID_COLUMN, "score"]).xKey).toBe(ID_COLUMN);
  });

  it("collects every remaining numeric column as a series", () => {
    const rows = [{ title: "A", wins: 1, losses: 2, rate: "0.33" }];
    const { xKey, seriesKeys } = inferChartColumns(rows, ["title", "wins", "losses", "rate"]);
    expect(xKey).toBe("title");
    expect(seriesKeys).toEqual(["wins", "losses", "rate"]);
  });

  it("derives columns from the rows when the response omits them", () => {
    expect(inferChartColumns([{ name: "A", n: 1 }]).xKey).toBe("name");
  });

  it("handles an empty result without throwing", () => {
    expect(inferChartColumns([], [])).toEqual({ xKey: undefined, seriesKeys: [] });
  });
});

describe("queryRowsToChartData", () => {
  const columns = [ID_COLUMN, "title", "score"];
  const rows = [
    { _path: "a.md", title: "Alpha", score: 3 },
    { _path: "b.md", title: "Beta", score: 5 },
  ];

  it("maps rows to series with inferred keys", () => {
    const out = queryRowsToChartData(rows, columns, {});
    expect(out.xKey).toBe("title");
    expect(out.series.map((s) => s.key)).toEqual(["score"]);
    expect(out.series[0].color).toBeTruthy();
    expect(out.data).toEqual(rows);
  });

  it("coerces numeric strings so they plot", () => {
    const out = queryRowsToChartData(
      [
        { title: "A", rate: "0.42" },
        { title: "B", rate: "1.5" },
      ],
      ["title", "rate"],
      {}
    );
    expect(out.data).toEqual([
      { title: "A", rate: 0.42 },
      { title: "B", rate: 1.5 },
    ]);
  });

  it("honours an explicit xKey and excludes it from the series", () => {
    const out = queryRowsToChartData(
      [
        { year: 2024, wins: 3 },
        { year: 2025, wins: 4 },
      ],
      ["year", "wins"],
      { xKey: "year" }
    );
    expect(out.xKey).toBe("year");
    expect(out.series.map((s) => s.key)).toEqual(["wins"]);
  });

  it("honours an explicit series list", () => {
    const out = queryRowsToChartData(rows, columns, {
      series: [{ key: "score", color: "#000000", name: "Score" }],
    });
    expect(out.series).toEqual([{ key: "score", color: "#000000", name: "Score" }]);
  });

  it("applies configured colors in order", () => {
    const out = queryRowsToChartData([{ t: "A", a: 1, b: 2 }], ["t", "a", "b"], { colors: ["#111111", "#222222"] });
    expect(out.series.map((s) => s.color)).toEqual(["#111111", "#222222"]);
  });

  it("returns an empty dataset instead of throwing on no rows", () => {
    const out = queryRowsToChartData([], columns, {});
    expect(out.data).toEqual([]);
    expect(out.series).toEqual([]);
  });

  it("preserves null cells rather than coercing them to zero", () => {
    const out = queryRowsToChartData(
      [
        { title: "A", score: null },
        { title: "B", score: 4 },
      ],
      ["title", "score"],
      {}
    );
    expect(out.data[0].score).toBeNull();
    expect(out.data[1].score).toBe(4);
  });
});
