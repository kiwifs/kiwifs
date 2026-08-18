import { describe, expect, it } from "vitest";
import remarkDirective from "remark-directive";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { CLAIM_DATA_ATTRIBUTES, claimProperties, remarkKiwiDirectives } from "./remarkDirectives";
import { kiwiSanitizeSchema } from "./kiwiMarkdown";

/**
 * Run the real remark pipeline and hand back the transformed mdast. This is a
 * pure AST test — the UI has no React render harness, and the thing worth
 * pinning is the node → HTML-properties mapping, not the pixels.
 */
function transform(markdown: string): any {
  return unified()
    .use(remarkParse)
    .use(remarkDirective)
    .use(remarkKiwiDirectives)
    .runSync(unified().use(remarkParse).use(remarkDirective).parse(markdown));
}

function findByDirective(tree: any, directive: string): any[] {
  const out: any[] = [];
  const walk = (node: any) => {
    if (node?.data?.hProperties?.["data-kiwi-directive"] === directive) out.push(node);
    for (const child of node?.children || []) walk(child);
  };
  walk(tree);
  return out;
}

describe("claimProperties", () => {
  it("maps evidence, confidence and source onto data attributes", () => {
    expect(claimProperties({ evidence: "inferred", confidence: "0.6", source: "sources/x" })).toEqual({
      "data-kiwi-directive": "claim",
      "data-evidence": "inferred",
      "data-confidence": "0.6",
      "data-source": "sources/x",
    });
  });

  // The server indexes a non-numeric confidence as null; emitting the raw
  // string here would make the badge disagree with the audit query.
  it("drops a confidence that is not a number", () => {
    const props = claimProperties({ evidence: "inferred", confidence: "high" });
    expect(props["data-confidence"]).toBeUndefined();
    expect(props["data-evidence"]).toBe("inferred");
  });

  it("omits attributes that were not written", () => {
    expect(claimProperties({})).toEqual({ "data-kiwi-directive": "claim" });
    expect(claimProperties()).toEqual({ "data-kiwi-directive": "claim" });
  });
});

describe("claim data attributes are allow-listed", () => {
  // rehype-sanitize strips any attribute not on the list, so an attribute the
  // transform emits but the schema omits vanishes silently — the claim still
  // renders, just with none of the metadata that makes it a claim.
  it("covers every attribute the transform can emit", () => {
    const emitted = Object.keys(
      claimProperties({ evidence: "inferred", confidence: "0.6", source: "sources/x" }),
    ).filter((key) => key !== "data-kiwi-directive");
    expect(emitted.sort()).toEqual([...CLAIM_DATA_ATTRIBUTES].sort());
  });

  it("is actually present in the sanitize schema", () => {
    const allowed = kiwiSanitizeSchema.attributes["*"] as string[];
    for (const attr of CLAIM_DATA_ATTRIBUTES) {
      expect(allowed).toContain(attr);
    }
  });
});

describe("remarkKiwiDirectives — claims", () => {
  it("turns a container claim into a div carrying its provenance", () => {
    const tree = transform(
      ":::claim{evidence=inferred confidence=0.6}\nA non-linear stacker wins here.\n:::\n",
    );
    const claims = findByDirective(tree, "claim");
    expect(claims).toHaveLength(1);
    expect(claims[0].data.hName).toBe("div");
    expect(claims[0].data.hProperties["data-evidence"]).toBe("inferred");
    expect(claims[0].data.hProperties["data-confidence"]).toBe("0.6");
    expect(claims[0].data.hProperties.className).toContain("kiwi-claim-block");
  });

  it("turns an inline claim into a span, not a div", () => {
    const tree = transform(
      'Also :claim[hill-climbing is worse]{evidence=stated confidence=0.9 source="sources/x"} here.\n',
    );
    const claims = findByDirective(tree, "claim");
    expect(claims).toHaveLength(1);
    expect(claims[0].data.hName).toBe("span");
    expect(claims[0].data.hProperties["data-source"]).toBe("sources/x");
    expect(claims[0].data.hProperties.className).toContain("kiwi-claim-inline");
  });

  it("keeps the claim body as children so it still renders as markdown", () => {
    const tree = transform(":::claim{evidence=stated}\nThe **target** is skewed.\n:::\n");
    const [claim] = findByDirective(tree, "claim");
    expect(claim.children.length).toBeGreaterThan(0);
  });

  it("leaves a claim with no attributes renderable", () => {
    const tree = transform(":::claim\nBare assertion.\n:::\n");
    const claims = findByDirective(tree, "claim");
    expect(claims).toHaveLength(1);
    expect(claims[0].data.hProperties["data-evidence"]).toBeUndefined();
  });
});

describe("remarkKiwiDirectives — existing directives still work", () => {
  it("does not disturb :::tabs", () => {
    const tree = transform(":::tabs\n::tab[One]\nContent.\n:::\n");
    expect(findByDirective(tree, "tabs")).toHaveLength(1);
    expect(findByDirective(tree, "claim")).toHaveLength(0);
  });

  it("turns :::figure into width/pin attributes", () => {
    const tree = transform(":::figure{width=wide pin caption=\"Write path\"}\nHello.\n:::\n");
    const figures = findByDirective(tree, "figure");
    expect(figures).toHaveLength(1);
    expect(figures[0].data.hProperties["data-width"]).toBe("wide");
    expect(figures[0].data.hProperties["data-pin"]).toBe("true");
    expect(figures[0].data.hProperties["data-caption"]).toBe("Write path");
  });

  it("does not disturb :::columns", () => {
    const tree = transform(':::columns{ratio="2:1"}\n::col\nLeft.\n:::\n');
    const columns = findByDirective(tree, "columns");
    expect(columns).toHaveLength(1);
    expect(columns[0].data.hProperties["data-ratio"]).toBe("2:1");
  });

  // A directive named something else must not be claimed by the claim branch.
  it("ignores unrelated directive names", () => {
    const tree = transform(":::note{evidence=inferred}\nNot a claim.\n:::\n");
    expect(findByDirective(tree, "claim")).toHaveLength(0);
  });
});
