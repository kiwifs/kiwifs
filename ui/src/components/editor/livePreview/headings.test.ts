import { describe, expect, it } from "vitest";
import { headingDecorations } from "./headings";
import { lineClasses, stateOf } from "./testUtil";

describe("headings", () => {
  it("sizes ATX and setext heading lines by level", () => {
    const state = stateOf("# One\n\n### Three\n\nSetext\n======\n\nBody");
    expect(lineClasses(state, headingDecorations)).toEqual([
      "1: cm-lp-heading cm-lp-h1",
      "3: cm-lp-heading cm-lp-h3",
      "5: cm-lp-heading cm-lp-h1",
      "6: cm-lp-heading cm-lp-h1",
    ]);
  });
});
