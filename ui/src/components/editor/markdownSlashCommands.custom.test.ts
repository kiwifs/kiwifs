// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { autocompletion, type CompletionContext, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete";
import { accept, typeText } from "@kw/test/completionTyping";
import { customSlashCompletionSource, customSlashTemplateState } from "./markdownSlashCommands";

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

function editor(doc: string, source?: CompletionSource): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: source ? [autocompletion({ override: [source] })] : [],
    }),
  });
  views.push(view);
  return view;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const adr = [{ id: "adr", label: "ADR", icon: "", description: "", template: "templates/adr.md" }];

describe("customSlashCompletionSource", () => {
  it("offers configured commands matching the slash query", async () => {
    const commands = [
      { id: "adr", label: "ADR", icon: "FileCheck", description: "Insert ADR", template: "templates/adr.md" },
      { id: "runbook", label: "Runbook", icon: "Zap", description: "Runbook step", template: "templates/runbook.md" },
    ];
    const source = customSlashCompletionSource(commands, vi.fn().mockResolvedValue("# ADR\n"), vi.fn());
    const state = EditorState.create({ doc: "# Note\n\n/ad" });
    const result = await invokeCompletionSource(source, {
      state,
      pos: state.doc.length,
      explicit: false,
      match: undefined,
    } as unknown as CompletionContext);

    expect(result?.options).toHaveLength(1);
    expect(result?.options?.[0]?.label).toBe("/adr");
  });

  it("loads template content on apply and reports errors", async () => {
    const onError = vi.fn();
    const source = customSlashCompletionSource(adr, vi.fn().mockRejectedValue(new Error("missing file")), onError);
    const state = EditorState.create({ doc: "/adr" });
    const result = await invokeCompletionSource(source, {
      state,
      pos: state.doc.length,
      explicit: false,
      match: undefined,
    } as unknown as CompletionContext);

    const apply = result?.options?.[0]?.apply;
    expect(typeof apply).toBe("function");
    if (typeof apply === "function") {
      const view = editor("/adr");
      apply(view, result!.options![0]!, 0, 4);
      await flush();
      expect(onError).toHaveBeenCalledWith(expect.stringContaining("templates/adr.md"));
      expect(view.state.doc.toString()).toBe("");
    }
  });

  it("inserts loaded template markdown into the document", async () => {
    const source = customSlashCompletionSource(adr, vi.fn().mockResolvedValue("# ADR template\n"), vi.fn());
    const state = EditorState.create({ doc: "Intro\n/adr" });
    const result = await invokeCompletionSource(source, {
      state,
      pos: state.doc.length,
      explicit: false,
      match: undefined,
    } as unknown as CompletionContext);

    const apply = result?.options?.[0]?.apply;
    if (typeof apply === "function") {
      const view = editor("Intro\n/adr");
      apply(view, result!.options![0]!, 6, 10);
      await flush();
      expect(view.state.doc.toString()).toBe("Intro\n# ADR template\n");
      expect(view.state.selection.main.head).toBe(view.state.doc.length);
    }
  });

  it("replaces the whole query typed after the menu opened", async () => {
    const view = editor("", customSlashCompletionSource(adr, vi.fn().mockResolvedValue("# ADR\n"), vi.fn()));
    await typeText(view, "/a");
    await typeText(view, "dr");
    await accept(view);
    await flush();
    expect(view.state.doc.toString()).toBe("# ADR\n");
  });

  it("lands the template where the trigger was when the user types while it loads", async () => {
    let resolve!: (content: string) => void;
    const loadTemplate = vi.fn(() => new Promise<string>((r) => (resolve = r)));
    const view = editor("Intro\n", customSlashCompletionSource(adr, loadTemplate, vi.fn()));
    await typeText(view, "/adr");
    await accept(view);
    expect(view.state.doc.toString()).toBe("Intro\n");

    view.dispatch({ changes: { from: 0, insert: ">> " }, userEvent: "input.type" });
    const head = view.state.selection.main.head;
    view.dispatch({ changes: { from: head, insert: "x" }, selection: { anchor: head + 1 }, userEvent: "input.type" });
    resolve("# ADR\n");
    await flush();

    expect(view.state.doc.toString()).toBe(">> Intro\n# ADR\nx");
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
  });

  it("keeps a loading template across a reconfigure", async () => {
    let resolve!: (content: string) => void;
    const loadTemplate = vi.fn(() => new Promise<string>((r) => (resolve = r)));
    const extensions = [
      customSlashTemplateState,
      autocompletion({ override: [customSlashCompletionSource(adr, loadTemplate, vi.fn())] }),
    ];
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({ parent, state: EditorState.create({ doc: "", extensions }) });
    views.push(view);
    await typeText(view, "/adr");
    await accept(view);

    // What @uiw/react-codemirror does when the extensions prop changes.
    view.dispatch({ effects: StateEffect.reconfigure.of([...extensions]) });
    resolve("# ADR\n");
    await flush();

    expect(view.state.doc.toString()).toBe("# ADR\n");
  });
});
