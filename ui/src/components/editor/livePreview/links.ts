import { Facet, type Range } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { type DecorationBuilder, decorationPlugin, eachNode, hidden, selectionTouches } from "./util";

/** Opens a link the user Cmd/Ctrl-clicked; the editor's host decides how. */
export const openLinkFacet = Facet.define<(href: string) => void, ((href: string) => void) | null>({
  combine: (values) => values[0] ?? null,
});

function linkMark(href: string) {
  return Decoration.mark({ class: "cm-lp-link", attributes: { "data-lp-href": href } });
}

/**
 * `[text](url "title")` shows as `text`, styled as a link; `<url>` loses its
 * angle brackets. Reference and shortcut links (`[text][ref]`, `[text]`) are
 * left alone: so are `[[wiki links]]` and `[!callout]` markers, which the
 * grammar reads as shortcut links.
 */
export const linkDecorations: DecorationBuilder = (state, ranges) => {
  const out: Range<Decoration>[] = [];
  eachNode(state, ranges, ({ name, from, to, node }) => {
    if (name !== "Link" && name !== "Autolink") return;
    const url = node.getChild("URL");
    if (!url) return false;
    const href = state.sliceDoc(url.from, url.to);
    const marks = node.getChildren("LinkMark");
    if (name === "Autolink") {
      out.push(linkMark(href).range(url.from, url.to));
      if (!selectionTouches(state, from, to)) {
        out.push(hidden.range(from, url.from), hidden.range(url.to, to));
      }
      return false;
    }
    const open = marks[0];
    const close = marks.find((m) => state.sliceDoc(m.from, m.to) === "]");
    if (!open || !close || close.to >= to) return false;
    if (close.from > open.to) out.push(linkMark(href).range(open.to, close.from));
    if (!selectionTouches(state, from, to)) {
      out.push(hidden.range(open.from, open.to), hidden.range(close.from, to));
    }
    return false;
  });
  return out;
};

const openOnModClick = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return false;
    const target = (event.target as Element | null)?.closest?.("[data-lp-href]");
    const href = target?.getAttribute("data-lp-href");
    if (!href) return false;
    event.preventDefault();
    const open = view.state.facet(openLinkFacet);
    if (open) open(href);
    else window.open(href, "_blank", "noopener,noreferrer");
    return true;
  },
});

export const links = () => [decorationPlugin(linkDecorations), openOnModClick];
