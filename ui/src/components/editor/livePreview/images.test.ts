import { describe, expect, it } from "vitest";
import { imageDecorations } from "./images";
import { decorations, stateOf } from "./testUtil";

describe("images", () => {
  it("puts a block widget after each image's line", () => {
    const state = stateOf("Intro ![a diagram](./d.png) text\n\n![](/x.png)");
    const found = decorations(state, imageDecorations).filter((d) => d.spec.widget);
    expect(found.map((d) => [d.from, d.spec.block, (d.spec.widget as { src: string; alt: string }).src])).toEqual([
      [state.doc.line(1).to, true, "./d.png"],
      [state.doc.line(3).to, true, "/x.png"],
    ]);
    expect((found[0].spec.widget as { alt: string }).alt).toBe("a diagram");
  });

  it("mutes the image's source text", () => {
    const state = stateOf("![alt](a.png)");
    expect(decorations(state, imageDecorations).filter((d) => d.spec.class).map((d) => d.text)).toEqual(["![alt](a.png)"]);
  });
});
