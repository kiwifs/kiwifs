import type { Range } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { type DecorationBuilder, decorationPlugin, eachNode } from "./util";

const levels = [1, 2, 3, 4, 5, 6].map((n) => Decoration.line({ class: `cm-lp-heading cm-lp-h${n}` }));

/** Heading lines get a size class; the sizes live in markdownEditorTheme.ts. */
export const headingDecorations: DecorationBuilder = (state, ranges) => {
  const out: Range<Decoration>[] = [];
  eachNode(state, ranges, ({ name, from, to }) => {
    const atx = /^ATXHeading([1-6])$/.exec(name);
    const setext = /^SetextHeading([12])$/.exec(name);
    const level = atx?.[1] ?? setext?.[1];
    if (!level) return;
    // A setext heading spans its text and the underline; style both lines.
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos);
      out.push(levels[Number(level) - 1].range(line.from));
      pos = line.to + 1;
    }
    return false;
  });
  return out;
};

export const headings = () => decorationPlugin(headingDecorations);
