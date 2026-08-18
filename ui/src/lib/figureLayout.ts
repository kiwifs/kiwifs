/**
 * Width / pin / caption modifiers for figures and wiki embeds.
 *
 * Authors write them as a wiki-link label (`![[diagram.excalidraw.md|wide]]`)
 * or as a `:::figure{width=wide pin}` directive. One parser so the two
 * surfaces cannot disagree.
 */

export type FigureWidth = "inline" | "wide" | "full";

export type EmbedDisplay = {
  width: FigureWidth;
  pin: boolean;
  pixelWidth?: number;
  pixelHeight?: number;
  caption?: string;
};

const WIDTH_TOKENS = new Set<FigureWidth>(["inline", "wide", "full"]);
const PIN_TOKENS = new Set(["pin", "sticky"]);

function isWidth(token: string): token is FigureWidth {
  return WIDTH_TOKENS.has(token as FigureWidth);
}

/** Parse `600`, `600x400`, `wide`, `wide sticky`, or a free-text caption. */
export function parseEmbedLabel(label: string, target = ""): EmbedDisplay {
  const out: EmbedDisplay = { width: "inline", pin: false };
  const raw = (label || "").trim();
  if (!raw || raw === target.trim()) return out;

  const tokens = raw.split(/[\s,|]+/).filter(Boolean);
  const leftover: string[] = [];
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (isWidth(lower)) {
      out.width = lower;
      continue;
    }
    if (PIN_TOKENS.has(lower)) {
      out.pin = true;
      continue;
    }
    const size = token.match(/^(\d+)(?:x(\d+))?$/i);
    if (size) {
      out.pixelWidth = Number(size[1]);
      if (size[2]) out.pixelHeight = Number(size[2]);
      continue;
    }
    leftover.push(token);
  }
  if (leftover.length > 0) out.caption = leftover.join(" ");
  return out;
}

export function parseFigureAttrs(attrs: Record<string, string> = {}): EmbedDisplay {
  const widthRaw = (attrs.width || attrs.w || "").toLowerCase();
  const width: FigureWidth = isWidth(widthRaw) ? widthRaw : "inline";
  const pinRaw = (attrs.pin || attrs.sticky || "").toLowerCase();
  const pin = pinRaw === "true" || pinRaw === "1" || pinRaw === "yes" || pinRaw === "" && ("pin" in attrs || "sticky" in attrs);
  // `:::figure{pin}` has pin="" (boolean attribute). `:::figure{pin=false}` is off.
  const pinOn = "pin" in attrs || "sticky" in attrs
    ? pinRaw !== "false" && pinRaw !== "0" && pinRaw !== "no"
    : false;
  return {
    width,
    pin: pin || pinOn,
    caption: attrs.caption || attrs.title || undefined,
  };
}

export function figureClassName(display: Pick<EmbedDisplay, "width" | "pin">): string {
  return `kiwi-figure kiwi-figure-${display.width}`;
}
