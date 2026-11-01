import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { BlockNoteEditor } from "@blocknote/core";
import { createElement } from "react";
import { parseMarkdownToBlocks } from "./blockNoteMarkdown";

/**
 * A custom command from `GET /editor/slash-commands`. The server resolves
 * templates, so `insert` always holds the text to insert; `template` is the
 * original path, kept for display.
 */
export type EditorSlashCommandConfig = {
  id: string;
  label: string;
  icon: string;
  description: string;
  aliases?: string[];
  insert: string;
  template?: string;
};

export type EditorSlashCommands = {
  commands: EditorSlashCommandConfig[];
  /** Built-in command ids to leave out of the menu, lowercased. */
  hide: string[];
  /** Entries the server skipped, for a banner rather than silence. */
  warnings: string[];
};

export const CURSOR_MARKER = "{{cursor}}";

/**
 * Removes the first `{{cursor}}` and reports where it was. Later markers are
 * left in the text, as documented for the slash commands file.
 */
export function splitCursor(text: string): { text: string; cursor: number } {
  const at = text.indexOf(CURSOR_MARKER);
  if (at < 0) return { text, cursor: text.length };
  return { text: text.slice(0, at) + text.slice(at + CURSOR_MARKER.length), cursor: at };
}

export function resolveLucideIcon(name: string): LucideIcon {
  const icons = LucideIcons as unknown as Record<string, LucideIcon | undefined>;
  const trimmed = name.trim();
  if (!trimmed) return LucideIcons.FileText;
  return icons[trimmed] ?? LucideIcons.FileText;
}

export function slashCommandDetail(cmd: EditorSlashCommandConfig): string {
  if (cmd.description) return cmd.description;
  if (cmd.template) return `Insert from ${cmd.template}`;
  return cmd.insert.split("\n")[0]!.replace(CURSOR_MARKER, "");
}

type InsertableEditor = Pick<
  BlockNoteEditor,
  "getTextCursorPosition" | "insertBlocks" | "insertInlineContent" | "replaceBlocks" | "tryParseHTMLToBlocks"
> & { prosemirrorView?: BlockNoteEditor["prosemirrorView"] };

/**
 * Removes the `/query` the user typed. BlockNote's own clearQuery runs after
 * it has already closed the menu, by which point it no longer knows the
 * range, so items that don't replace the whole block must do this themselves.
 */
function deleteSlashQuery(editor: InsertableEditor, query: string): void {
  const view = editor.prosemirrorView;
  if (!view) return;
  const trigger = `/${query}`;
  const { state } = view;
  const at = state.selection.from;
  if (at < trigger.length || state.doc.textBetween(at - trigger.length, at) !== trigger) return;
  view.dispatch(state.tr.delete(at - trigger.length, at));
}

function isEmptyParagraph(block: { type: string; content?: unknown }): boolean {
  return block.type === "paragraph" && Array.isArray(block.content) && block.content.length === 0;
}

/**
 * One line goes in at the caret, so `[assigned:: agent]` lands inside the
 * task being written; anything longer becomes blocks after the current one,
 * or replaces it when the query was all it held. BlockNote has no cheap way
 * to place the caret inside inserted inline content, so `{{cursor}}` is
 * dropped here and the caret ends after the text.
 */
export function insertSlashCommand(editor: InsertableEditor, insert: string, query = ""): void {
  deleteSlashQuery(editor, query);
  const { text } = splitCursor(insert);
  if (!text.includes("\n")) {
    editor.insertInlineContent(text);
    return;
  }
  const cur = editor.getTextCursorPosition().block;
  let blocks: Parameters<BlockNoteEditor["insertBlocks"]>[0] = [];
  try {
    blocks = parseMarkdownToBlocks(editor, text);
  } catch {
    // fall through to plain paragraph insert
  }
  if (!blocks?.length) blocks = [{ type: "paragraph", content: text }];
  if (isEmptyParagraph(cur)) editor.replaceBlocks([cur], blocks);
  else editor.insertBlocks(blocks, cur, "after");
}

export function blockNoteSlashItems(editor: InsertableEditor, commands: EditorSlashCommandConfig[], query = "") {
  return commands.map((cmd) => ({
    key: cmd.id,
    title: cmd.label || cmd.id,
    subtext: slashCommandDetail(cmd),
    aliases: [cmd.id, cmd.label, ...(cmd.aliases ?? [])].filter(Boolean),
    group: "Custom",
    icon: createElement(resolveLucideIcon(cmd.icon), { size: 18 }),
    onItemClick: () => insertSlashCommand(editor, cmd.insert, query),
  }));
}

/**
 * BlockNote keys menu rows by title, so two items with the same title (a
 * custom "Warning callout" next to the built-in one) leave stale rows behind
 * as the query narrows. Later duplicates get their id appended.
 */
export function uniqueSlashItemTitles<T extends { title: string; key?: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.map((item) => {
    let title = item.title;
    if (seen.has(title)) title = `${title} (/${item.key ?? seen.size})`;
    for (let n = 2; seen.has(title); n++) title = `${item.title} (${n})`;
    seen.add(title);
    return title === item.title ? item : { ...item, title };
  });
}

export function matchesSlashQuery(value: string, query: string): boolean {
  const normalized = query.toLowerCase();
  if (!normalized) return true;
  return value.toLowerCase().startsWith(normalized);
}

export function filterSlashCommands(
  commands: EditorSlashCommandConfig[],
  query: string,
): EditorSlashCommandConfig[] {
  return commands.filter(
    (cmd) =>
      matchesSlashQuery(cmd.id, query) ||
      matchesSlashQuery(cmd.label, query) ||
      (cmd.aliases ?? []).some((alias) => matchesSlashQuery(alias, query)),
  );
}
