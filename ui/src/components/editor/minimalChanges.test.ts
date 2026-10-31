import { ChangeSet, EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { minimalChanges } from "./minimalChanges";

function apply(before: string, after: string) {
  const changes = ChangeSet.of(minimalChanges(before, after), before.length);
  return changes.apply(EditorState.create({ doc: before }).doc).toString();
}

describe("minimalChanges", () => {
  it.each([
    ["", "new"],
    ["old", ""],
    ["a\nb\nc", "a\nB\nc"],
    ["a\nb\nc\n", "x\na\nb\nc\ny\n"],
    ["# T\n\npara one\n\npara two\n", "# T\n\npara one, edited\n\ninserted\n\npara two\n"],
    ["a\n\n\nb", "a\nb"],
    ["same", "same"],
    ["a\nb", "a\nb\nc"],
    ["a\na\na\na", "a\na\na\na\na"],
    ["a\nb\nc", "a"],
    ["a\nb", "a\nb\n"],
    ["a\nb\n", "a\nb"],
  ])("turns %j into %j", (before, after) => {
    expect(apply(before, after)).toBe(after);
  });

  it("turns any text into any other", () => {
    let seed = 1;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const lines = ["a", "b", "", "# h", "- x", "```"];
    const text = () =>
      Array.from({ length: rand(7) }, () => lines[rand(lines.length)]).join("\n") + (rand(2) ? "\n" : "");
    for (let n = 0; n < 5000; n++) {
      const before = text();
      const after = text();
      expect(apply(before, after), JSON.stringify({ before, after })).toBe(after);
    }
  });

  it("touches only what changed, in several places", () => {
    const before = "one\ntwo\nthree\nfour\nfive";
    const after = "one\nTWO\nthree\nfour\nfive!";
    expect(minimalChanges(before, after)).toEqual([
      { from: 4, to: 7, insert: "TWO" },
      { from: 23, to: 23, insert: "!" },
    ]);
  });

  it("keeps a caret after an edit above it on its word", () => {
    const before = "intro\n\nthe caret is here\n";
    const after = "a longer intro paragraph\n\nthe caret is here\n";
    const caret = before.indexOf("here");
    const state = EditorState.create({ doc: before, selection: EditorSelection.cursor(caret) });
    const next = state.update({ changes: minimalChanges(before, after) }).state;
    expect(next.sliceDoc(next.selection.main.head, next.selection.main.head + 4)).toBe("here");
  });
});
