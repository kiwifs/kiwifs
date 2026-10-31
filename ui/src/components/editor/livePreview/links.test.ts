import { describe, expect, it } from "vitest";
import { linkDecorations } from "./links";
import { decorations, replaced, stateOf } from "./testUtil";

describe("links", () => {
  it("shows only the link text, marked with its target", () => {
    const state = stateOf('See [the docs](https://kiwifs.dev "Docs") now.');
    expect(replaced(state, linkDecorations)).toEqual(["[", '](https://kiwifs.dev "Docs")']);
    const mark = decorations(state, linkDecorations).find((d) => d.spec.attributes);
    expect(mark?.text).toBe("the docs");
    expect(mark?.spec.attributes["data-lp-href"]).toBe("https://kiwifs.dev");
  });

  it("drops the angle brackets of an autolink", () => {
    expect(replaced(stateOf("Go to <https://x.dev>."), linkDecorations)).toEqual(["<", ">"]);
  });

  it("reveals the whole link while the caret is in it", () => {
    expect(replaced(stateOf("See [do‸cs](a.md)."), linkDecorations)).toEqual([]);
  });

  it("leaves reference links, wiki links and callout markers alone", () => {
    const state = stateOf("A [ref][1], a [[wiki]], a [shortcut].\n\n> [!note] x\n\n[1]: https://x");
    expect(decorations(state, linkDecorations)).toEqual([]);
  });
});
