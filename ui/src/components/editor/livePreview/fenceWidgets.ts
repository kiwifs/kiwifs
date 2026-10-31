import { syntaxTree } from "@codemirror/language";
import { EditorSelection, Facet, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import type { ReactNode } from "react";
import type { FencePreviewTarget } from "../fenceAssist";
import type { WidgetPortals } from "./portals";
import { type DecorationBuilder, eachNode, focusChanged, selectionTouches, wholeDoc } from "./util";

export type FenceRenderer = {
  portals: WidgetPortals;
  /** Whether this fence renders as a widget rather than as code. */
  accepts: (fence: FencePreviewTarget) => boolean;
  render: (fence: FencePreviewTarget) => ReactNode;
};

export const fenceRendererFacet = Facet.define<FenceRenderer, FenceRenderer | null>({
  combine: (values) => values[0] ?? null,
});

/** Put the caret on the first body line of the fence starting at `pos`, revealing its source. */
export function editFenceAt(view: EditorView, pos: number) {
  const opening = view.state.doc.lineAt(pos);
  const target = opening.number < view.state.doc.lines ? view.state.doc.line(opening.number + 1).from : opening.to;
  view.dispatch({ selection: EditorSelection.cursor(target), scrollIntoView: true });
  view.focus();
}

class FenceWidget extends WidgetType {
  constructor(readonly fence: FencePreviewTarget, readonly renderer: FenceRenderer) {
    super();
  }
  eq(other: FenceWidget) {
    const a = this.fence;
    const b = other.fence;
    return a.lang === b.lang && a.meta === b.meta && a.body === b.body;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-lp-fence";
    const bar = document.createElement("div");
    bar.className = "cm-lp-fence-bar";
    const label = document.createElement("span");
    label.textContent = this.fence.lang;
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "cm-lp-fence-edit";
    edit.textContent = "Edit";
    edit.setAttribute("aria-label", `Edit ${this.fence.lang} source`);
    edit.addEventListener("mousedown", (event) => {
      event.preventDefault();
      editFenceAt(view, view.posAtDOM(wrap));
    });
    bar.append(label, edit);
    const body = document.createElement("div");
    body.className = "cm-lp-fence-body";
    wrap.append(bar, body);
    this.renderer.portals.set(body, this.renderer.render(this.fence));
    return wrap;
  }
  destroy(dom: HTMLElement) {
    const body = dom.querySelector<HTMLElement>(".cm-lp-fence-body");
    if (body) this.renderer.portals.delete(body);
  }
  ignoreEvent() {
    return true;
  }
  get estimatedHeight() {
    return 240;
  }
}

/**
 * Widget fences (```array, ```tree, ```kiwi-app, ```mermaid, …) drawn by the
 * same renderers as the page, in place of their source. Moving the selection
 * into a fence, or pressing its Edit button, shows the source again; the
 * fence linter keeps checking it either way. Plain code fences stay text.
 */
export const fenceDecorations: DecorationBuilder = (state, ranges) => {
  const renderer = state.facet(fenceRendererFacet);
  if (!renderer) return [];
  const out: Range<Decoration>[] = [];
  eachNode(state, ranges, ({ name, from, to, node }) => {
    if (name !== "FencedCode") return;
    const marks = node.getChildren("CodeMark");
    // An unclosed fence is still being typed.
    if (marks.length < 2 || selectionTouches(state, from, to)) return false;
    const info = node.getChild("CodeInfo");
    const opening = state.doc.lineAt(from);
    // CodeInfo is the whole info string: the language, then the meta.
    const [lang = "", ...rest] = (info ? state.sliceDoc(info.from, opening.to) : "").trim().split(/\s+/);
    const meta = rest.join(" ");
    const closing = state.doc.lineAt(to);
    const body = opening.number + 1 <= closing.number - 1
      ? state.sliceDoc(state.doc.line(opening.number + 1).from, state.doc.line(closing.number - 1).to)
      : "";
    const fence = { lang, meta, body };
    if (!lang || !renderer.accepts(fence)) return false;
    out.push(Decoration.replace({ widget: new FenceWidget(fence, renderer), block: true }).range(opening.from, closing.to));
    return false;
  });
  return out;
};

export const fenceWidgets = () =>
  StateField.define<DecorationSet>({
    create: (state) => Decoration.set(fenceDecorations(state, wholeDoc(state)), true),
    update(value, tr) {
      if (!tr.docChanged && !tr.selection && !focusChanged(tr) && syntaxTree(tr.startState) === syntaxTree(tr.state)) return value;
      return Decoration.set(fenceDecorations(tr.state, wholeDoc(tr.state)), true);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
