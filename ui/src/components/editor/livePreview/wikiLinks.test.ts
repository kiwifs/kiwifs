import { describe, expect, it } from "vitest";
import { decorations, replaced, stateOf } from "./testUtil";
import { wikiLinkDecorations, wikiLinkFacet, wikiTargetPage } from "./wikiLinks";

const pages = new Set(["guides/setup.md"]);
const resolve = (target: string) => (target.toLowerCase() === "setup" ? "guides/setup.md" : pages.has(target) ? target : null);

describe("wikiLinks", () => {
  it("shows the label or the target and hides the brackets", () => {
    const state = stateOf("Read [[setup]] or [[setup|the setup guide]].", [wikiLinkFacet.of({ resolve })]);
    expect(replaced(state, wikiLinkDecorations)).toEqual(["[[", "]]", "[[setup|", "]]"]);
    const marks = decorations(state, wikiLinkDecorations).filter((d) => d.spec.class);
    expect(marks.map((d) => [d.text, d.spec.attributes["data-lp-wiki"]])).toEqual([
      ["setup", "setup"],
      ["the setup guide", "setup"],
    ]);
  });

  it("marks links to missing pages", () => {
    const state = stateOf("[[setup]] and [[nowhere]]", [wikiLinkFacet.of({ resolve })]);
    expect(decorations(state, wikiLinkDecorations).filter((d) => d.spec.class).map((d) => d.spec.class)).toEqual([
      "cm-lp-wikilink",
      "cm-lp-wikilink cm-lp-wikilink-broken",
    ]);
  });

  it("reveals the brackets while the caret touches the link", () => {
    expect(replaced(stateOf("[[set‸up]]"), wikiLinkDecorations)).toEqual([]);
  });

  it("ignores links in code", () => {
    expect(decorations(stateOf("`[[a]]`\n\n```\n[[b]]\n```"), wikiLinkDecorations)).toEqual([]);
  });

  it("links a heading or block reference to its page", () => {
    expect(wikiTargetPage("playbook#Writing pages")).toBe("playbook");
    expect(wikiTargetPage("notes^abc")).toBe("notes");
  });
});
