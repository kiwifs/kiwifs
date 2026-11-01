// @vitest-environment happy-dom
import { autocompletion, closeBrackets, insertBracket } from "@codemirror/autocomplete";
import { history, undo } from "@codemirror/commands";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { accept, typeText } from "@kw/test/completionTyping";
import { markdownSlashCommandExtension, markdownSlashCommands } from "./markdownSlashCommands";
import { wikiLinkCompletionSource } from "./wikiLinkCompletion";

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});

function editor(doc: string, extensions: Extension[]): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc, selection: { anchor: doc.length }, extensions }),
  });
  views.push(view);
  return view;
}

const slashEditor = (doc = "") => editor(doc, [history(), markdownSlashCommandExtension()]);

function command(name: string) {
  const found = markdownSlashCommands.find((c) => c.name === name);
  if (!found) throw new Error(`Missing slash command: ${name}`);
  return found;
}

describe("slash commands in a live editor", () => {
  it("drops the typed query when accepting /to (#565)", async () => {
    const view = slashEditor();
    await typeText(view, "/to");
    await accept(view);
    expect(view.state.doc.toString()).toBe("- [ ] ");
    expect(view.state.selection.main.head).toBe("- [ ] ".length);
  });

  it("works with no query at all", async () => {
    const view = slashEditor();
    await typeText(view, "/");
    await accept(view, "/todo");
    expect(view.state.doc.toString()).toBe("- [ ] ");
  });

  it("leaves earlier lines alone and puts the caret in the first table cell", async () => {
    const view = slashEditor("Before\n");
    await typeText(view, "/ta");
    await accept(view, "/table");
    const table = command("table");
    expect(view.state.doc.toString()).toBe(`Before\n${table.insert}`);
    expect(view.state.selection.main.head).toBe("Before\n".length + table.cursorOffset);
  });

  it("puts the caret on the first body line of a widget fence", async () => {
    const view = slashEditor();
    await typeText(view, "/arr");
    await accept(view, "/array");
    const array = command("array");
    expect(view.state.doc.toString()).toBe(array.insert);
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    expect(line.number).toBe(2);
    expect(line.from).toBe(view.state.selection.main.head);
  });

  it("undoes to the typed query, so the insert was scoped to the trigger", async () => {
    const view = slashEditor("Keep this\n");
    await typeText(view, "/to");
    await accept(view);
    expect(view.state.doc.toString()).toBe("Keep this\n- [ ] ");
    undo(view);
    expect(view.state.doc.toString()).toBe("Keep this\n/to");
  });
});

describe("wikilink completion in a live editor", () => {
  const pages = [{ path: "notes/foo.md", title: "Foo" }];

  it("replaces the whole [[query with the link", async () => {
    const view = editor("", [autocompletion({ override: [wikiLinkCompletionSource(pages)] })]);
    await typeText(view, "[[fo");
    await accept(view);
    expect(view.state.doc.toString()).toBe("[[notes/foo]]");
    expect(view.state.selection.main.head).toBe("[[notes/foo]]".length);
  });

  it("swallows the ]] that closeBrackets added", async () => {
    const view = editor("", [closeBrackets(), autocompletion({ override: [wikiLinkCompletionSource(pages)] })]);
    // The input handler closeBrackets installs only runs for DOM input, so
    // drive it the way it would: insertBracket for each `[`.
    for (let i = 0; i < 2; i++) view.dispatch(insertBracket(view.state, "[")!);
    expect(view.state.doc.toString()).toBe("[[]]");
    await typeText(view, "fo");
    await accept(view);
    expect(view.state.doc.toString()).toBe("[[notes/foo]]");
    expect(view.state.selection.main.head).toBe("[[notes/foo]]".length);
  });
});
