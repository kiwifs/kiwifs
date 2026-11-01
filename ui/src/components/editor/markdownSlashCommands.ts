import { autocompletion, type Completion, type CompletionContext, type CompletionSource } from "@codemirror/autocomplete";
import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { type EditorView } from "@codemirror/view";
import type { EditorSlashCommandConfig } from "@kw/lib/editorSlashCommands";
import { filterSlashCommands, templateLoadErrorMessage } from "@kw/lib/editorSlashCommands";
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
};

export type SlashTriggerRange = {
  from: number;
  to: number;
};

export type CustomSlashCommandLoader = (templatePath: string) => Promise<string>;

/**
 * One entry per widget fence, generated from the registry rather than listed
 * by hand: a spec added without a menu entry would be undiscoverable, and a
 * menu entry that drifts from the schema teaches an invalid fence.
 */
export function widgetSlashCommands(): MarkdownSlashCommand[] {
  const builtinNames = new Set(builtinSlashCommands.map((c) => c.name));
  return allFences()
    .filter((spec) => !spec.legacy)
    .map((spec) => {
      // The example opens with ```<lang> …; put the cursor on the first body
      // line so the author is editing data, not retyping the tag.
      const insert = `${spec.example.replace(/\n?$/, "\n")}`;
      const firstBodyLine = insert.indexOf("\n") + 1;
      // `/table` already means a GFM table; the widget gets `/table-widget`.
      const clash = builtinNames.has(spec.lang);
      return {
        name: clash ? `${spec.lang}-widget` : spec.lang,
        icon: "🧩",
        label: clash ? `${spec.lang} widget` : spec.lang,
        detail: spec.description,
        insert,
        cursorOffset: firstBodyLine,
      };
    });
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

export function getAvailableMarkdownSlashCommands(doc: string, query: string): MarkdownSlashCommand[] {
  const normalizedQuery = query.toLowerCase();
  return markdownSlashCommands.filter((command) => {
    if (command.name === "frontmatter" && hasYamlFrontmatter(doc)) return false;
    return command.name.startsWith(normalizedQuery);
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
// source ran: with `validFor`, CodeMirror re-filters the same result as the
// user keeps typing, so a captured range would cover only the `/`.
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

function slashCompletionSource(context: CompletionContext) {
  const trigger = slashTriggerBeforeCursor(context);
  if (!trigger) return null;

  const doc = context.state.doc.toString();
  const query = context.state.doc.sliceString(trigger.from + 1, trigger.to).toLowerCase();
  const options = getAvailableMarkdownSlashCommands(doc, query).map((command) => completionFor(command));

  return {
    from: trigger.from,
    to: trigger.to,
    options,
    validFor: /^\/[\w-]*$/,
  };
}

type PendingTemplate = { id: number; pos: number };

const addPendingTemplate = StateEffect.define<PendingTemplate>();
const removePendingTemplate = StateEffect.define<number>();

/**
 * Where each loading template will land. The `/adr` query is deleted as soon
 * as the command is picked; the position is then mapped through whatever the
 * user types while the template is fetched.
 */
const pendingTemplates = StateField.define<readonly PendingTemplate[]>({
  create: () => [],
  update(value, tr) {
    let next = tr.docChanged ? value.map((p) => ({ id: p.id, pos: tr.changes.mapPos(p.pos) })) : value;
    for (const effect of tr.effects) {
      if (effect.is(addPendingTemplate)) next = [...next, effect.value];
      else if (effect.is(removePendingTemplate)) next = next.filter((p) => p.id !== effect.value);
    }
    return next;
  },
});

/**
 * Install alongside `customSlashCompletionSource`. A field added on first use
 * is dropped by the next reconfigure (a page list refresh, say), losing any
 * template still loading.
 */
export const customSlashTemplateState: Extension = pendingTemplates;

let nextPendingTemplateId = 0;

function beginCustomTemplate(view: EditorView, from: number, to: number): number {
  if (view.state.field(pendingTemplates, false) === undefined) {
    view.dispatch({ effects: StateEffect.appendConfig.of(pendingTemplates) });
  }
  const id = nextPendingTemplateId++;
  view.dispatch({
    changes: { from, to, insert: "" },
    selection: { anchor: from },
    effects: addPendingTemplate.of({ id, pos: from }),
    userEvent: "input.complete",
  });
  return id;
}

function pendingTemplatePos(view: EditorView, id: number): number | undefined {
  return view.state.field(pendingTemplates, false)?.find((p) => p.id === id)?.pos;
}

function insertCustomTemplate(view: EditorView, id: number, content: string): void {
  const at = pendingTemplatePos(view, id);
  if (at === undefined) return;
  // Only move the caret if it is still where the query was; otherwise the
  // user has moved on and their selection is mapped past the insert.
  const caretAtTrigger = view.state.selection.main.empty && view.state.selection.main.head === at;
  view.dispatch({
    changes: { from: at, insert: content },
    ...(caretAtTrigger ? { selection: { anchor: at + content.length } } : {}),
    effects: removePendingTemplate.of(id),
    userEvent: "input.complete",
  });
}

function abandonCustomTemplate(view: EditorView, id: number): void {
  if (pendingTemplatePos(view, id) === undefined) return;
  view.dispatch({ effects: removePendingTemplate.of(id) });
}

export function customSlashCompletionSource(
  commands: EditorSlashCommandConfig[],
  loadTemplate: CustomSlashCommandLoader,
  onError: (message: string) => void,
): CompletionSource {
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
      detail: cmd.description || `Insert from ${cmd.template}`,
      apply: (view: EditorView, _completion: Completion, from: number, to: number) => {
        const id = beginCustomTemplate(view, from, to);
        void loadTemplate(cmd.template)
          .then((content) => insertCustomTemplate(view, id, content))
          .catch((err) => {
            abandonCustomTemplate(view, id);
            onError(templateLoadErrorMessage(cmd.template, err));
          });
      },
    }));

    return {
      from: trigger.from,
      to: trigger.to,
      options,
      validFor: /^\/[\w-]*$/,
    };
  };
}

export { slashCompletionSource };

export function markdownSlashCommandExtension(): Extension {
  return autocompletion({
    override: [slashCompletionSource],
    activateOnTyping: true,
    closeOnBlur: true,
  });
}
