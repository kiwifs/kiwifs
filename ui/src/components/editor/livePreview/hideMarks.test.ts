import { describe, expect, it } from "vitest";
import { hideMarkDecorations } from "./hideMarks";
import { replaced, stateOf } from "./testUtil";

describe("hideMarks", () => {
  it("hides emphasis, strong, strike and code marks away from the caret", () => {
    const state = stateOf("Some *em*, **strong**, _under_, ~~gone~~ and `code`.");
    expect(replaced(state, hideMarkDecorations)).toEqual(["*", "*", "**", "**", "_", "_", "~~", "~~", "`", "`"]);
  });

  it("reveals only the element the caret touches", () => {
    const state = stateOf("A **bo‸ld** and *em* word.");
    expect(replaced(state, hideMarkDecorations)).toEqual(["*", "*"]);
  });

  it("reveals marks with the caret right after the element", () => {
    expect(replaced(stateOf("A **bold**‸ word."), hideMarkDecorations)).toEqual([]);
  });

  it("reveals nested marks with their parent", () => {
    expect(replaced(stateOf("**bold *a‸nd em***"), hideMarkDecorations)).toEqual([]);
  });

  it("hides heading marks and their space, not the heading text", () => {
    expect(replaced(stateOf("## Title"), hideMarkDecorations)).toEqual(["## "]);
    expect(replaced(stateOf("## Ti‸tle"), hideMarkDecorations)).toEqual([]);
  });

  it("leaves an empty heading alone", () => {
    expect(replaced(stateOf("#"), hideMarkDecorations)).toEqual([]);
  });

  it("does not touch the frontmatter", () => {
    expect(replaced(stateOf("---\ntitle: *x*\n---\n\n*em*"), hideMarkDecorations)).toEqual(["*", "*"]);
  });
});
