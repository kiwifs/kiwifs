import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import type { Decoration } from "@codemirror/view";
import { markdownEditorExtensions } from "../markdownLanguage";
import { collect, type DecorationBuilder } from "./util";

/**
 * A fully parsed markdown state. `‸` in `doc` marks the caret and is removed;
 * without one the caret sits at the end of an extra trailing line, away from
 * every element under test.
 */
export function stateOf(doc: string, extensions: Extension[] = []): EditorState {
  const caret = doc.indexOf("‸");
  const text = caret >= 0 ? doc.slice(0, caret) + doc.slice(caret + 1) : `${doc}\n\nend`;
  const state = EditorState.create({
    doc: text,
    selection: EditorSelection.cursor(caret >= 0 ? caret : text.length),
    extensions: [markdownEditorExtensions(), ...extensions],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

export type Found = { text: string; from: number; to: number; spec: Decoration["spec"] };

export function decorations(state: EditorState, build: DecorationBuilder): Found[] {
  const out: Found[] = [];
  collect(state, build).between(0, state.doc.length, (from, to, deco) => {
    out.push({ text: state.sliceDoc(from, to), from, to, spec: deco.spec });
  });
  return out;
}

/** The text of every span `build` hides or replaces. */
export function replaced(state: EditorState, build: DecorationBuilder): string[] {
  return decorations(state, build)
    .filter((d) => d.from !== d.to && !d.spec.class && !d.spec.attributes)
    .map((d) => d.text);
}

/** The classes of every line decoration, as "line number: classes". */
export function lineClasses(state: EditorState, build: DecorationBuilder): string[] {
  return decorations(state, build)
    .filter((d) => d.from === d.to && d.spec.class)
    .map((d) => `${state.doc.lineAt(d.from).number}: ${d.spec.class}`);
}
