import { describe, expect, it } from "vitest";
import { frontmatterDecorations } from "./frontmatter";
import { decorations, lineClasses, stateOf } from "./testUtil";

describe("frontmatter", () => {
  it("folds the YAML into a properties chip listing its keys", () => {
    const found = decorations(stateOf("---\ntitle: T\ntags:\n  - a\n---\n\nBody"), frontmatterDecorations);
    expect(found).toHaveLength(1);
    expect(found[0].text).toBe("---\ntitle: T\ntags:\n  - a\n---");
    expect((found[0].spec.widget as { keys: string[] }).keys).toEqual(["title", "tags"]);
  });

  it("shows the YAML while the caret is in it", () => {
    expect(lineClasses(stateOf("---\ntitle: ‸T\n---\n\nBody"), frontmatterDecorations)).toEqual([
      "1: cm-lp-frontmatter",
      "2: cm-lp-frontmatter",
      "3: cm-lp-frontmatter",
    ]);
  });

  it("ignores a rule that is not frontmatter", () => {
    expect(decorations(stateOf("Text\n\n---\n\nMore"), frontmatterDecorations)).toEqual([]);
  });
});
