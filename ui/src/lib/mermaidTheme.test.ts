import { describe, expect, it } from "vitest";
import { mermaidNodeId, parseMermaidClicks, parseMermaidEdgeId, parseMermaidMeta, replaceCssVars } from "./mermaidTheme";

describe("parseMermaidEdgeId", () => {
  it("splits on the boundary between two known node ids", () => {
    expect(parseMermaidEdgeId("L_API_DB_0", new Set(["API", "DB"]))).toEqual({ from: "API", to: "DB" });
    expect(parseMermaidEdgeId("L_api_gw_user_db_2", new Set(["api_gw", "user_db"]))).toEqual({ from: "api_gw", to: "user_db" });
    expect(parseMermaidEdgeId("not-an-edge", new Set())).toBeNull();
  });
});

describe("parseMermaidMeta", () => {
  it("reads quoted, single-quoted, and bare lists", () => {
    expect(parseMermaidMeta('focus="A, B" dim=C')).toEqual({ focus: ["A", "B"], dim: ["C"] });
    expect(parseMermaidMeta("focus='G->S'")).toEqual({ focus: ["G->S"], dim: [] });
    expect(parseMermaidMeta(undefined)).toEqual({ focus: [], dim: [] });
  });
});

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
