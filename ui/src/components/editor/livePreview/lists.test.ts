import { describe, expect, it } from "vitest";
import { listDecorations } from "./lists";
import { decorations, stateOf } from "./testUtil";

const bullets = (doc: string) =>
  decorations(stateOf(doc), listDecorations).map((d) => `${d.text}:${(d.spec.widget as { depth: number }).depth}`);

describe("lists", () => {
  it("draws bullets with a glyph per nesting depth", () => {
    expect(bullets("- a\n  * b\n    + c")).toEqual(["-:0", "*:1", "+:2"]);
  });

  it("keeps ordered numbers and task markers as they are", () => {
    expect(bullets("1. one\n2. two\n\n- [ ] task")).toEqual([]);
  });

  it("shows the marker the caret is on", () => {
    expect(decorations(stateOf("‸- a\n- b"), listDecorations).map((d) => d.from)).toEqual([4]);
  });
});
