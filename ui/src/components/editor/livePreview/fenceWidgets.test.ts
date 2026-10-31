import { describe, expect, it } from "vitest";
import { fenceDecorations, fenceRendererFacet } from "./fenceWidgets";
import { WidgetPortals } from "./portals";
import { decorations, stateOf } from "./testUtil";

const renderer = fenceRendererFacet.of({
  portals: new WidgetPortals(),
  accepts: (fence) => fence.lang === "array" || fence.lang === "mermaid",
  render: () => null,
});

const doc = "Text\n\n```array {title}\nvalues: [1]\n```\n\n```ts\nconst x = 1;\n```\n\n```mermaid\ngraph LR\n```";

describe("fenceWidgets", () => {
  it("replaces whole widget fences with a block widget and leaves code alone", () => {
    const found = decorations(stateOf(doc, [renderer]), fenceDecorations);
    expect(found.map((d) => [d.text, d.spec.block])).toEqual([
      ["```array {title}\nvalues: [1]\n```", true],
      ["```mermaid\ngraph LR\n```", true],
    ]);
    expect((found[0].spec.widget as { fence: unknown }).fence).toEqual({ lang: "array", meta: "{title}", body: "values: [1]" });
  });

  it("shows the source of the fence the caret is in", () => {
    const caret = doc.replace("values: [1]", "values: [‸1]");
    expect(decorations(stateOf(caret, [renderer]), fenceDecorations).map((d) => d.text)).toEqual(["```mermaid\ngraph LR\n```"]);
  });

  it("leaves an unclosed fence as text while it is typed", () => {
    expect(decorations(stateOf("```array\nvalues: [1]", [renderer]), fenceDecorations)).toEqual([]);
  });

  it("draws nothing without a renderer", () => {
    expect(decorations(stateOf(doc), fenceDecorations)).toEqual([]);
  });
});
