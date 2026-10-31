// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { taskDecorations, toggleTaskAt } from "./tasks";
import { decorations, stateOf } from "./testUtil";

describe("tasks", () => {
  it("replaces bullet and box with a checkbox reflecting the state", () => {
    const found = decorations(stateOf("- [ ] todo\n- [x] done\n* [X] also"), taskDecorations);
    expect(found.map((d) => [d.text, (d.spec.widget as { checked: boolean }).checked])).toEqual([
      ["- [ ]", false],
      ["- [x]", true],
      ["* [X]", true],
    ]);
  });

  it("shows the raw box while the caret is on it", () => {
    expect(decorations(stateOf("- [‸x] done"), taskDecorations)).toEqual([]);
  });

  it("toggles the box on the clicked line", () => {
    const view = new EditorView({ state: stateOf("- [ ] a\n- [x] b") });
    toggleTaskAt(view, 0);
    toggleTaskAt(view, view.state.doc.line(2).from);
    expect(view.state.doc.toString()).toBe("- [x] a\n- [ ] b\n\nend");
    view.destroy();
  });
});
