import { syntaxTree } from "@codemirror/language";
import { Facet, type Range } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { type DecorationBuilder, decorationPlugin, frontmatterRange, hidden, selectionTouches } from "./util";

export type WikiLinkHandlers = {
  /** The page a target points at, or null when there is none. */
  resolve?: (target: string) => string | null;
  /** Open a resolved page. */
  navigate?: (path: string) => void;
};

export const wikiLinkFacet = Facet.define<WikiLinkHandlers, WikiLinkHandlers>({
  combine: (values) => values[0] ?? {},
});

const WIKI_LINK = /(!?)\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g;
const CODE = new Set(["InlineCode", "CodeText", "FencedCode", "CodeBlock", "CodeMark"]);

/** The page part of a target: `page#Heading` and `page^block` link to `page`. */
export function wikiTargetPage(target: string): string {
  return target.split(/[#^]/)[0].trim();
}

function inCode(state: import("@codemirror/state").EditorState, pos: number): boolean {
  for (let node: import("@lezer/common").SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (CODE.has(node.name)) return true;
  }
  return false;
}

/**
 * `[[page]]` shows as `page` and `[[page|label]]` as `label`, styled as a
 * link, red when the page does not exist. The brackets come back while the
 * selection touches the link. Completion is wikiLinkCompletion.ts's job.
 */
export const wikiLinkDecorations: DecorationBuilder = (state, ranges) => {
  const out: Range<Decoration>[] = [];
  const { resolve } = state.facet(wikiLinkFacet);
  const fm = frontmatterRange(state);
  for (const { from, to } of ranges) {
    const start = state.doc.lineAt(from);
    const text = state.sliceDoc(start.from, state.doc.lineAt(to).to);
    for (const m of text.matchAll(WIKI_LINK)) {
      const linkFrom = start.from + m.index!;
      const linkTo = linkFrom + m[0].length;
      if ((fm && linkFrom < fm.to) || inCode(state, linkFrom + m[1].length)) continue;
      const target = m[2].trim();
      const page = wikiTargetPage(target);
      const broken = resolve !== undefined && page !== "" && resolve(page) === null;
      const open = linkFrom + m[1].length;
      const labelFrom = m[3] !== undefined ? open + 2 + m[2].length + 1 : open + 2;
      const labelTo = linkTo - 2;
      out.push(
        Decoration.mark({
          class: broken ? "cm-lp-wikilink cm-lp-wikilink-broken" : "cm-lp-wikilink",
          attributes: { "data-lp-wiki": page },
        }).range(labelFrom, labelTo),
      );
      if (!selectionTouches(state, linkFrom, linkTo)) {
        out.push(hidden.range(linkFrom, labelFrom), hidden.range(labelTo, linkTo));
      }
    }
  }
  return out;
};

// A tap on a rendered link follows it; once the caret is inside the link (its
// brackets showing), a click edits it instead.
const followOnClick = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || event.shiftKey || event.altKey) return false;
    const el = (event.target as Element | null)?.closest?.("[data-lp-wiki]");
    const page = el?.getAttribute("data-lp-wiki");
    if (!el || !page) return false;
    const pos = view.posAtDOM(el);
    if (selectionTouches(view.state, pos - 2, pos + (el.textContent?.length ?? 0) + 2)) return false;
    const { resolve, navigate } = view.state.facet(wikiLinkFacet);
    const path = resolve ? resolve(page) : page;
    if (!path || !navigate) return false;
    event.preventDefault();
    navigate(path);
    return true;
  },
});

export const wikiLinks = () => [decorationPlugin(wikiLinkDecorations), followOnClick];
