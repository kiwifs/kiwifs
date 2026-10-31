import type { Range } from "@codemirror/state";
import { Decoration, WidgetType } from "@codemirror/view";
import { type DecorationBuilder, decorationPlugin, eachNode, selectionTouches } from "./util";

class BulletWidget extends WidgetType {
  constructor(readonly depth: number) {
    super();
  }
  eq(other: BulletWidget) {
    return other.depth === this.depth;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-lp-bullet";
    span.textContent = ["•", "◦", "▪"][this.depth % 3];
    span.setAttribute("aria-hidden", "true");
    return span;
  }
}

const bullets = [0, 1, 2].map((depth) => Decoration.replace({ widget: new BulletWidget(depth) }));

/**
 * `-`, `*` and `+` bullets drawn as a dot, nested lists alternating glyphs.
 * Ordered-list numbers stay as typed text: they carry meaning a glyph would
 * hide. Task items keep their marker; the checkbox replaces it instead.
 */
export const listDecorations: DecorationBuilder = (state, ranges) => {
  const out: Range<Decoration>[] = [];
  eachNode(state, ranges, ({ name, node }) => {
    if (name !== "ListMark" || node.parent?.parent?.name !== "BulletList") return;
    const item = node.parent;
    if (item.getChild("Task")) return;
    if (selectionTouches(state, node.from, node.to)) return;
    let depth = 0;
    for (let p = item.parent?.parent; p; p = p.parent) if (p.name === "BulletList") depth++;
    out.push(bullets[depth % 3].range(node.from, node.to));
  });
  return out;
};

export const lists = () => decorationPlugin(listDecorations);
