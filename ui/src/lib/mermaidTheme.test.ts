import { describe, expect, it } from "vitest";
import { mermaidNodeId, parseMermaidClicks, replaceCssVars } from "./mermaidTheme";

describe("parseMermaidClicks", () => {
  it("reads quoted and bare hrefs", () => {
    const src = `
      graph LR
        A --> B
        click A "#the-api"
        click B href "scaling.md"
    `;
    expect(parseMermaidClicks(src)).toEqual([
      { id: "A", href: "#the-api" },
      { id: "B", href: "scaling.md" },
    ]);
  });
});

describe("mermaidNodeId", () => {
  it("strips the flowchart prefix", () => {
    expect(mermaidNodeId("flowchart-API-0")).toBe("API");
  });
});

describe("replaceCssVars", () => {
  it("inlines custom properties so a downloaded file does not depend on the page", () => {
    expect(replaceCssVars('stroke="var(--primary)"', { "--primary": "hsl(65 80% 55%)" })).toBe(
      'stroke="hsl(65 80% 55%)"',
    );
    expect(replaceCssVars("color: var(--missing, #111)", { "--foreground": "#eee" })).toBe("color: #111");
  });
});
