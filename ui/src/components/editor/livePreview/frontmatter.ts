import { EditorSelection, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { type DecorationBuilder, focusChanged, frontmatterRange, selectionTouches } from "./util";

class PropertiesWidget extends WidgetType {
  constructor(readonly keys: string[]) {
    super();
  }
  eq(other: PropertiesWidget) {
    return other.keys.join("\n") === this.keys.join("\n");
  }
  toDOM(view: EditorView) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "cm-lp-properties";
    chip.setAttribute("aria-label", "Edit page properties");
    const title = document.createElement("span");
    title.className = "cm-lp-properties-title";
    title.textContent = "Properties";
    const keys = document.createElement("span");
    keys.className = "cm-lp-properties-keys";
    keys.textContent = this.keys.join(" · ");
    chip.append(title, keys);
    chip.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const second = view.state.doc.lines > 1 ? view.state.doc.line(2) : view.state.doc.line(1);
      view.dispatch({ selection: EditorSelection.cursor(second.to), scrollIntoView: true });
      view.focus();
    });
    return chip;
  }
  ignoreEvent() {
    return true;
  }
}

const yamlLine = Decoration.line({ class: "cm-lp-frontmatter" });

/**
 * The YAML block at the top of the page folds into a "Properties" chip
 * listing its keys; clicking it, or moving the selection into it, shows the
 * YAML. This replaces the separate frontmatter textarea Visual mode uses, so
 * the file stays one text with one undo history.
 */
export const frontmatterDecorations: DecorationBuilder = (state) => {
  const fm = frontmatterRange(state);
  if (!fm) return [];
  const out: Range<Decoration>[] = [];
  if (selectionTouches(state, fm.from, fm.to)) {
    const last = state.doc.lineAt(fm.to).number;
    for (let n = 1; n <= last; n++) out.push(yamlLine.range(state.doc.line(n).from));
    return out;
  }
  const keys = state
    .sliceDoc(fm.from, fm.to)
    .split("\n")
    .slice(1, -1)
    .map((line) => /^([A-Za-z0-9_-][^:]*):/.exec(line)?.[1])
    .filter((k): k is string => !!k);
  out.push(Decoration.replace({ widget: new PropertiesWidget(keys), block: true }).range(fm.from, fm.to));
  return out;
};

export const frontmatter = () =>
  StateField.define<DecorationSet>({
    create: (state) => Decoration.set(frontmatterDecorations(state, []), true),
    update(value, tr) {
      if (!tr.docChanged && !tr.selection && !focusChanged(tr)) return value;
      return Decoration.set(frontmatterDecorations(tr.state, []), true);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
