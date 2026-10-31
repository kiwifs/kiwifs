/*
 * Hide inline markdown syntax (`**`, `*`, `_`, `~~`, `` ` ``, heading `#`)
 * unless the selection touches the element it belongs to.
 *
 * Adapted from SilverBullet's client/codemirror/syntax/hide_mark.ts (MIT,
 * Copyright 2022 Zef Hemel), which forks Ixora by Pranav Karawale
 * (Apache-2.0). See THIRD_PARTY_NOTICES.md.
 */
import type { Range } from "@codemirror/state";
import type { Decoration } from "@codemirror/view";
import { type DecorationBuilder, decorationPlugin, eachNode, hidden, selectionTouches } from "./util";

const WITH_MARKS = new Set(["Emphasis", "StrongEmphasis", "Strikethrough", "InlineCode"]);
const MARKS = new Set(["EmphasisMark", "StrikethroughMark", "CodeMark"]);

export const hideMarkDecorations: DecorationBuilder = (state, ranges) => {
  const out: Range<Decoration>[] = [];
  eachNode(state, ranges, ({ name, from, to, node }) => {
    if (name.startsWith("ATXHeading")) {
      const mark = node.getChild("HeaderMark");
      if (!mark || selectionTouches(state, from, to)) return;
      // The mark and the space after it; a closing `##` sequence stays.
      const end = Math.min(to, mark.to + (state.sliceDoc(mark.to, mark.to + 1) === " " ? 1 : 0));
      if (end > mark.from && end < to) out.push(hidden.range(mark.from, end));
      return;
    }
    if (!WITH_MARKS.has(name)) return;
    // An element nested in one being edited is revealed with its parent.
    if (selectionTouches(state, from, to)) return false;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (MARKS.has(child.name)) out.push(hidden.range(child.from, child.to));
    }
  });
  return out;
};

export const hideMarks = () => decorationPlugin(hideMarkDecorations);
