// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  adaptMermaidColors,
  contrastRatio,
  darkVariant,
  mermaidInitConfig,
  mermaidNodeId,
  mermaidThemeVariables,
  parseMermaidClicks,
  parseMermaidEdgeId,
  parseMermaidMeta,
  parseRgb,
  replaceCssVars,
  toHex,
} from "./mermaidTheme";

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

describe("theme colours", () => {
  it("turns space-separated hsl into hex, which Mermaid's colour maths can read", () => {
    expect(toHex("hsl(0 0% 15%)")).toBe("#262626");
    expect(toHex("hsl(210, 100%, 50%)")).toBe("#0080ff");
    expect(toHex("#abc")).toBe("#abc");
  });

  it("parses hex and rgb, and treats transparent as no colour", () => {
    expect(parseRgb("#dcfce7")).toEqual([220, 252, 231]);
    expect(parseRgb("rgb(1, 2, 3)")).toEqual([1, 2, 3]);
    expect(parseRgb("rgba(0, 0, 0, 0)")).toBeNull();
    expect(parseRgb("none")).toBeNull();
  });

  it("gives every diagram type a palette instead of greys", () => {
    for (const theme of ["dark", "light"] as const) {
      const vars = mermaidThemeVariables(theme);
      const pies = Array.from({ length: 12 }, (_, i) => vars[`pie${i + 1}`]);
      expect(new Set(pies).size).toBe(12);
      for (let i = 0; i < 12; i++) {
        const fill = parseRgb(String(vars[`cScale${i}`]))!;
        const label = parseRgb(String(vars[`cScaleLabel${i}`]))!;
        expect(contrastRatio(fill, label)).toBeGreaterThan(4.5);
      }
      const node = parseRgb(String(vars.primaryColor))!;
      expect(contrastRatio(node, parseRgb(String(vars.primaryTextColor))!)).toBeGreaterThan(4.5);
      expect(String(vars.lineColor)).toMatch(/^#/);
    }
  });

  it("puts size-changing styles in themeCSS so Mermaid measures them", () => {
    const css = mermaidInitConfig("dark").themeCSS;
    expect(css).toContain("font-weight: 600");
    expect(css).toContain("border-radius: 999px");
  });
});

describe("darkVariant", () => {
  it("keeps the author's hue, taken from the stroke when it has one", () => {
    const green = darkVariant([220, 252, 231], [22, 163, 74]);
    expect(contrastRatio(green.fill, green.text)).toBeGreaterThan(7);
    expect(green.fill[1]).toBeGreaterThan(green.fill[0]);
    const grey = darkVariant([243, 244, 246], [107, 114, 128]);
    expect(Math.max(...grey.fill) - Math.min(...grey.fill)).toBeLessThan(16);
  });
});

describe("adaptMermaidColors", () => {
  const svg = (fill: string, color: string) => {
    const host = document.createElement("div");
    host.innerHTML = `<svg><g class="node"><rect style="fill:${fill};stroke:#16a34a"></rect><foreignObject><div><span class="nodeLabel" style="color:${color}">Replica</span></div></foreignObject></g></svg>`;
    document.body.appendChild(host);
    return host;
  };

  it("swaps a pastel classDef for a dark tint in dark mode", () => {
    const host = svg("#dcfce7", "#14532d");
    adaptMermaidColors(host, "dark");
    const rect = host.querySelector("rect")!;
    const label = host.querySelector<HTMLElement>(".nodeLabel")!;
    const fill = parseRgb(rect.style.getPropertyValue("fill"))!;
    const text = parseRgb(label.style.getPropertyValue("color"))!;
    expect(contrastRatio(fill, text)).toBeGreaterThan(7);
    host.remove();
  });

  it("leaves light-mode author colours alone when they read", () => {
    const host = svg("#dcfce7", "#14532d");
    adaptMermaidColors(host, "light");
    expect(host.querySelector("rect")!.style.getPropertyPriority("fill")).toBe("");
    expect(host.querySelector<HTMLElement>(".nodeLabel")!.style.getPropertyPriority("color")).toBe("");
    host.remove();
  });

  it("fixes a label that vanishes into its fill", () => {
    const host = svg("#1f2937", "#111111");
    adaptMermaidColors(host, "light");
    expect(host.querySelector<HTMLElement>(".nodeLabel")!.style.getPropertyValue("color")).toBe("#f3f4f6");
    host.remove();
  });
});
