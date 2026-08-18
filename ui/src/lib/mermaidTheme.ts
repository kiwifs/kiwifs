/**
 * Mermaid themeVariables bound to KiwiFS design tokens, plus the CSS that
 * paints kiwi-focus / kiwi-dim after a diagram has already been laid out.
 */

export type MermaidThemeKey = "light" | "dark";

export function themeTokensForExport(theme: MermaidThemeKey = mermaidThemeKey()): Record<string, string> {
  const fallbacks: Record<string, [string, string]> = {
    "--foreground": ["hsl(0 0% 95%)", "hsl(0 0% 9%)"],
    "--background": ["hsl(0 0% 10%)", "hsl(0 0% 100%)"],
    "--card": ["hsl(0 0% 10%)", "hsl(0 0% 100%)"],
    "--muted-foreground": ["hsl(0 0% 70%)", "hsl(0 0% 45%)"],
    "--border": ["hsl(0 0% 22%)", "hsl(0 0% 90%)"],
    "--primary": ["hsl(65 80% 55%)", "hsl(65 80% 55%)"],
    "--font-sans": ["ui-sans-serif, system-ui, sans-serif", "ui-sans-serif, system-ui, sans-serif"],
  };
  const out: Record<string, string> = {};
  for (const [name, [dark, light]] of Object.entries(fallbacks)) {
    out[name] = cssVar(name, theme === "dark" ? dark : light);
  }
  return out;
}

export function replaceCssVars(svg: string, tokens: Record<string, string>): string {
  return svg.replace(/var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^)]+))?\)/gi, (_, name: string, fallback?: string) => {
    return tokens[name] || fallback?.trim() || tokens["--foreground"] || "#111";
  });
}

/** Browsers will not paint HTML-in-foreignObject when an SVG is loaded as an <img>. */
export function flattenForeignObjects(svg: SVGSVGElement, fill: string): void {
  svg.querySelectorAll("foreignObject").forEach((fo) => {
    const text = (fo.textContent || "").replace(/\s+/g, " ").trim();
    const x = Number(fo.getAttribute("x") || 0);
    const y = Number(fo.getAttribute("y") || 0);
    const w = Number(fo.getAttribute("width") || 0);
    const h = Number(fo.getAttribute("height") || 0);
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", String(x + w / 2));
    label.setAttribute("y", String(y + h / 2));
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("dominant-baseline", "middle");
    label.setAttribute("fill", fill);
    label.setAttribute("font-family", "ui-sans-serif, system-ui, sans-serif");
    label.setAttribute("font-size", "14");
    label.textContent = text;
    fo.parentNode?.replaceChild(label, fo);
  });
}

export type ExportedSvg = {
  markup: string;
  width: number;
  height: number;
  background: string;
};

export function prepareExportSvg(svgEl: SVGSVGElement, theme: MermaidThemeKey = mermaidThemeKey()): ExportedSvg {
  const tokens = themeTokensForExport(theme);
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");

  flattenForeignObjects(clone, tokens["--foreground"] || "#111");

  const vb = svgEl.viewBox?.baseVal;
  const rect = svgEl.getBoundingClientRect();
  let width = (vb && vb.width) || rect.width || 0;
  let height = (vb && vb.height) || rect.height || 0;
  if ((!width || !height) && typeof svgEl.getBBox === "function") {
    try {
      const box = svgEl.getBBox();
      width = width || box.width + Math.max(box.x, 0);
      height = height || box.height + Math.max(box.y, 0);
    } catch {
      /* detached SVG */
    }
  }
  width = Math.max(Math.ceil(width), 1);
  height = Math.max(Math.ceil(height), 1);
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  if (!clone.getAttribute("viewBox") && vb) {
    clone.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.width} ${vb.height}`);
  }

  const serialized = new XMLSerializer().serializeToString(clone);
  const markup = replaceCssVars(
    `<?xml version="1.0" encoding="UTF-8"?>${serialized}`,
    tokens,
  );
  return { markup, width, height, background: tokens["--card"] || tokens["--background"] || "#fff" };
}

export function mermaidThemeKey(): MermaidThemeKey {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function mermaidThemeVariables(theme: MermaidThemeKey = mermaidThemeKey()): Record<string, string> {
  const foreground = cssVar("--foreground", theme === "dark" ? "hsl(0 0% 95%)" : "hsl(0 0% 9%)");
  const background = cssVar("--card", theme === "dark" ? "hsl(0 0% 10%)" : "hsl(0 0% 100%)");
  const muted = cssVar("--muted", theme === "dark" ? "hsl(0 0% 16%)" : "hsl(0 0% 96%)");
  const mutedFg = cssVar("--muted-foreground", theme === "dark" ? "hsl(0 0% 70%)" : "hsl(0 0% 45%)");
  const border = cssVar("--border", theme === "dark" ? "hsl(0 0% 22%)" : "hsl(0 0% 90%)");
  const primary = cssVar("--primary", "hsl(65 80% 55%)");
  const font = cssVar("--font-sans", "ui-sans-serif, system-ui, sans-serif");

  return {
    darkMode: theme === "dark" ? "true" : "false",
    background,
    primaryColor: muted,
    secondaryBorderColor: primary,
    primaryTextColor: foreground,
    primaryBorderColor: border,
    secondaryColor: muted,
    tertiaryColor: background,
    lineColor: mutedFg,
    textColor: foreground,
    mainBkg: muted,
    nodeBorder: border,
    clusterBkg: background,
    clusterBorder: border,
    titleColor: foreground,
    edgeLabelBackground: background,
    actorBkg: muted,
    actorBorder: border,
    actorTextColor: foreground,
    actorLineColor: mutedFg,
    signalColor: mutedFg,
    signalTextColor: foreground,
    labelBoxBkgColor: muted,
    labelBoxBorderColor: border,
    labelTextColor: foreground,
    loopTextColor: foreground,
    noteBkgColor: muted,
    noteTextColor: foreground,
    noteBorderColor: border,
    sequenceNumberColor: foreground,
    fontFamily: font,
    fontSize: "15px",
  };
}

export function mermaidInitConfig(theme: MermaidThemeKey = mermaidThemeKey()) {
  return {
    startOnLoad: false,
    securityLevel: "strict" as const,
    theme: "base" as const,
    themeVariables: mermaidThemeVariables(theme),
    flowchart: {
      htmlLabels: true,
      curve: "basis" as const,
      padding: 18,
      nodeSpacing: 42,
      rankSpacing: 52,
    },
    sequence: {
      actorMargin: 48,
      messageMargin: 36,
      boxMargin: 12,
      useMaxWidth: true,
    },
  };
}

/** Shadow-DOM stylesheet: tokens + focus/dim + clickable cursor. */
export function mermaidShadowStyles(): string {
  return `
    :host { display: block; color: var(--foreground); }
    svg {
      display: block;
      width: 100%;
      max-width: 100%;
      height: auto;
      font-family: var(--font-sans);
    }
    .node, .actor, .cluster, .edgePath, .messageLine0, .messageLine1, .loopLine {
      transition: opacity 180ms ease, filter 180ms ease;
    }
    .kiwi-dim {
      opacity: 0.28;
    }
    .kiwi-focus > rect,
    .kiwi-focus > polygon,
    .kiwi-focus > circle,
    .kiwi-focus > path,
    .actor.kiwi-focus rect {
      stroke: var(--primary) !important;
      stroke-width: 2.4px !important;
    }
    .node[data-kiwi-clickable],
    .actor[data-kiwi-clickable],
    .cluster[data-kiwi-clickable] {
      cursor: pointer;
    }
    .node[data-kiwi-clickable]:hover > rect,
    .node[data-kiwi-clickable]:hover > polygon,
    .actor[data-kiwi-clickable]:hover rect {
      stroke: var(--primary) !important;
    }
  `;
}

export type MermaidClick = {
  id: string;
  href: string;
};

const CLICK_RE = /^\s*click\s+(\S+)\s+(?:href\s+)?(?:"([^"]+)"|'([^']+)'|(\S+))/i;

export function parseMermaidClicks(source: string): MermaidClick[] {
  const out: MermaidClick[] = [];
  for (const line of source.split(/\r?\n/)) {
    const m = line.match(CLICK_RE);
    if (!m) continue;
    const href = m[2] || m[3] || m[4] || "";
    if (!href || href === "call" || href === "callback") continue;
    out.push({ id: m[1]!, href });
  }
  return out;
}

/** Mermaid ids look like `flowchart-C-0` or `actor0`. Prefer an exact suffix match. */
export function mermaidNodeId(svgId: string): string {
  const raw = svgId.replace(/^flowchart-/, "").replace(/^-[0-9]+$/, "");
  const trimmed = svgId.replace(/-[0-9]+$/, "");
  const parts = trimmed.split("-");
  return parts.length > 1 ? parts[parts.length - 1]! : raw || svgId;
}

export function findMermaidNodes(root: ParentNode, id: string): Element[] {
  const matches: Element[] = [];
  const nodes = root.querySelectorAll<SVGGElement>("g.node, g.actor, g.cluster, g[id]");
  nodes.forEach((el) => {
    const raw = el.id || "";
    if (!raw) return;
    if (raw === id || raw.endsWith(`-${id}`) || raw.includes(`-${id}-`) || mermaidNodeId(raw) === id) {
      matches.push(el);
    }
    // flowchart-C-0
    const m = raw.match(/^flowchart-(.+)-(\d+)$/);
    if (m && m[1] === id) matches.push(el);
  });
  return [...new Set(matches)];
}

export function applyMermaidEmphasis(root: ParentNode, focus: string[], dim: string[]): void {
  const focusSet = new Set(focus);
  const dimSet = new Set(dim);
  const nodes = root.querySelectorAll<SVGGElement>("g.node, g.actor, g.cluster");
  nodes.forEach((el) => {
    const id = mermaidNodeId(el.id);
    const flowchart = el.id.match(/^flowchart-(.+)-(\d+)$/);
    const key = flowchart?.[1] ?? id;
    const isFocus = focusSet.has(key) || focusSet.has(id);
    const isDim = dimSet.has(key) || dimSet.has(id) || (focusSet.size > 0 && !isFocus);
    el.classList.toggle("kiwi-focus", isFocus);
    el.classList.toggle("kiwi-dim", isDim && !isFocus);
  });
  root.querySelectorAll<SVGGElement>("g.edgePath, g.flowchart-link, path.messageLine0, path.messageLine1").forEach((el) => {
    if (focusSet.size === 0) {
      el.classList.remove("kiwi-dim");
      return;
    }
    // Dim edges whose endpoints are both dimmed — best-effort from edge id.
    el.classList.toggle("kiwi-dim", true);
  });
  // Re-lighten edges that mention a focused node in their id.
  if (focusSet.size > 0) {
    root.querySelectorAll<SVGGElement>("g.edgePath, g.flowchart-link").forEach((el) => {
      const raw = el.id || "";
      const mentions = [...focusSet].some((id) => raw.includes(id));
      if (mentions) el.classList.remove("kiwi-dim");
    });
  }
}
