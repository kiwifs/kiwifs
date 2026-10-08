import { describe, expect, it } from "vitest";
import { wikiLinksToText } from "./typstCompiler";

describe("wikiLinksToText", () => {
  it("uses the label, falling back to the target", () => {
    expect(wikiLinksToText("See [[a/b|Label]] and [[page]].")).toBe("See Label and page.");
  });

  it("handles the escaped pipe used inside table cells", () => {
    expect(wikiLinksToText("| 1 | [[a/_index\\|Basic]] |")).toBe("| 1 | Basic |");
  });

  it("drops embeds", () => {
    expect(wikiLinksToText("x ![[diagram.png|300]] y")).toBe("x  y");
  });

  it("leaves inline code and fenced blocks alone", () => {
    const md = "`grid = [[0]]`\n\n```py\nm = [[1]]\n```\n[[real]]";
    expect(wikiLinksToText(md)).toBe("`grid = [[0]]`\n\n```py\nm = [[1]]\n```\nreal");
  });
});
