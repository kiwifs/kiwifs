// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { autocompletion, currentCompletions, type CompletionContext, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete";
import { accept, typeText } from "@kw/test/completionTyping";
import type { EditorSlashCommandConfig } from "@kw/lib/editorSlashCommands";
import { customSlashCompletionSource, slashCompletionSourceFor } from "./markdownSlashCommands";

async function invokeCompletionSource(
  source: CompletionSource,
  context: CompletionContext,
): Promise<CompletionResult | null> {
  const result = source(context);
  return result instanceof Promise ? await result : result;
}

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});

function editor(doc: string, ...sources: CompletionSource[]): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: sources.length ? [autocompletion({ override: sources })] : [],
    }),
  });
  views.push(view);
  return view;
}

const command = (id: string, insert: string, extra: Partial<EditorSlashCommandConfig> = {}): EditorSlashCommandConfig => ({
  id,
  label: id,
  icon: "",
  description: "",
  insert,
  ...extra,
});

const adr = [command("adr", "# ADR\n", { label: "ADR", template: "templates/adr.md" })];

describe("customSlashCompletionSource", () => {
  it("offers configured commands matching the slash query, by id or alias", async () => {
    const commands = [
      ...adr,
      command("runbook", "1. step"),
      command("assigned", "[assigned:: agent]", { aliases: ["agent"] }),
    ];
    const source = customSlashCompletionSource(commands);
    for (const [query, want] of [["/ad", "/adr"], ["/age", "/assigned"]] as const) {
      const state = EditorState.create({ doc: `# Note\n\n${query}` });
      const result = await invokeCompletionSource(source, {
        state,
        pos: state.doc.length,
        explicit: false,
        match: undefined,
      } as unknown as CompletionContext);
      expect(result?.options.map((o) => o.label)).toEqual([want]);
      expect(result?.filter).toBe(false);
    }
  });

  it("inserts resolved template markdown synchronously", async () => {
    const view = editor("Intro\n", customSlashCompletionSource(adr));
    await typeText(view, "/adr");
    await accept(view);
    expect(view.state.doc.toString()).toBe("Intro\n# ADR\n");
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
  });

  it("replaces the whole query typed after the menu opened", async () => {
    const view = editor("", customSlashCompletionSource(adr));
    await typeText(view, "/a");
    await typeText(view, "dr");
    await accept(view);
    expect(view.state.doc.toString()).toBe("# ADR\n");
  });

  it("inserts inline text inside a task, caret after it", async () => {
    const view = editor("- [ ] buy milk ", customSlashCompletionSource([command("assigned", "[assigned:: agent]")]));
    await typeText(view, "/ass");
    await accept(view);
    expect(view.state.doc.toString()).toBe("- [ ] buy milk [assigned:: agent]");
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
  });

  it("puts the caret at {{cursor}}", async () => {
    const view = editor("", customSlashCompletionSource([command("todo", "- [ ] {{cursor}} [assigned:: agent]")]));
    await typeText(view, "/todo");
    await accept(view);
    expect(view.state.doc.toString()).toBe("- [ ]  [assigned:: agent]");
    expect(view.state.selection.main.head).toBe("- [ ] ".length);
  });

  it("finds a custom command by alias while typing", async () => {
    const view = editor("- [ ] milk ", customSlashCompletionSource([{ ...command("assigned", "[assigned:: agent]"), aliases: ["agent"] }]));
    await typeText(view, "/agent");
    await accept(view);
    expect(view.state.doc.toString()).toBe("- [ ] milk [assigned:: agent]");
  });

  it("lists a custom command above a built-in that matches as well, in the editor's source order", async () => {
    const view = editor("", customSlashCompletionSource([command("tabs", "x")]), slashCompletionSourceFor());
    await typeText(view, "/tab");
    expect(currentCompletions(view.state)[0]?.label).toBe("/tabs");
  });
});

describe("slashCompletionSourceFor", () => {
  async function labels(source: CompletionSource, doc: string) {
    const state = EditorState.create({ doc });
    const result = await invokeCompletionSource(source, {
      state,
      pos: state.doc.length,
      explicit: false,
      match: undefined,
    } as unknown as CompletionContext);
    return result?.options.map((o) => o.label) ?? [];
  }

  it("drops hidden built-ins", async () => {
    expect(await labels(slashCompletionSourceFor(), "/qu")).toContain("/quiz");
    expect(await labels(slashCompletionSourceFor(new Set(["quiz"])), "/qu")).not.toContain("/quiz");
  });

  it("drops built-ins a custom command overrides", async () => {
    const labelsFor = await labels(slashCompletionSourceFor(undefined, new Set(["todo"])), "/to");
    expect(labelsFor).not.toContain("/todo");
  });
});
