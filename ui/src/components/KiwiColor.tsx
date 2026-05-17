/**
 * KiwiColor — Color palette renderer for ```kiwi-color code blocks.
 *
 * Displays color swatches from YAML/JSON config or simple "hex Label" lines.
 * Features:
 * - Grid of color swatches with labels
 * - WCAG contrast ratio display (optional)
 * - Click-to-copy color values
 * - Supports hex, rgb, hsl, and named colors
 *
 * Config formats:
 *
 * Simple mode (one color per line):
 * ```kiwi-color
 * #3b82f6 Primary
 * #ef4444 Danger
 * #22c55e Success
 * ```
 *
 * YAML mode:
 * ```kiwi-color
 * palette: Design System Colors
 * colors:
 *   - label: Primary
 *     value: "#3b82f6"
 *   - label: Danger
 *     value: "#ef4444"
 * showContrast: true
 * ```
 */

import { useMemo, useState, useCallback } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

interface ColorEntry {
  label: string;
  value: string;
}

interface ColorConfig {
  palette?: string;
  colors: ColorEntry[];
  swatchSize?: "small" | "medium" | "large";
  showContrast?: boolean;
}

// ── Parser ─────────────���─────────────────────────────────────────────────────

function parseColorConfig(source: string): ColorConfig {
  const trimmed = source.trim();
  const lines = trimmed.split("\n");

  // Detect simple mode: lines starting with # or a color keyword
  const isSimpleMode = lines.every((line) => {
    const l = line.trim();
    if (!l) return true;
    // hex: #abc or #aabbcc
    if (/^#[0-9a-fA-F]{3,8}\b/.test(l)) return true;
    // rgb/hsl
    if (/^(rgb|hsl)a?\(/.test(l)) return true;
    // Named color followed by space
    if (/^[a-z]+\s/i.test(l) && !l.includes(":")) return true;
    return false;
  });

  if (isSimpleMode) {
    const colors: ColorEntry[] = [];
    for (const line of lines) {
      const l = line.trim();
      if (!l) continue;

      // Match hex: #aabbcc Label
      const hexMatch = l.match(/^(#[0-9a-fA-F]{3,8})\s*(.*)?$/);
      if (hexMatch) {
        colors.push({ value: hexMatch[1], label: hexMatch[2]?.trim() || hexMatch[1] });
        continue;
      }

      // Match rgb/hsl: rgb(r,g,b) Label
      const funcMatch = l.match(/^((rgb|hsl)a?\([^)]+\))\s*(.*)?$/);
      if (funcMatch) {
        colors.push({ value: funcMatch[1], label: funcMatch[3]?.trim() || funcMatch[1] });
        continue;
      }

      // Named color: red Label or just "red"
      const namedMatch = l.match(/^([a-z]+)\s*(.*)?$/i);
      if (namedMatch) {
        colors.push({ value: namedMatch[1], label: namedMatch[2]?.trim() || namedMatch[1] });
      }
    }
    return { colors };
  }

  // YAML/structured mode — simple key-value parser
  let palette: string | undefined;
  let showContrast = false;
  let swatchSize: "small" | "medium" | "large" | undefined;
  const colors: ColorEntry[] = [];

  let inColors = false;
  let currentColor: Partial<ColorEntry> = {};

  for (const line of lines) {
    const l = line.trim();
    if (!l || l.startsWith("#")) continue;

    if (l.startsWith("palette:")) {
      palette = l.slice("palette:".length).trim().replace(/^["']|["']$/g, "");
      inColors = false;
    } else if (l.startsWith("showContrast:")) {
      showContrast = l.slice("showContrast:".length).trim() === "true";
      inColors = false;
    } else if (l.startsWith("swatchSize:")) {
      swatchSize = l.slice("swatchSize:".length).trim() as "small" | "medium" | "large";
      inColors = false;
    } else if (l === "colors:") {
      inColors = true;
    } else if (inColors) {
      if (l.startsWith("- ")) {
        // Flush previous
        if (currentColor.value) {
          colors.push({ label: currentColor.label || currentColor.value, value: currentColor.value });
        }
        currentColor = {};
        // Inline: - label: Primary
        const inlineKv = l.slice(2).trim();
        const kvMatch = inlineKv.match(/^([A-Za-z]+):\s*(.*)$/);
        if (kvMatch) {
          const [, k, v] = kvMatch;
          (currentColor as any)[k] = v.replace(/^["']|["']$/g, "");
        }
      } else {
        // Continuation: value: "#3b82f6"
        const kvMatch = l.match(/^([A-Za-z]+):\s*(.*)$/);
        if (kvMatch) {
          const [, k, v] = kvMatch;
          (currentColor as any)[k] = v.replace(/^["']|["']$/g, "");
        }
      }
    }
  }
  // Flush last
  if (currentColor.value) {
    colors.push({ label: currentColor.label || currentColor.value, value: currentColor.value });
  }

  return { palette, colors, showContrast, swatchSize };
}

// ── Contrast calculation (WCAG 2.1) ��────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace("#", "");
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return [r, g, b];
  }
  if (clean.length === 6) {
    return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)];
  }
  return null;
}

function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r / 255, g / 255, b / 255].map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(hex: string): { onWhite: number; onBlack: number } | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const lum = relativeLuminance(...rgb);
  const white = 1;
  const black = 0;
  const onWhite = (white + 0.05) / (lum + 0.05);
  const onBlack = (lum + 0.05) / (black + 0.05);
  return { onWhite, onBlack };
}

// ── Component ──────────��─────────────────────────────────────────────────────

export function KiwiColor({ source }: { source: string }) {
  const config = useMemo(() => parseColorConfig(source), [source]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopy = useCallback(async (value: string, index: number) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 1500);
    } catch {
      // Fallback for non-HTTPS contexts
      const textarea = document.createElement("textarea");
      textarea.value = value;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 1500);
    }
  }, []);

  if (config.colors.length === 0) {
    return (
      <div className="kiwi-color-error rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-700 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-300">
        No colors found in the palette definition.
      </div>
    );
  }

  const size = config.swatchSize || "medium";
  const swatchClass = size === "small" ? "h-10 w-10" : size === "large" ? "h-20 w-20" : "h-14 w-14";

  return (
    <figure className="kiwi-color not-prose my-4">
      {config.palette && (
        <figcaption className="mb-2 text-sm font-medium text-foreground">
          {config.palette}
        </figcaption>
      )}
      <div className="flex flex-wrap gap-3">
        {config.colors.map((color, index) => {
          const contrast = config.showContrast ? contrastRatio(color.value) : null;
          return (
            <button
              key={index}
              className="kiwi-color-swatch group flex flex-col items-center gap-1 rounded-md p-2 transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/50"
              onClick={() => handleCopy(color.value, index)}
              title={`Click to copy: ${color.value}`}
            >
              <div
                className={`${swatchClass} rounded-md border border-border shadow-sm transition-transform group-hover:scale-105`}
                style={{ backgroundColor: color.value }}
              />
              <span className="text-xs font-medium text-foreground max-w-[80px] truncate">
                {copiedIndex === index ? "Copied!" : color.label}
              </span>
              <span className="text-[10px] text-muted-foreground font-mono">
                {color.value}
              </span>
              {contrast && (
                <span className="text-[10px] text-muted-foreground">
                  {contrast.onWhite >= contrast.onBlack
                    ? `${contrast.onWhite.toFixed(1)}:1 on white`
                    : `${contrast.onBlack.toFixed(1)}:1 on black`}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </figure>
  );
}
