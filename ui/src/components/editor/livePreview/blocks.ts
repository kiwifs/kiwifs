import type { Range } from "@codemirror/state";
import { Decoration, WidgetType } from "@codemirror/view";
import { type DecorationBuilder, decorationPlugin, eachNode, hidden, selectionTouches } from "./util";

class RuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const hr = document.createElement("span");
    hr.className = "cm-lp-hr";
    hr.setAttribute("role", "separator");
    return hr;
  }
}

const rule = Decoration.replace({ widget: new RuleWidget() });
const quoteLine = Decoration.line({ class: "cm-lp-quote" });
const codeLine = Decoration.line({ class: "cm-lp-codeblock" });
const inlineCode = Decoration.mark({ class: "cm-lp-code" });
const CALLOUT = /^\s*>\s*\[!([A-Za-z-]+)\]/;
const calloutLabel = Decoration.mark({ class: "cm-lp-callout-label" });

/**
 * Blockquotes and `> [!type]` callouts get a bar down their left edge and
 * lose their `>` markers; a `---`/`***` rule is drawn as a line. Both show
 * their source while the selection touches them. Code keeps a monospace face.
 */
export const blockDecorations: DecorationBuilder = (state, ranges) => {
  const out: Range<Decoration>[] = [];
  eachNode(state, ranges, ({ name, from, to, node }) => {
    if (name === "HorizontalRule") {
      if (!selectionTouches(state, from, to)) out.push(rule.range(from, to));
      return false;
    }
    if (name === "InlineCode") {
      out.push(inlineCode.range(from, to));
      return false;
    }
    if (name === "FencedCode" || name === "CodeBlock") {
      // A widget fence replaces these lines; the line classes then go unused.
      for (let n = state.doc.lineAt(from).number; n <= state.doc.lineAt(to).number; n++) {
        out.push(codeLine.range(state.doc.line(n).from));
      }
      return false;
    }
    if (name !== "Blockquote" || node.parent?.name === "Blockquote") return;
    const callout = CALLOUT.exec(state.doc.lineAt(from).text)?.[1]?.toLowerCase();
    const first = state.doc.lineAt(from).number;
    const last = state.doc.lineAt(to).number;
    for (let n = first; n <= last; n++) {
      const line = state.doc.line(n);
      const classes = ["cm-lp-quote"];
      if (callout) classes.push("cm-lp-callout", `cm-lp-callout-${callout}`);
      if (n === first) classes.push("cm-lp-quote-first");
      if (n === last) classes.push("cm-lp-quote-last");
      out.push((classes.length === 1 ? quoteLine : Decoration.line({ class: classes.join(" ") })).range(line.from));
    }
    if (callout) {
      const line = state.doc.lineAt(from);
      const at = line.text.indexOf("[!");
      out.push(calloutLabel.range(line.from + at, line.from + line.text.indexOf("]", at) + 1));
    }
    if (!selectionTouches(state, from, to)) {
      node.cursor().iterate((child) => {
        if (child.name !== "QuoteMark") return;
        const space = state.sliceDoc(child.to, child.to + 1) === " " ? 1 : 0;
        out.push(hidden.range(child.from, child.to + space));
      });
    }
  });
  return out;
};

export const blocks = () => decorationPlugin(blockDecorations);
