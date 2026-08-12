import { describe, expect, it } from "vitest";
import {
  buildKanbanBlockExportText,
  parseKanbanBlockConfig,
  queryRowsToKanbanColumns,
} from "./kanbanBlock";

describe("parseKanbanBlockConfig", () => {
  it("parses JSON config", () => {
    const config = parseKanbanBlockConfig(JSON.stringify({
      title: "Sprint",
      columns: [{ name: "Now", cards: [{ id: "a", title: "Ship" }] }],
    }));

    expect(config.title).toBe("Sprint");
    expect(config.columns[0]?.cards[0]).toMatchObject({ id: "a", title: "Ship" });
  });

  it("parses YAML-like columns, card fields, tags, and export config", () => {
    const config = parseKanbanBlockConfig(`
title: "Sprint Planning"
columns:
  - name: Now
    color: "#22c55e"
    cards:
      - id: auth
        title: Fix auth token refresh
        description: Refresh before expiry
        priority: critical
        assignee: cinos
        tags: [backend, critical]
  - name: Next
    color: "#3b82f6"
    cards:
      - id: search
        title: Add semantic search
        tags: [backend, feature]
export:
  format: json
  copyLabel: Copy JSON
`);

    expect(config.title).toBe("Sprint Planning");
    expect(config.export).toEqual({ format: "json", copyLabel: "Copy JSON" });
    expect(config.columns).toHaveLength(2);
    expect(config.columns[0]).toMatchObject({ name: "Now", color: "#22c55e" });
    expect(config.columns[0]?.cards[0]).toMatchObject({
      id: "auth",
      title: "Fix auth token refresh",
      description: "Refresh before expiry",
      priority: "critical",
      assignee: "cinos",
      tags: ["backend", "critical"],
    });
  });

  it("returns no columns for an empty config", () => {
    expect(parseKanbanBlockConfig("# empty").columns).toEqual([]);
  });
});

describe("buildKanbanBlockExportText", () => {
  const columns = [
    { name: "Now", cards: [{ id: "auth", title: "Fix auth", tags: ["backend"] }] },
    { name: "Next", cards: [{ id: "search", title: "Add search" }] },
  ];

  it("builds markdown export text", () => {
    expect(buildKanbanBlockExportText(columns)).toBe([
      "## Now",
      "- **Fix auth** [backend]",
      "",
      "## Next",
      "- **Add search**",
      "",
    ].join("\n"));
  });

  it("builds json export text", () => {
    expect(JSON.parse(buildKanbanBlockExportText(columns, "json"))).toEqual([
      { column: "Now", cards: [{ id: "auth", title: "Fix auth", tags: ["backend"] }] },
      { column: "Next", cards: [{ id: "search", title: "Add search" }] },
    ]);
  });
});

describe("kanban query config", () => {
  it("parses a multi-line query plus groupBy without disturbing columns", () => {
    const config = parseKanbanBlockConfig(
      [
        "title: Board",
        "query: |",
        '  TABLE title, status',
        '  FROM "datasets"',
        "groupBy: status",
        "columns:",
        "  - name: draft",
        '    color: "#f59e0b"',
      ].join("\n"),
    );
    expect(config.query).toBe('TABLE title, status\nFROM "datasets"');
    expect(config.groupBy).toBe("status");
    expect(config.title).toBe("Board");
    expect(config.columns).toEqual([{ name: "draft", color: "#f59e0b", cards: [] }]);
  });

  it("parses a single-line query", () => {
    const config = parseKanbanBlockConfig(
      ['query: TABLE title, status FROM "x"', "groupBy: status"].join("\n"),
    );
    expect(config.query).toBe('TABLE title, status FROM "x"');
    expect(config.groupBy).toBe("status");
  });

  it("leaves query and groupBy undefined for inline boards", () => {
    const config = parseKanbanBlockConfig(
      ["columns:", "  - name: Now", "    cards:", "      - id: a", "        title: A"].join("\n"),
    );
    expect(config.query).toBeUndefined();
    expect(config.groupBy).toBeUndefined();
    expect(config.columns[0].cards).toHaveLength(1);
  });
});

describe("queryRowsToKanbanColumns", () => {
  const rows = [
    { _path: "datasets/a.md", title: "Alpha", status: "draft", priority: "high" },
    { _path: "datasets/b.md", title: "Beta", status: "verified" },
    { _path: "datasets/c.md", title: "Gamma", status: "draft" },
  ];

  it("groups rows into lanes keyed by the groupBy column", () => {
    const cols = queryRowsToKanbanColumns(rows, "status");
    expect(cols.map((c) => c.name)).toEqual(["draft", "verified"]);
    expect(cols[0].cards.map((c) => c.title)).toEqual(["Alpha", "Gamma"]);
    expect(cols[1].cards.map((c) => c.title)).toEqual(["Beta"]);
  });

  it("uses the path as the card id so drag tracking stays stable", () => {
    const cols = queryRowsToKanbanColumns(rows, "status");
    expect(cols[0].cards[0].id).toBe("datasets/a.md");
  });

  it("keeps declared lane order and colour, appending undeclared groups", () => {
    const cols = queryRowsToKanbanColumns(rows, "status", [
      { name: "verified", color: "#22c55e", cards: [] },
    ]);
    expect(cols.map((c) => c.name)).toEqual(["verified", "draft"]);
    expect(cols[0].color).toBe("#22c55e");
    expect(cols[0].cards.map((c) => c.title)).toEqual(["Beta"]);
  });

  it("keeps a declared lane that the query returned no rows for", () => {
    const cols = queryRowsToKanbanColumns(rows, "status", [{ name: "archived", cards: [] }]);
    expect(cols.map((c) => c.name)).toEqual(["archived", "draft", "verified"]);
    expect(cols[0].cards).toEqual([]);
  });

  it("skips rows with a null or blank group value", () => {
    const cols = queryRowsToKanbanColumns(
      [{ title: "A", status: null }, { title: "B", status: "   " }, { title: "C", status: "done" }],
      "status",
    );
    expect(cols.map((c) => c.name)).toEqual(["done"]);
  });

  it("falls back to the filename when a row has no title", () => {
    const cols = queryRowsToKanbanColumns([{ _path: "notes/my-page.md", status: "todo" }], "status");
    expect(cols[0].cards[0].title).toBe("my-page");
  });

  it("maps optional card fields and splits comma-separated tags", () => {
    const cols = queryRowsToKanbanColumns(
      [{ _path: "a.md", title: "A", status: "todo", tags: "backend, critical", assignee: "ana" }],
      "status",
    );
    expect(cols[0].cards[0].tags).toEqual(["backend", "critical"]);
    expect(cols[0].cards[0].assignee).toBe("ana");
  });

  it("accepts tags that already arrive as an array", () => {
    const cols = queryRowsToKanbanColumns(
      [{ _path: "a.md", title: "A", status: "todo", tags: ["x", "y"] }],
      "status",
    );
    expect(cols[0].cards[0].tags).toEqual(["x", "y"]);
  });

  it("returns no lanes for an empty result set", () => {
    expect(queryRowsToKanbanColumns([], "status")).toEqual([]);
  });
});
