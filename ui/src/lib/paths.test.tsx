import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { describe, expect, it } from "vitest";
import { decodeHref } from "./paths";
import { buildSpaceLocation } from "./spaceUrl";
import { remarkWikiLinks } from "./wikiLinks";

describe("decodeHref", () => {
  it("keeps page URLs for paths with spaces single-encoded", () => {
    const html = renderToStaticMarkup(
      <ReactMarkdown remarkPlugins={[[remarkWikiLinks, { resolver: () => "Selfhosting - Homelab/Document Catalog.md" }]]}>
        {"[[Document Catalog|docs]] [doc](Selfhosting%20-%20Homelab/Document%20Catalog.md)"}
      </ReactMarkdown>,
    );
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/^#kiwi:/, ""));
    expect(hrefs).toHaveLength(2);
    for (const href of hrefs) {
      expect(buildSpaceLocation(null, decodeHref(href), null)).toBe(
        "/page/Selfhosting%20-%20Homelab/Document%20Catalog.md",
      );
    }
  });

  it("returns malformed escapes unchanged", () => {
    expect(decodeHref("100%.md")).toBe("100%.md");
  });
});
