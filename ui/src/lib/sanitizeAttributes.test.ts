import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkDirective from "remark-directive";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { describe, expect, it } from "vitest";

import { kiwiSanitizeSchema } from "./kiwiMarkdown";
import { remarkKiwiDirectives } from "./remarkDirectives";
import { withDataAttributeAliases } from "./sanitizeAttributes";

/**
 * The pipeline the app actually runs. rehype-raw sits between the directive
 * transform and the sanitizer, and it is the step that renames attributes —
 * testing the transform alone cannot catch a schema that stops matching here.
 */
async function render(markdown: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkDirective)
    .use(remarkKiwiDirectives)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, kiwiSanitizeSchema)
    .use(rehypeStringify)
    .process(markdown);
  return String(file);
}

describe("withDataAttributeAliases", () => {
  it("adds the hast spelling of each data attribute", () => {
    expect(withDataAttributeAliases(["data-kiwi-directive", "className"])).toEqual([
      "data-kiwi-directive",
      "className",
      "dataKiwiDirective",
    ]);
  });

  it("leaves non-data attributes and existing aliases alone", () => {
    expect(withDataAttributeAliases(["id", "data-tag", "dataTag"])).toEqual(["id", "data-tag", "dataTag"]);
  });

  it("passes through tuple entries used for fixed attribute values", () => {
    const entries = ["data-tag", ["className", "kiwi"]] as (string | [string, ...unknown[]])[];
    expect(withDataAttributeAliases(entries)).toEqual(["data-tag", ["className", "kiwi"], "dataTag"]);
  });
});

describe("directive attributes survive the full render pipeline", () => {
  it("keeps claim provenance on a block claim", async () => {
    const html = await render(':::claim{evidence=stated confidence=0.9 source=sources/reports/1}\nBody.\n:::\n');
    expect(html).toContain('data-kiwi-directive="claim"');
    expect(html).toContain('data-evidence="stated"');
    expect(html).toContain('data-confidence="0.9"');
    expect(html).toContain('data-source="sources/reports/1"');
  });

  it("keeps claim provenance on an inline claim", async () => {
    const html = await render('Text :claim[body]{evidence=inferred confidence=0.3} tail.\n');
    expect(html).toContain('data-kiwi-directive="claim"');
    expect(html).toContain('data-evidence="inferred"');
    expect(html).toContain('data-confidence="0.3"');
  });

  it("keeps the markers the tabs and columns components dispatch on", async () => {
    const tabs = await render(":::tabs\n::tab[First]\nOne.\n:::\n");
    expect(tabs).toContain('data-kiwi-directive="tabs"');
    expect(tabs).toContain('data-kiwi-directive="tab"');
    expect(tabs).toContain('data-label="First"');

    const columns = await render(":::columns{ratio=1:2}\nBody.\n:::\n");
    expect(columns).toContain('data-kiwi-directive="columns"');
    expect(columns).toContain('data-ratio="1:2"');
  });
});
