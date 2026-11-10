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
    "--muted-foreground": ["hsl(0 0% 70%)", "hsl(0 0% 40%)"],
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
  if (typeof document === "undefined") return toHex(fallback);
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return toHex(value || fallback);
}

/**
 * Mermaid derives shades from theme colours with a parser that does not read
 * space-separated `hsl(0 0% 15%)`, and silently falls back to white; hand it hex.
 */
export function toHex(color: string): string {
  const m = color.trim().match(/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/i);
  if (!m) return color;
  const [r, g, b] = hsl(Number(m[1]) % 360, Number(m[2]) / 100, Number(m[3]) / 100);
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Diagram palette. Nodes get a tinted fill with accent-coloured text rather
 * than the page's greys, so boxes read as boxes; every value can be
 * overridden with a `--kw-diagram-*` CSS variable.
 */
const DIAGRAM_PALETTE = {
  dark: {
    node: "#0f2b46",
    nodeText: "#a8d4ff",
    nodeBorder: "#24486b",
    cluster: "#232323",
    clusterBorder: "#3a3a3a",
    clusterText: "#b5b5b5",
    line: "#9b9b9b",
    edgeLabel: "#0b1824",
    edgeLabelBorder: "#24486b",
    edgeLabelText: "#cfe6ff",
    note: "#3a2f12",
    noteBorder: "#8a6d1f",
    noteText: "#fde9b0",
    activation: "#1d3a57",
  },
  light: {
    node: "#e7f1fd",
    nodeText: "#0d3f73",
    nodeBorder: "#b9d4f2",
    cluster: "#f6f7f9",
    clusterBorder: "#dfe3e8",
    clusterText: "#55606e",
    line: "#7d8590",
    edgeLabel: "#ffffff",
    edgeLabelBorder: "#c9dcf2",
    edgeLabelText: "#1d3b5e",
    note: "#fff6d6",
    noteBorder: "#e6c661",
    noteText: "#5c4300",
    activation: "#d4e6fb",
  },
} as const;

/** Categorical colours for slices, branches, series and mindmap levels. */
const SERIES = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#84cc16", "#06b6d4", "#a855f7", "#eab308"];
/** The same hues as tinted node fills, with a label colour that reads on each. */
const TINTS = {
  dark: {
    fill: ["#0f2b46", "#0b3326", "#3a2a0c", "#3f1616", "#2a1f4d", "#3d1530", "#0c3330", "#3d2210", "#26330e", "#0c2f3d", "#33194d", "#3a300a"],
    label: ["#a8d4ff", "#9be8c8", "#fcd68a", "#fcb0b0", "#cdbcff", "#f9b4dc", "#99e6da", "#fdc49a", "#cbe89a", "#9adcf0", "#ddb8ff", "#f5dd8a"],
  },
  light: {
    fill: ["#e7f1fd", "#e3f7ee", "#fdf1dc", "#fde6e6", "#efeafd", "#fce7f3", "#e0f5f3", "#feecdf", "#eef6dc", "#e0f4fa", "#f4e8fd", "#fbf3d5"],
    label: ["#0d3f73", "#0b5138", "#6b4500", "#7f1d1d", "#43307f", "#7c1d50", "#0d4f4a", "#7a3a0b", "#3c5410", "#0b4a60", "#5b2387", "#5f4a00"],
  },
} as const;

function palette(theme: MermaidThemeKey) {
  const base = DIAGRAM_PALETTE[theme];
  const out = {} as Record<keyof typeof base, string>;
  for (const key of Object.keys(base) as (keyof typeof base)[]) {
    out[key] = cssVar(`--kw-diagram-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, base[key]);
  }
  return out;
}

export function mermaidThemeVariables(theme: MermaidThemeKey = mermaidThemeKey()): Record<string, unknown> {
  const dark = theme === "dark";
  const foreground = cssVar("--foreground", dark ? "hsl(0 0% 95%)" : "hsl(0 0% 9%)");
  const background = cssVar("--card", dark ? "hsl(0 0% 10%)" : "hsl(0 0% 100%)");
  const mutedFg = cssVar("--muted-foreground", dark ? "hsl(0 0% 70%)" : "hsl(0 0% 40%)");
  const border = cssVar("--border", dark ? "hsl(0 0% 22%)" : "hsl(0 0% 90%)");
  const font = cssVar("--font-sans", "ui-sans-serif, system-ui, sans-serif");
  const p = palette(theme);
  const tints = TINTS[theme];

  const vars: Record<string, unknown> = {
    darkMode: dark,
    background,
    fontFamily: font,
    fontSize: "14px",

    primaryColor: p.node,
    primaryTextColor: p.nodeText,
    primaryBorderColor: p.nodeBorder,
    secondaryColor: tints.fill[1],
    secondaryTextColor: tints.label[1],
    secondaryBorderColor: p.nodeBorder,
    tertiaryColor: p.cluster,
    tertiaryTextColor: foreground,
    tertiaryBorderColor: p.clusterBorder,
    mainBkg: p.node,
    nodeBorder: p.nodeBorder,
    nodeTextColor: p.nodeText,
    textColor: foreground,
    titleColor: foreground,
    lineColor: p.line,
    clusterBkg: p.cluster,
    clusterBorder: p.clusterBorder,
    edgeLabelBackground: p.edgeLabel,

    // Sequence
    actorBkg: p.node,
    actorBorder: p.nodeBorder,
    actorTextColor: p.nodeText,
    actorLineColor: border,
    signalColor: p.line,
    signalTextColor: foreground,
    labelBoxBkgColor: p.cluster,
    labelBoxBorderColor: p.clusterBorder,
    labelTextColor: p.clusterText,
    loopTextColor: mutedFg,
    noteBkgColor: p.note,
    noteBorderColor: p.noteBorder,
    noteTextColor: p.noteText,
    activationBkgColor: p.activation,
    activationBorderColor: p.nodeBorder,
    sequenceNumberColor: dark ? "#0b1824" : "#ffffff",

    // State and class
    labelBackgroundColor: p.edgeLabel,
    compositeBackground: p.cluster,
    compositeTitleBackground: p.cluster,
    compositeBorder: p.clusterBorder,
    altBackground: p.cluster,
    specialStateColor: p.line,
    innerEndBackground: p.nodeBorder,
    transitionColor: p.line,
    transitionLabelColor: foreground,
    stateLabelColor: p.nodeText,
    classText: p.nodeText,
    attributeBackgroundColorOdd: dark ? "#141e29" : "#ffffff",
    attributeBackgroundColorEven: dark ? "#192635" : "#f3f8fe",

    // Requirement
    requirementBackground: p.node,
    requirementBorderColor: p.nodeBorder,
    requirementTextColor: p.nodeText,
    relationColor: p.line,
    relationLabelBackground: p.edgeLabel,
    relationLabelColor: foreground,

    // Gantt
    sectionBkgColor: dark ? "#1f2a36" : "#f1f6fd",
    altSectionBkgColor: background,
    sectionBkgColor2: dark ? "#1f2a36" : "#f1f6fd",
    taskBkgColor: SERIES[0],
    taskBorderColor: dark ? "#60a5fa" : "#2563eb",
    taskTextColor: "#ffffff",
    taskTextLightColor: "#ffffff",
    taskTextDarkColor: foreground,
    taskTextOutsideColor: foreground,
    taskTextClickableColor: dark ? "#93c5fd" : "#1d4ed8",
    activeTaskBkgColor: dark ? "#1e3a5f" : "#bfdbfe",
    activeTaskBorderColor: SERIES[0],
    doneTaskBkgColor: dark ? "#3a3a3a" : "#d4d4d8",
    doneTaskBorderColor: dark ? "#5a5a5a" : "#a1a1aa",
    critBkgColor: SERIES[3],
    critBorderColor: dark ? "#f87171" : "#b91c1c",
    gridColor: border,
    todayLineColor: SERIES[3],
    excludeBkgColor: dark ? "#202020" : "#f4f4f5",

    // Pie
    pieTitleTextColor: foreground,
    pieSectionTextColor: "#ffffff",
    pieLegendTextColor: foreground,
    pieStrokeColor: background,
    pieOuterStrokeColor: background,
    pieStrokeWidth: "2px",
    pieOuterStrokeWidth: "2px",
    pieOpacity: "1",

    // Quadrant
    quadrant1Fill: dark ? "#14283d" : "#eaf3fe",
    quadrant2Fill: dark ? "#122b22" : "#e8f7ef",
    quadrant3Fill: dark ? "#2a2a2a" : "#f4f4f5",
    quadrant4Fill: dark ? "#33260f" : "#fdf3e1",
    quadrant1TextFill: foreground,
    quadrant2TextFill: foreground,
    quadrant3TextFill: foreground,
    quadrant4TextFill: foreground,
    quadrantPointFill: SERIES[0],
    quadrantPointTextFill: foreground,
    quadrantXAxisTextFill: foreground,
    quadrantYAxisTextFill: foreground,
    quadrantTitleFill: foreground,
    quadrantInternalBorderStrokeFill: border,
    quadrantExternalBorderStrokeFill: border,

    // XY chart
    xyChart: {
      backgroundColor: background,
      titleColor: foreground,
      xAxisLabelColor: mutedFg,
      xAxisTitleColor: foreground,
      xAxisTickColor: border,
      xAxisLineColor: border,
      yAxisLabelColor: mutedFg,
      yAxisTitleColor: foreground,
      yAxisTickColor: border,
      yAxisLineColor: border,
      plotColorPalette: SERIES.join(", "),
    },

    // Git
    commitLabelColor: foreground,
    commitLabelBackground: p.cluster,
    tagLabelColor: p.nodeText,
    tagLabelBackground: p.node,
    tagLabelBorder: p.nodeBorder,

    // Architecture
    archEdgeColor: p.line,
    archEdgeArrowColor: p.line,
    archGroupBorderColor: p.clusterBorder,
  };

  SERIES.forEach((c, i) => {
    vars[`pie${i + 1}`] = c;
    if (i < 8) {
      vars[`git${i}`] = c;
      vars[`gitBranchLabel${i}`] = "#ffffff";
      vars[`gitInv${i}`] = c;
      vars[`fillType${i}`] = tints.fill[i];
    }
    // Mindmap, timeline and kanban levels.
    vars[`cScale${i}`] = tints.fill[i];
    vars[`cScaleLabel${i}`] = tints.label[i];
    vars[`cScalePeer${i}`] = SERIES[i];
    vars[`cScaleInv${i}`] = tints.label[i];
  });
  return vars;
}

/**
 * Styles that change a label's size go through Mermaid's `themeCSS`, which
 * is in place while Mermaid measures labels — bolder text or padded edge
 * labels added afterwards would overflow the boxes laid out for them.
 */
export function mermaidThemeCss(theme: MermaidThemeKey = mermaidThemeKey()): string {
  const p = palette(theme);
  const grid = cssVar("--border", theme === "dark" ? "hsl(0 0% 22%)" : "hsl(0 0% 90%)");
  return `
    .node rect.basic, .node rect.label-container, rect.actor, rect.note, .note rect { rx: 10px; ry: 10px; }
    .cluster > rect { rx: 14px; ry: 14px; }
    .nodeLabel, .node .label, text.actor, text.actor > tspan { font-weight: 600; }
    .members-group .nodeLabel, .methods-group .nodeLabel, .label[class*="attribute-"] .nodeLabel { font-weight: 400; }
    .cluster-label .nodeLabel, .cluster-label span, .cluster text { font-weight: 600; color: ${p.clusterText}; fill: ${p.clusterText}; }
    .flowchart-link, .edgePath .path, .transition, .relation, .messageLine0, .messageLine1 {
      stroke-width: 1.3px; stroke-linecap: round; stroke-linejoin: round;
    }
    .edgeLabel foreignObject { overflow: visible; }
    .edgeLabel .labelBkg { background: none !important; }
    .edgeLabel span.edgeLabel:not(:empty) {
      display: inline-block;
      padding: 1px 9px;
      border-radius: 999px;
      border: 1px solid ${p.edgeLabelBorder};
      background: ${p.edgeLabel} !important;
      color: ${p.edgeLabelText} !important;
      font-size: 12.5px;
      font-weight: 600;
      line-height: 1.5;
    }
    .edgeLabel span.edgeLabel p { margin: 0; background: none !important; }
    .edgeLabel rect { rx: 999px; ry: 999px; }
    .grid .tick { color: ${grid}; }
  `;
}

export function mermaidInitConfig(theme: MermaidThemeKey = mermaidThemeKey()) {
  return {
    startOnLoad: false,
    securityLevel: "strict" as const,
    theme: "base" as const,
    themeVariables: mermaidThemeVariables(theme),
    themeCSS: mermaidThemeCss(theme),
    look: "classic" as const,
    flowchart: {
      htmlLabels: true,
      curve: "rounded" as const,
      padding: 16,
      nodeSpacing: 44,
      rankSpacing: 56,
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
    /* Faded labels are still read: muted text keeps AA contrast where 0.28 opacity cannot. */
    .edgeLabel.kiwi-dim,
    .messageText.kiwi-dim {
      opacity: 1;
    }
    .edgeLabel.kiwi-dim * {
      color: var(--muted-foreground) !important;
    }
    .messageText.kiwi-dim {
      fill: var(--muted-foreground) !important;
    }
    .kiwi-focus > rect,
    .kiwi-focus > polygon,
    .kiwi-focus > circle,
    .kiwi-focus > path,
    .actor.kiwi-focus rect,
    [data-et='participant'].kiwi-focus rect {
      stroke: var(--kw-widget-active, var(--primary)) !important;
      stroke-width: 2.4px !important;
    }
    .node.kiwi-focus,
    [data-et='participant'].kiwi-focus {
      filter: drop-shadow(0 0 5px color-mix(in srgb, var(--kw-widget-active, var(--primary)) 50%, transparent));
    }
    .node.kiwi-focus > rect,
    .node.kiwi-focus > polygon,
    .node.kiwi-focus > circle,
    .node.kiwi-focus > path {
      stroke-width: 3px !important;
    }
    path.flowchart-link.kiwi-focus,
    [data-et='message'].kiwi-focus {
      stroke: var(--kw-widget-active, var(--primary)) !important;
      stroke-width: 2.6px !important;
    }
    .messageText.kiwi-focus,
    .edgeLabel.kiwi-focus {
      font-weight: 700;
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

type Rgb = [number, number, number];

export function parseRgb(value: string | null | undefined): Rgb | null {
  const hex = value?.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
  }
  const m = value?.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) return null;
  if (parts.length >= 4 && parts[3] === 0) return null;
  return [parts[0]!, parts[1]!, parts[2]!];
}

export function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function hueSat([r, g, b]: Rgb): { h: number; s: number } {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  if (d === 0) return { h: 0, s: 0 };
  const l = (max + min) / 2;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === rn ? ((gn - bn) / d) % 6 : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  h = Math.round(h * 60);
  return { h: h < 0 ? h + 360 : h, s };
}

function hsl(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

const css = ([r, g, b]: Rgb) => `rgb(${r}, ${g}, ${b})`;

/** Dark-mode stand-ins for a light author colour: a deep tint, a bright stroke, a pale label. */
export function darkVariant(fill: Rgb, stroke: Rgb | null): { fill: Rgb; stroke: Rgb; text: Rgb } {
  const strokeHs = stroke ? hueSat(stroke) : null;
  const { h, s } = strokeHs && strokeHs.s > 0.2 ? strokeHs : hueSat(fill);
  if (s < 0.08) return { fill: hsl(0, 0, 0.18), stroke: hsl(0, 0, 0.42), text: hsl(0, 0, 0.92) };
  const sat = Math.min(s, 0.7);
  return { fill: hsl(h, Math.min(sat, 0.55), 0.15), stroke: hsl(h, sat, 0.52), text: hsl(h, Math.max(sat, 0.6), 0.82) };
}

const SHAPES = "rect, polygon, path, circle, ellipse";
const LABELS = ".nodeLabel, .nodeLabel *, foreignObject div, foreignObject span, text, tspan";

/**
 * Authors write `classDef` and `style` colours for a light page. On a dark
 * page those pastel fills glare and their light-mode text vanishes, so swap
 * them for a dark tint of the same hue. In either theme, a label that no
 * longer contrasts with its node's fill gets a readable colour.
 */
export function adaptMermaidColors(root: ParentNode, theme: MermaidThemeKey): void {
  const nodes = root.querySelectorAll<SVGGElement>("g.node, g.cluster, g.actor, g.note");
  nodes.forEach((g) => {
    const shapes = [...g.querySelectorAll<SVGElement>(SHAPES)].filter((el) => !el.closest("foreignObject, marker, .label"));
    let fill: Rgb | null = null;
    let replacement: ReturnType<typeof darkVariant> | null = null;
    for (const shape of shapes) {
      const cs = getComputedStyle(shape);
      const f = parseRgb(cs.fill);
      if (!f) continue;
      fill ??= f;
      if (theme === "dark" && luminance(f) > 0.45) {
        replacement ??= darkVariant(f, parseRgb(cs.stroke));
        shape.style.setProperty("fill", css(replacement.fill), "important");
        if (parseRgb(cs.stroke)) shape.style.setProperty("stroke", css(replacement.stroke), "important");
      }
    }
    if (!fill) return;
    const effectiveFill = replacement?.fill ?? fill;
    g.querySelectorAll<HTMLElement | SVGElement>(LABELS).forEach((label) => {
      if (!label.textContent?.trim()) return;
      const isSvgText = label instanceof SVGElement && !(label.closest("foreignObject"));
      const cs = getComputedStyle(label);
      const color = parseRgb(isSvgText ? cs.fill : cs.color);
      if (!color) return;
      if (!replacement && contrastRatio(color, effectiveFill) >= 3) return;
      const next = replacement ? css(replacement.text) : luminance(effectiveFill) > 0.3 ? "#111827" : "#f3f4f6";
      label.style.setProperty(isSvgText ? "fill" : "color", next, "important");
    });
  });
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

/**
 * Split a flowchart edge id (`L_<from>_<to>_<n>`) into endpoints. Node ids may
 * themselves contain underscores, so prefer a split where both sides are known.
 */
export function parseMermaidEdgeId(dataId: string, known: Set<string>): { from: string; to: string } | null {
  const m = dataId.match(/^L_(.+)_\d+$/);
  if (!m) return null;
  const parts = m[1]!.split("_");
  let fallback: { from: string; to: string } | null = null;
  for (let i = 1; i < parts.length; i++) {
    const from = parts.slice(0, i).join("_");
    const to = parts.slice(i).join("_");
    if (known.has(from) && known.has(to)) return { from, to };
    if (!fallback) fallback = { from, to };
  }
  return fallback;
}

function edgeTokens(token: string): [string, string] | null {
  const m = token.match(/^\s*(.+?)\s*-+>\s*(.+?)\s*$/);
  return m ? [m[1]!, m[2]!] : null;
}

/**
 * Light up part of a rendered diagram and fade the rest. Tokens:
 *
 * - `A` — flowchart node, subgraph, or sequence participant `A`
 * - `A->B` — every flowchart edge / sequence message from A to B
 * - `e1` — an edge declared with an id (`A e1@--> B`)
 * - `#3` — the third message of a sequence diagram
 *
 * Edges between two focused nodes light up with them. With any focus, every
 * unfocused node, edge, and message dims; `dim` fades items explicitly.
 */
export function applyMermaidEmphasis(root: ParentNode, focus: string[], dim: string[]): void {
  const focusSet = new Set(focus.map((s) => s.trim()).filter(Boolean));
  const dimSet = new Set(dim.map((s) => s.trim()).filter(Boolean));
  const focusing = focusSet.size > 0;
  const focusEdges = [...focusSet].map(edgeTokens).filter((x): x is [string, string] => !!x);
  const dimEdges = [...dimSet].map(edgeTokens).filter((x): x is [string, string] => !!x);
  const matchesEdge = (pairs: [string, string][], from: string, to: string) =>
    pairs.some(([a, b]) => a === from && b === to);

  const mark = (el: Element, isFocus: boolean, isDim: boolean) => {
    el.classList.toggle("kiwi-focus", isFocus);
    el.classList.toggle("kiwi-dim", !isFocus && (isDim || focusing));
  };

  const known = new Set<string>();
  root.querySelectorAll<SVGGElement>("g.node").forEach((el) => {
    const id = el.id.match(/flowchart-(.+)-\d+$/)?.[1] ?? mermaidNodeId(el.id);
    known.add(id);
    mark(el, focusSet.has(id), dimSet.has(id));
  });
  // Subgraphs are context: they only change when named.
  root.querySelectorAll<SVGGElement>("g.cluster").forEach((el) => {
    const id = el.getAttribute("data-id") || el.id.replace(/^.*?-?([^-]+)$/, "$1");
    el.classList.toggle("kiwi-focus", focusSet.has(id));
    el.classList.toggle("kiwi-dim", dimSet.has(id));
  });

  const edgeState = new Map<string, { focus: boolean; dim: boolean }>();
  root.querySelectorAll<SVGPathElement>("path.flowchart-link, path[data-edge='true']").forEach((el) => {
    const dataId = el.getAttribute("data-id") || "";
    const ends = parseMermaidEdgeId(dataId, known);
    const between = !!ends && focusSet.has(ends.from) && focusSet.has(ends.to);
    const isFocus = focusSet.has(dataId) || between || (!!ends && matchesEdge(focusEdges, ends.from, ends.to));
    const isDim = dimSet.has(dataId) || (!!ends && (matchesEdge(dimEdges, ends.from, ends.to) || dimSet.has(ends.from) || dimSet.has(ends.to)));
    edgeState.set(dataId, { focus: isFocus, dim: isDim });
    mark(el, isFocus, isDim);
  });
  root.querySelectorAll<SVGGElement>("g.edgeLabel").forEach((el) => {
    const dataId = el.querySelector("[data-id]")?.getAttribute("data-id") || "";
    const state = edgeState.get(dataId);
    mark(el, state?.focus ?? false, state?.dim ?? false);
  });

  // Sequence diagrams.
  root.querySelectorAll<SVGElement>("[data-et='participant'], [data-et='life-line']").forEach((el) => {
    const id = el.getAttribute("data-id") || "";
    mark(el, focusSet.has(id), dimSet.has(id));
  });
  root.querySelectorAll<SVGRectElement>("rect.actor-bottom[name]").forEach((el) => {
    const id = el.getAttribute("name") || "";
    mark(el.parentElement ?? el, focusSet.has(id), dimSet.has(id));
  });
  const texts = [...root.querySelectorAll<SVGTextElement>(".messageText")];
  root.querySelectorAll<SVGElement>("[data-et='message']").forEach((el, i) => {
    const from = el.getAttribute("data-from") || "";
    const to = el.getAttribute("data-to") || "";
    const n = `#${i + 1}`;
    const isFocus = focusSet.has(n) || matchesEdge(focusEdges, from, to) || (focusSet.has(from) && focusSet.has(to));
    const isDim = dimSet.has(n) || matchesEdge(dimEdges, from, to);
    mark(el, isFocus, isDim);
    if (texts[i]) mark(texts[i]!, isFocus, isDim);
  });
}

/** Read `focus="A,B"` / `dim="C"` from a mermaid fence's meta string. */
export function parseMermaidMeta(meta: string | undefined | null): { focus: string[]; dim: string[] } {
  const read = (name: string) => {
    const m = (meta ?? "").match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|(\\S+))`));
    const raw = m ? m[1] ?? m[2] ?? m[3] ?? "" : "";
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  };
  return { focus: read("focus"), dim: read("dim") };
}
