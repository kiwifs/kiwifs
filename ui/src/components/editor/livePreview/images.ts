import { syntaxTree } from "@codemirror/language";
import { Facet, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { type DecorationBuilder, eachNode, wholeDoc } from "./util";

/** Turns an image `src` as written on the page into a URL that loads. */
export const imageResolverFacet = Facet.define<
  (src: string) => string | Promise<string>,
  ((src: string) => string | Promise<string>) | null
>({ combine: (values) => values[0] ?? null });

const imageSource = Decoration.mark({ class: "cm-lp-image-source" });

class ImageWidget extends WidgetType {
  constructor(readonly src: string, readonly alt: string) {
    super();
  }
  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-lp-image";
    const img = document.createElement("img");
    img.alt = this.alt;
    img.loading = "lazy";
    img.decoding = "async";
    // A broken image collapses to its alt text rather than a torn icon.
    img.addEventListener("error", () => wrap.classList.add("cm-lp-image-broken"));
    img.addEventListener("load", () => view.requestMeasure());
    const resolve = view.state.facet(imageResolverFacet);
    Promise.resolve(resolve ? resolve(this.src) : this.src)
      .then((url) => (img.src = url))
      .catch(() => wrap.classList.add("cm-lp-image-broken"));
    wrap.append(img);
    return wrap;
  }
  get estimatedHeight() {
    return 160;
  }
}

/**
 * The picture for each `![alt](src)`, as a block under its line. The source
 * stays on the line above, so the image can be edited without a mode switch.
 * Block widgets have to come from a StateField: a ViewPlugin cannot add them.
 */
export const imageDecorations: DecorationBuilder = (state, ranges) => {
  const out: Range<Decoration>[] = [];
  eachNode(state, ranges, ({ name, node }) => {
    if (name !== "Image") return;
    const url = node.getChild("URL");
    if (!url) return false;
    const marks = node.getChildren("LinkMark");
    const altFrom = marks[0]?.to ?? node.from;
    const altTo = marks.find((m) => state.sliceDoc(m.from, m.to) === "]")?.from ?? altFrom;
    const widget = new ImageWidget(state.sliceDoc(url.from, url.to), state.sliceDoc(altFrom, altTo));
    out.push(Decoration.widget({ widget, block: true, side: 1 }).range(state.doc.lineAt(node.to).to));
    out.push(imageSource.range(node.from, node.to));
    return false;
  });
  return out;
};

export const images = () =>
  StateField.define<DecorationSet>({
    create: (state) => Decoration.set(imageDecorations(state, wholeDoc(state)), true),
    update(value, tr) {
      if (!tr.docChanged && syntaxTree(tr.startState) === syntaxTree(tr.state)) return value;
      return Decoration.set(imageDecorations(tr.state, wholeDoc(tr.state)), true);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
