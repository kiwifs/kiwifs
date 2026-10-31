/*
 * Task list checkboxes. The widget handling (resolving the position at click
 * time, the touch path) follows SilverBullet's client/codemirror/syntax/task.ts
 * (MIT, Copyright 2022 Zef Hemel). See THIRD_PARTY_NOTICES.md.
 */
import type { Range } from "@codemirror/state";
import { Decoration, type EditorView, WidgetType } from "@codemirror/view";
import { type DecorationBuilder, decorationPlugin, eachNode, selectionTouches } from "./util";

/** Flip the task box on the line holding `pos`: `[ ]` <-> `[x]`. */
export function toggleTaskAt(view: EditorView, pos: number): boolean {
  const line = view.state.doc.lineAt(pos);
  const match = /\[([ xX])\]/.exec(line.text.slice(pos - line.from));
  if (!match) return false;
  const at = pos + match.index + 1;
  view.dispatch({
    changes: { from: at, to: at + 1, insert: match[1] === " " ? "x" : " " },
    userEvent: "input.toggle",
  });
  return true;
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("span");
    wrap.className = "cm-lp-task";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.checked;
    box.setAttribute("aria-label", this.checked ? "Mark task not done" : "Mark task done");
    // Toggle on press and swallow the click, so tapping a box neither moves
    // the caret (which would reveal the raw `[ ]`) nor opens the keyboard.
    const toggle = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      // Read the position now: edits since toDOM may have moved the task.
      toggleTaskAt(view, view.posAtDOM(wrap));
    };
    let moved = false;
    box.addEventListener("mousedown", toggle);
    box.addEventListener("click", (e) => e.preventDefault());
    box.addEventListener("touchstart", () => (moved = false), { passive: true });
    box.addEventListener("touchmove", () => (moved = true), { passive: true });
    box.addEventListener("touchend", (event) => {
      if (!moved) toggle(event);
    });
    box.addEventListener("keydown", (event) => {
      if (event.key === " " || event.key === "Enter") toggle(event);
    });
    wrap.append(box);
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

const boxes = { true: Decoration.replace({ widget: new CheckboxWidget(true) }), false: Decoration.replace({ widget: new CheckboxWidget(false) }) };

/** `- [ ]` and `- [x]` drawn as a checkbox, bullet included. */
export const taskDecorations: DecorationBuilder = (state, ranges) => {
  const out: Range<Decoration>[] = [];
  eachNode(state, ranges, ({ name, node }) => {
    if (name !== "TaskMarker") return;
    const mark = node.parent?.parent?.getChild("ListMark");
    const from = mark?.from ?? node.from;
    if (selectionTouches(state, from, node.to)) return;
    const checked = /x/i.test(state.sliceDoc(node.from, node.to));
    out.push(boxes[`${checked}`].range(from, node.to));
  });
  return out;
};

export const tasks = () => decorationPlugin(taskDecorations);
