import { describe, expect, it } from "vitest";
import {
  getAvailableMarkdownSlashCommands,
  markdownSlashCommands,
  slashCommandChanges,
  splitFenceExample,
  widgetSlashCommands,
} from "./markdownSlashCommands";

function command(name: string) {
  const found = markdownSlashCommands.find((item) => item.name === name);
  if (!found) throw new Error(`Missing slash command: ${name}`);
  return found;
}

describe("markdown slash commands", () => {
  it("replaces only the slash trigger with a GFM table skeleton", () => {
    const result = slashCommandChanges({ from: 8, to: 11 }, command("table"));

    expect(result.changes).toEqual({ from: 8, to: 11, insert: "| Column | Value |\n| --- | --- |\n|  |  |\n" });
    expect(result.selection.anchor).toBe(8 + "| Column | Value |\n| --- | --- |\n| ".length);
  });

  it("puts the caret after a todo marker", () => {
    const result = slashCommandChanges({ from: 7, to: 12 }, command("todo"));

    expect(result.changes).toEqual({ from: 7, to: 12, insert: "- [ ] " });
    expect(result.selection.anchor).toBe("Before\n- [ ] ".length);
  });

  it("inserts frontmatter like any other command", () => {
    const result = slashCommandChanges({ from: 0, to: 3 }, command("frontmatter"));

    expect(result.changes).toEqual({ from: 0, to: 3, insert: "---\ntitle: \ntags: []\n---\n\n" });
    expect(result.selection.anchor).toBe("---\ntitle: ".length);
  });

  it("shows frontmatter when filtering slash commands for a document without frontmatter", () => {
    expect(getAvailableMarkdownSlashCommands("# Note\n\n", "fr").map((item) => item.name)).toContain("frontmatter");
  });

  it("hides frontmatter when filtering slash commands for a document that already has frontmatter", () => {
    const doc = "---\ntitle: Existing\n---\n\n/fr";

    expect(getAvailableMarkdownSlashCommands(doc, "fr").map((item) => item.name)).not.toContain("frontmatter");
  });

  it("assigns distinct emoji icons to slash command labels", () => {
    expect(command("table").icon).toBe("📊");
    expect(command("todo").icon).toBe("✅");
    expect(command("code").icon).toBe("💻");
    expect(command("quote").icon).toBe("💬");
    expect(command("frontmatter").icon).toBe("🧾");
    expect(command("quiz").icon).toBe("❓");
  });
});

describe("callout slash commands", () => {
  const names = (query: string) => getAvailableMarkdownSlashCommands("", query).map((item) => item.name);

  it("offers warning for /warn by prefix and note for /info by alias", () => {
    expect(names("warn")).toContain("warning");
    expect(names("info")).toContain("note");
  });

  it("offers all five callouts for /callout", () => {
    expect(names("callout")).toEqual(["note", "tip", "important", "warning", "caution"]);
  });

  it("inserts a > [!type] marker with the caret after it", () => {
    for (const type of ["note", "tip", "important", "warning", "caution"]) {
      const c = command(type);
      expect(c.insert).toBe(`> [!${type}] `);
      expect(c.cursorOffset).toBe(c.insert.length);
    }
  });

  it("leaves out excluded names", () => {
    expect(getAvailableMarkdownSlashCommands("", "qu", new Set(["quiz"])).map((c) => c.name)).not.toContain("quiz");
  });
});

describe("widget slash entries", () => {
  it("gives every command a distinct name, so /table stays the GFM table", () => {
    const names = markdownSlashCommands.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    expect(command("table").detail).toBe("Insert a GFM table");
  });

  it("renames a widget whose language a built-in already uses", () => {
    const widgets = widgetSlashCommands();
    for (const w of widgets) expect(w.name).not.toBe("table");
    if (widgets.some((w) => w.name === "table-widget")) {
      expect(command("table-widget").insert.startsWith("```table")).toBe(true);
    }
  });
});

describe("splitFenceExample", () => {
  it("separates the language and body from the delimiter lines", () => {
    expect(splitFenceExample("```array\nvalues: [1, 2]\nactive: 0\n```\n", "array")).toEqual({
      language: "array",
      body: "values: [1, 2]\nactive: 0",
    });
  });

  it("handles a longer marker and a missing close", () => {
    expect(splitFenceExample("````tree\nroot: 1\n````", "tree")).toEqual({ language: "tree", body: "root: 1" });
    expect(splitFenceExample("```graph\nnodes: []", "graph")).toEqual({ language: "graph", body: "nodes: []" });
  });

  it("falls back to the spec's language for a bare body", () => {
    expect(splitFenceExample("values: [1]", "array")).toEqual({ language: "array", body: "values: [1]" });
  });
});
