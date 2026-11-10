/**
 * Fit a label inside a fixed shape — a cell, a circle, a list box — by
 * shrinking its font, and only then by widening or truncating. The browser
 * measures with a canvas; tests fall back to the graph layout's glyph table.
 */
import { textWidth } from "./graphGeometry";

/** Bold glyphs run about 6% wider than the regular widths in the table. */
const BOLD = 1.06;

/** Smallest font a widget label shrinks to before it truncates instead. */
export const MIN_LABEL_PX = 9;

/** What the reader sees: math delimiters and TeX control words take no room. */
function visible(text: string): string {
  if (!text.includes("$") && !text.includes("\\")) return text;
  return text.replace(/\$/g, "").replace(/\\[a-zA-Z]+/g, "x").replace(/[{}^_]/g, "");
}

let ctx: CanvasRenderingContext2D | null | undefined;
let sansFamily = "system-ui, sans-serif";
const MONO_FAMILY = "ui-monospace, SFMono-Regular, monospace";
const widthCache = new Map<string, number>();

/** A canvas for real measurement in the browser; null under jsdom or SSR. */
function canvas(): CanvasRenderingContext2D | null {
  if (ctx !== undefined) return ctx;
  ctx = null;
  if (typeof document === "undefined" || typeof navigator === "undefined" || /jsdom/i.test(navigator.userAgent)) return ctx;
  try {
    ctx = document.createElement("canvas").getContext("2d");
    sansFamily = getComputedStyle(document.body).fontFamily || sansFamily;
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Width of `text` at `fontSize`, in px. */
export function labelWidth(text: string, fontSize: number, { mono = false, bold = true } = {}): number {
  const shown = visible(text);
  const c = canvas();
  if (!c) return textWidth(shown, fontSize, mono) * (bold ? BOLD : 1);
  // Measure at the real size: system fonts set small text wider (optical
  // sizing), so widths don't scale linearly from a large reference size.
  const px = Math.round(fontSize * 4) / 4;
  const key = `${mono ? "m" : "s"}${bold ? "b" : ""}${px}|${shown}`;
  let w = widthCache.get(key);
  if (w === undefined) {
    c.font = `${bold ? 700 : 400} ${px}px ${mono ? MONO_FAMILY : sansFamily}`;
    w = c.measureText(shown).width;
    if (widthCache.size > 5000) widthCache.clear();
    widthCache.set(key, w);
  }
  return w;
}

/**
 * Largest font size, at most `base`, at which `text` fits in `maxWidth`;
 * never below `min`.
 */
export function fitFontSize(
  text: string,
  maxWidth: number,
  base: number,
  { min = MIN_LABEL_PX, mono = false, bold = true }: { min?: number; mono?: boolean; bold?: boolean } = {},
): number {
  if (!text || maxWidth <= 0) return base;
  const floor = Math.min(min, base);
  const atBase = labelWidth(text, base, { mono, bold });
  if (atBase <= maxWidth) return base;
  // Proportional guess, then step down in half pixels until it really fits.
  let size = Math.max(floor, Math.min(base, Math.floor((base * maxWidth) / atBase * 2) / 2));
  while (size > floor && labelWidth(text, size, { mono, bold }) > maxWidth) size = Math.max(floor, size - 0.5);
  return size;
}

/**
 * `text` cut to fit `maxWidth` at `fontSize`, with an ellipsis, or unchanged
 * when it already fits. Math labels are never cut — half a formula is worse
 * than a formula that runs over.
 */
export function truncateLabel(
  text: string,
  maxWidth: number,
  fontSize: number,
  { mono = false, bold = true }: { mono?: boolean; bold?: boolean } = {},
): string {
  if (text.includes("$") || labelWidth(text, fontSize, { mono, bold }) <= maxWidth) return text;
  const chars = Array.from(text);
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (labelWidth(chars.slice(0, mid).join("") + "…", fontSize, { mono, bold }) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? "…" : chars.slice(0, lo).join("") + "…";
}

/**
 * Fit a label in a circle of diameter `d`: shrink the font first, truncate
 * only once it bottoms out. Returns the text to draw and its size, plus the
 * full text when it had to be cut (for a tooltip).
 */
export function fitInCircle(
  text: string,
  d: number,
  base: number,
  opts: { min?: number; mono?: boolean; bold?: boolean } = {},
): { text: string; fontSize: number; full?: string } {
  // A single line is short (≈0.7em), so the chord it sits on is nearly the
  // full diameter; keep a little clearance from the stroke.
  const room = Math.max(0, d * 0.9 - 3);
  const fontSize = fitFontSize(text, room, base, opts);
  const shown = truncateLabel(text, room, fontSize, opts);
  return shown === text ? { text, fontSize } : { text: shown, fontSize, full: text };
}
