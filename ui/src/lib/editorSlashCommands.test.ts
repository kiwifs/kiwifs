import { describe, expect, it, vi } from "vitest";
import { FileCheck, FileText } from "lucide-react";
import {
  blockNoteSlashItems,
  filterSlashCommands,
  insertSlashCommand,
  matchesSlashQuery,
  resolveLucideIcon,
  slashCommandDetail,
  splitCursor,
  uniqueSlashItemTitles,
} from "./editorSlashCommands";

const cmd = (id: string, extra: Partial<Parameters<typeof slashCommandDetail>[0]> = {}) => ({
  id,
  label: id,
  icon: "",
  description: "",
  insert: "",
  ...extra,
});

describe("editorSlashCommands", () => {
  it("resolves lucide icon names from config", () => {
    expect(resolveLucideIcon("FileCheck")).toBe(FileCheck);
    expect(resolveLucideIcon("")).toBe(FileText);
    expect(resolveLucideIcon("NotARealIcon")).toBe(FileText);
  });

  it("filters commands by id, label or alias prefix", () => {
    const commands = [
      cmd("adr", { label: "ADR" }),
      cmd("runbook", { label: "Runbook Step" }),
      cmd("assigned", { aliases: ["agent"] }),
    ];
    expect(filterSlashCommands(commands, "ad")).toHaveLength(1);
    expect(filterSlashCommands(commands, "run")).toHaveLength(1);
    expect(filterSlashCommands(commands, "age").map((c) => c.id)).toEqual(["assigned"]);
    expect(filterSlashCommands(commands, "")).toHaveLength(3);
  });

  it("matches slash query case-insensitively", () => {
    expect(matchesSlashQuery("ADR", "ad")).toBe(true);
    expect(matchesSlashQuery("runbook", "Run")).toBe(true);
    expect(matchesSlashQuery("adr", "book")).toBe(false);
  });

  it("splits out the first {{cursor}} marker", () => {
    expect(splitCursor("[assigned:: agent]")).toEqual({ text: "[assigned:: agent]", cursor: 18 });
    expect(splitCursor("- [ ] {{cursor}} x")).toEqual({ text: "- [ ]  x", cursor: 6 });
    expect(splitCursor("{{cursor}}a{{cursor}}")).toEqual({ text: "a{{cursor}}", cursor: 0 });
  });

  it("describes a command by description, template, then insert", () => {
    expect(slashCommandDetail(cmd("a", { description: "Hand off" }))).toBe("Hand off");
    expect(slashCommandDetail(cmd("a", { template: ".kiwi/templates/x.md" }))).toBe("Insert from .kiwi/templates/x.md");
    expect(slashCommandDetail(cmd("a", { insert: "> [!warning] {{cursor}}\n> more" }))).toBe("> [!warning] ");
  });

  function fakeEditor(block: { id: string; type: string; content: unknown[] } = { id: "cur", type: "paragraph", content: ["x"] }) {
    return {
      getTextCursorPosition: vi.fn(() => ({ block })),
      insertBlocks: vi.fn(),
      replaceBlocks: vi.fn(),
      insertInlineContent: vi.fn(),
      tryParseHTMLToBlocks: vi.fn((html: string) => [{ type: "paragraph", html }]),
    };
  }

  /** A ProseMirror view stand-in over one line of text with the caret at its end. */
  function withText(editor: ReturnType<typeof fakeEditor>, initial: string) {
    let text = initial;
    const view = {
      get state() {
        return {
          selection: { from: text.length },
          doc: { textBetween: (from: number, to: number) => text.slice(from, to) },
          tr: { delete: (from: number, to: number) => ({ from, to }) },
        };
      },
      dispatch: ({ from, to }: { from: number; to: number }) => {
        text = text.slice(0, from) + text.slice(to);
      },
    };
    return { editor: { ...editor, prosemirrorView: view }, text: () => text };
  }

  it("inserts one line inline at the caret, without the cursor marker", () => {
    const editor = fakeEditor();
    insertSlashCommand(editor as never, "[assigned:: {{cursor}}agent]");
    expect(editor.insertInlineContent).toHaveBeenCalledWith("[assigned:: agent]");
    expect(editor.insertBlocks).not.toHaveBeenCalled();
  });

  it("removes the typed /query before inserting", () => {
    const base = fakeEditor();
    const { editor, text } = withText(base, "buy milk /assig");
    insertSlashCommand(editor as never, "[assigned:: agent]", "assig");
    expect(text()).toBe("buy milk ");
    expect(base.insertInlineContent).toHaveBeenCalledWith("[assigned:: agent]");
  });

  it("leaves text alone when it doesn't end with the query", () => {
    const { editor, text } = withText(fakeEditor(), "buy milk");
    insertSlashCommand(editor as never, "x", "assig");
    expect(text()).toBe("buy milk");
  });

  it("inserts several lines as blocks after the current one", () => {
    const editor = fakeEditor();
    insertSlashCommand(editor as never, "## Decision\n\n{{cursor}}\n");
    expect(editor.insertInlineContent).not.toHaveBeenCalled();
    expect(editor.tryParseHTMLToBlocks).toHaveBeenCalledWith(expect.stringContaining("<h2>Decision</h2>"));
    expect(editor.insertBlocks).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ id: "cur" }), "after");
  });

  it("replaces the current block when the query was all it held", () => {
    const empty = { id: "cur", type: "paragraph", content: [] };
    const editor = fakeEditor(empty);
    insertSlashCommand(editor as never, "## Decision\n\nBody\n");
    expect(editor.replaceBlocks).toHaveBeenCalledWith([empty], expect.any(Array));
    expect(editor.insertBlocks).not.toHaveBeenCalled();
  });

  it("builds BlockNote items in a Custom group with aliases", () => {
    const editor = fakeEditor();
    const [item] = blockNoteSlashItems(editor as never, [
      cmd("assigned", { label: "Assign to agent", aliases: ["agent"], insert: "[assigned:: agent]" }),
    ]);
    expect(item).toMatchObject({ key: "assigned", title: "Assign to agent", group: "Custom" });
    expect(item!.aliases).toEqual(["assigned", "Assign to agent", "agent"]);
    item!.onItemClick();
    expect(editor.insertInlineContent).toHaveBeenCalledWith("[assigned:: agent]");
  });

  it("makes menu titles unique, since BlockNote keys rows by title", () => {
    const titles = uniqueSlashItemTitles([
      { key: "warn-box", title: "Warning callout" },
      { key: "callout-warning", title: "Warning callout" },
      { key: "x", title: "Other" },
    ]).map((item) => item.title);
    expect(titles).toEqual(["Warning callout", "Warning callout (/callout-warning)", "Other"]);
  });
});
