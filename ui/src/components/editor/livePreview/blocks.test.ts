import { describe, expect, it } from "vitest";
import { blockDecorations } from "./blocks";
import { decorations, lineClasses, replaced, stateOf } from "./testUtil";

describe("blocks", () => {
  it("bars quote lines and hides their markers", () => {
    const state = stateOf("> one\n> two");
    expect(lineClasses(state, blockDecorations)).toEqual([
      "1: cm-lp-quote cm-lp-quote-first",
      "2: cm-lp-quote cm-lp-quote-last",
    ]);
    expect(replaced(state, blockDecorations)).toEqual(["> ", "> "]);
  });

  it("classes callouts by type", () => {
    const state = stateOf("> [!quiz] Which?\n> - [x] this");
    expect(lineClasses(state, blockDecorations)[0]).toBe("1: cm-lp-quote cm-lp-callout cm-lp-callout-quiz cm-lp-quote-first");
  });

  it("shows quote markers while the caret is in the quote", () => {
    expect(replaced(stateOf("> on‸e\n> two"), blockDecorations)).toEqual([]);
  });

  it("draws a rule away from the caret", () => {
    expect(decorations(stateOf("a\n\n***\n\nb"), blockDecorations).filter((d) => d.spec.widget).map((d) => d.text)).toEqual(["***"]);
    expect(decorations(stateOf("a\n\n**‸*\n\nb"), blockDecorations).filter((d) => d.spec.widget)).toEqual([]);
  });

  it("gives code a monospace class", () => {
    const state = stateOf("Use `x`.\n\n```\ncode\n```");
    expect(decorations(state, blockDecorations).filter((d) => d.spec.class === "cm-lp-code").map((d) => d.text)).toEqual(["`x`"]);
    expect(lineClasses(state, blockDecorations)).toEqual(["3: cm-lp-codeblock", "4: cm-lp-codeblock", "5: cm-lp-codeblock"]);
  });
});
