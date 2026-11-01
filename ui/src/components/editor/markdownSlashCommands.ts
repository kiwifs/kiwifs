import { autocompletion, type Completion, type CompletionContext, type CompletionSource } from "@codemirror/autocomplete";
import { type Extension } from "@codemirror/state";
import { type EditorView } from "@codemirror/view";
import type { EditorSlashCommandConfig } from "@kw/lib/editorSlashCommands";
import { filterSlashCommands, slashCommandDetail, splitCursor } from "@kw/lib/editorSlashCommands";
import { allFences } from "@kw/fences";

/** Built-in names; widget fences add one entry each, generated below. */
export type MarkdownSlashCommandName = string;

export type MarkdownSlashCommand = {
  name: MarkdownSlashCommandName;
  icon: string;
  label: string;
  detail: string;
  insert: string;
  cursorOffset: number;
  /** Other words that find the command; matched by prefix like `name`. */
  aliases?: string[];
};

export type SlashTriggerRange = {
  from: number;
  to: number;
};

/**
 * One entry per widget fence, generated from the registry rather than listed
 * by hand: a spec added without a menu entry would be undiscoverable, and a
 * menu entry that drifts from the schema teaches an invalid fence.
 */
export function widgetSlashCommands(): MarkdownSlashCommand[] {
  return allFences()
    .filter((spec) => !spec.legacy)
    .map((spec) => {
      // The example opens with ```<lang> …; put the cursor on the first body
      // line so the author is editing data, not retyping the tag.
      const insert = `${spec.example.replace(/\n?$/, "\n")}`;
      const firstBodyLine = insert.indexOf("\n") + 1;
      // `/table` already means a GFM table; the widget gets `/table-widget`.
      const clash = widgetCommandName(spec.lang) !== spec.lang;
      return {
        name: widgetCommandName(spec.lang),
        icon: "🧩",
        label: clash ? `${spec.lang} widget` : spec.lang,
        detail: spec.description,
        insert,
        cursorOffset: firstBodyLine,
      };
    });
}

/**
 * The slash command id of a widget fence, shared by every editor so one
 * `hide` entry removes the same widget everywhere.
 */
export function widgetCommandName(lang: string): string {
  return builtinSlashCommands.some((c) => c.name === lang) ? `${lang}-widget` : lang;
}

/**
 * A fence example (```` ```lang\nbody\n``` ````) as a code block's language
 * and body, for editors that hold a fence as one block rather than lines.
 */
export function splitFenceExample(example: string, lang: string): { language: string; body: string } {
  const lines = example.replace(/\n+$/, "").split("\n");
  const open = /^(`{3,}|~{3,})\s*(\S*)/.exec(lines[0] ?? "");
  if (!open) return { language: lang, body: lines.join("\n") };
  const marker = open[1]!;
  const last = lines.length > 1 ? lines[lines.length - 1]!.trim() : "";
  const end = last.startsWith(marker[0]!.repeat(3)) && /^(`+|~+)$/.test(last) ? lines.length - 1 : lines.length;
  return { language: open[2] || lang, body: lines.slice(1, end).join("\n") };
}

/**
 * A GitHub-style alert, which the reader and live preview draw as a callout.
 * The caret lands after the marker, where the title or first line goes.
 */
function calloutCommand(type: string, icon: string, label: string, aliases: string[]): MarkdownSlashCommand[] {
  const insert = `> [!${type}] `;
  return [{ name: type, icon, label, detail: `Insert a > [!${type}] callout`, insert, cursorOffset: insert.length, aliases }];
}

const builtinSlashCommands: MarkdownSlashCommand[] = [
  {
    name: "table",
    icon: "📊",
    label: "Table",
    detail: "Insert a GFM table",
    insert: "| Column | Value |\n| --- | --- |\n|  |  |\n",
    cursorOffset: "| Column | Value |\n| --- | --- |\n| ".length,
  },
  {
    name: "todo",
    icon: "✅",
    label: "Todo",
    detail: "Insert a task list item",
    insert: "- [ ] ",
    cursorOffset: "- [ ] ".length,
  },
  {
    name: "code",
    icon: "💻",
    label: "Code block",
    detail: "Insert a fenced code block",
    insert: "```\n\n```",
    cursorOffset: "```\n".length,
  },
  {
    name: "d2",
    icon: "🔀",
    label: "D2 diagram",
    detail: "Insert a D2 diagram, rendered to SVG by the server",
    insert: "```d2\nclient -> server: request\nserver -> db: query\n```\n",
    cursorOffset: "```d2\n".length,
  },
  {
    name: "quote",
    icon: "💬",
    label: "Quote",
    detail: "Insert a block quote",
    insert: "> ",
    cursorOffset: "> ".length,
  },
  ...calloutCommand("note", "📝", "Note callout", ["info", "callout"]),
  ...calloutCommand("tip", "💡", "Tip callout", ["hint", "callout"]),
  ...calloutCommand("important", "❗", "Important callout", ["callout"]),
  ...calloutCommand("warning", "⚠️", "Warning callout", ["warn", "callout"]),
  ...calloutCommand("caution", "🛑", "Caution callout", ["danger", "callout"]),
  {
    name: "quiz",
    icon: "❓",
    label: "Quiz",
    detail: "Insert a Kiwi Quiz",
    insert: "> [!quiz single] \n> - [ ] \n> - [x] \n> - [ ] \n>\n> \n",
    cursorOffset: "> [!quiz single] ".length,
  },
  {
    name: "frontmatter",
    icon: "🧾",
    label: "Frontmatter",
    detail: "Insert YAML frontmatter",
    insert: "---\ntitle: \ntags: []\n---\n\n",
    cursorOffset: "---\ntitle: ".length,
  },
];

/** Built-ins first, then the widget fences in registry order. */
export const markdownSlashCommands: MarkdownSlashCommand[] = [
  ...builtinSlashCommands,
  ...widgetSlashCommands(),
];

export function hasYamlFrontmatter(doc: string): boolean {
  return /^---\s*\n[\s\S]*?\n---(?:\s*\n|$)/.test(doc);
}

export function getAvailableMarkdownSlashCommands(
  doc: string,
  query: string,
  exclude?: ReadonlySet<string>,
): MarkdownSlashCommand[] {
  const normalizedQuery = query.toLowerCase();
  return markdownSlashCommands.filter((command) => {
    if (exclude?.has(command.name)) return false;
    if (command.name === "frontmatter" && hasYamlFrontmatter(doc)) return false;
    return (
      command.name.startsWith(normalizedQuery) ||
      (command.aliases ?? []).some((alias) => alias.startsWith(normalizedQuery))
    );
  });
}

/**
 * The edit for a slash command, scoped to the trigger so undo and live
 * preview see one small change rather than a whole-document rewrite.
 * `/frontmatter` needs no special case: the menu hides it once the document
 * has frontmatter.
 */
export function slashCommandChanges(
  trigger: SlashTriggerRange,
  command: MarkdownSlashCommand,
): { changes: { from: number; to: number; insert: string }; selection: { anchor: number } } {
  return {
    changes: { from: trigger.from, to: trigger.to, insert: command.insert },
    selection: { anchor: trigger.from + command.cursorOffset },
  };
}

function slashTriggerBeforeCursor(context: CompletionContext): SlashTriggerRange | null {
  const line = context.state.doc.lineAt(context.pos);
  const beforeCursor = line.text.slice(0, context.pos - line.from);
  const match = beforeCursor.match(/(?:^|\s)(\/[\w-]*)$/);
  if (!match || match.index === undefined) return null;

  const slashText = match[1];
  const from = line.from + match.index + match[0].length - slashText.length;
  return { from, to: context.pos };
}

// `apply` must use the range CodeMirror passes, not one captured when the
// source ran: the menu can outlive the query it was built for (#565), so a
// captured range may cover only the `/`.
function completionFor(command: MarkdownSlashCommand): Completion {
  return {
    label: `/${command.name}`,
    displayLabel: `${command.icon} /${command.name}`,
    type: "keyword",
    detail: command.detail,
    apply: (view: EditorView, _completion: Completion, from: number, to: number) => {
      view.dispatch({
        ...slashCommandChanges({ from, to }, command),
        userEvent: "input.complete",
      });
    },
  };
}

const NO_NAMES: ReadonlySet<string> = new Set();

/**
 * Both slash sources filter by id, alias and label themselves. CodeMirror's
 * own filter only sees the option label, so if it re-filtered a reused
 * result (`validFor`), `/info` would hide `/note` instead of finding it.
 * Re-running the source on each keystroke is cheap. Unfiltered results are
 * listed in source order and `boost` is ignored, so put the custom source
 * before the built-in one to list the user's commands first.
 */
const OWN_FILTERING = { filter: false } as const;

/**
 * The built-in menu, minus the commands a space hides and those a custom
 * command replaces by id.
 */
export function slashCompletionSourceFor(
  hidden: ReadonlySet<string> = NO_NAMES,
  overridden: ReadonlySet<string> = NO_NAMES,
): CompletionSource {
  const exclude = hidden.size === 0 ? overridden : overridden.size === 0 ? hidden : new Set([...hidden, ...overridden]);
  return (context: CompletionContext) => {
    const trigger = slashTriggerBeforeCursor(context);
    if (!trigger) return null;

    const doc = context.state.doc.toString();
    const query = context.state.doc.sliceString(trigger.from + 1, trigger.to).toLowerCase();
    const options = getAvailableMarkdownSlashCommands(doc, query, exclude).map((command) => completionFor(command));

    return { from: trigger.from, to: trigger.to, options, ...OWN_FILTERING };
  };
}

export const slashCompletionSource = slashCompletionSourceFor();

/**
 * The space's own commands. Templates arrive resolved from the server, so
 * picking one is a single synchronous edit, and `{{cursor}}` places the caret.
 */
export function customSlashCompletionSource(commands: EditorSlashCommandConfig[]): CompletionSource {
  return (context: CompletionContext) => {
    const trigger = slashTriggerBeforeCursor(context);
    if (!trigger) return null;

    const query = context.state.doc.sliceString(trigger.from + 1, trigger.to).toLowerCase();
    const filtered = filterSlashCommands(commands, query);
    if (filtered.length === 0) return null;

    const options: Completion[] = filtered.map((cmd) => ({
      label: `/${cmd.id}`,
      displayLabel: `/${cmd.label || cmd.id}`,
      type: "keyword",
      detail: slashCommandDetail(cmd),
      apply: (view: EditorView, _completion: Completion, from: number, to: number) => {
        const { text, cursor } = splitCursor(cmd.insert);
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + cursor },
          userEvent: "input.complete",
        });
      },
    }));

    return { from: trigger.from, to: trigger.to, options, ...OWN_FILTERING };
  };
}

export function markdownSlashCommandExtension(): Extension {
  return autocompletion({
    override: [slashCompletionSource],
    activateOnTyping: true,
    closeOnBlur: true,
  });
}
