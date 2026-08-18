import type { CSSProperties } from "react";

export type TagTone = {
  className: string;
  style?: CSSProperties;
};

export type TagStyleConfig = {
  colors: Record<string, string>;
};

/** Named tokens workspaces can put in `[ui.tags.colors]`. */
export const TAG_COLOR_TOKENS: Record<string, string> = {
  emerald: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  amber: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  red: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
  blue: "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-400",
  fuchsia: "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-400",
  teal: "border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-400",
  orange: "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-400",
  indigo: "border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-400",
  rose: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400",
  cyan: "border-cyan-500/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
  lime: "border-lime-600/40 bg-lime-600/10 text-lime-800 dark:text-lime-400",
  purple: "border-purple-500/40 bg-purple-500/10 text-purple-700 dark:text-purple-400",
  sky: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  pink: "border-pink-500/40 bg-pink-500/10 text-pink-700 dark:text-pink-400",
  violet: "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-400",
  slate: "border-slate-500/40 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  yellow: "border-yellow-600/40 bg-yellow-600/10 text-yellow-800 dark:text-yellow-400",
  stone: "border-stone-500/40 bg-stone-500/10 text-stone-700 dark:text-stone-300",
  zinc: "border-zinc-500/40 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
};

/** Interleaved so a short chip row does not start on two neighbours. */
export const TAG_PALETTE = [
  TAG_COLOR_TOKENS.blue,
  TAG_COLOR_TOKENS.fuchsia,
  TAG_COLOR_TOKENS.teal,
  TAG_COLOR_TOKENS.orange,
  TAG_COLOR_TOKENS.indigo,
  TAG_COLOR_TOKENS.rose,
  TAG_COLOR_TOKENS.cyan,
  TAG_COLOR_TOKENS.lime,
  TAG_COLOR_TOKENS.purple,
  TAG_COLOR_TOKENS.sky,
  TAG_COLOR_TOKENS.pink,
  TAG_COLOR_TOKENS.violet,
  TAG_COLOR_TOKENS.slate,
  TAG_COLOR_TOKENS.yellow,
  TAG_COLOR_TOKENS.stone,
  TAG_COLOR_TOKENS.zinc,
];

const BUILTIN_COLORS: Record<string, string> = {
  easy: "emerald",
  medium: "amber",
  hard: "red",
};

export function normalizeColorMap(colors?: Record<string, string> | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!colors) return out;
  for (const [key, value] of Object.entries(colors)) {
    const name = key.trim().toLowerCase();
    const spec = value.trim();
    if (name && spec) out[name] = spec;
  }
  return out;
}

export function toneFromSpec(spec: string): TagTone {
  const token = spec.trim().toLowerCase();
  if (TAG_COLOR_TOKENS[token]) return { className: TAG_COLOR_TOKENS[token] };
  if (/^#[0-9a-f]{3,8}$/i.test(spec.trim())) return hexTone(spec.trim());
  return hslTone(spec);
}

export function resolveTagTone(name: string, colors: Record<string, string> = {}): TagTone | null {
  const key = name.trim().toLowerCase();
  if (!key) return null;
  const configured = colors[key];
  if (configured) return toneFromSpec(configured);
  const builtin = BUILTIN_COLORS[key];
  if (builtin) return toneFromSpec(builtin);
  return null;
}

/**
 * Config and built-ins win. Remaining names use the interleaved palette when
 * the set is small, otherwise a stable hashed hue so a long company list does
 * not wrap through the same sixteen colours.
 */
export function assignTagTones(names: string[], colors: Record<string, string> = {}): Record<string, TagTone> {
  const tones: Record<string, TagTone> = {};
  const unnamed: string[] = [];
  for (const name of names) {
    const resolved = resolveTagTone(name, colors);
    if (resolved) tones[name] = resolved;
    else unnamed.push(name);
  }
  const useWheel = unnamed.length > TAG_PALETTE.length;
  unnamed.forEach((name, i) => {
    tones[name] = useWheel ? hslTone(name) : { className: TAG_PALETTE[i] };
  });
  return tones;
}

function hash32(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Skip red / amber / emerald so hashed chips do not look like difficulty. */
function hueForTag(tag: string): number {
  const t = hash32(tag) % 250;
  if (t < 70) return 58 + t;
  return 168 + (t - 70);
}

export function hslTone(tag: string): TagTone {
  return {
    className: "kiwi-tag-tone",
    style: { ["--tag-h" as string]: String(hueForTag(tag)) } as CSSProperties,
  };
}

function hexTone(hex: string): TagTone {
  return {
    className: "kiwi-tag-tone",
    style: {
      borderColor: withAlpha(hex, 0.4),
      backgroundColor: withAlpha(hex, 0.12),
      color: hex,
    },
  };
}

function withAlpha(hex: string, alpha: number): string {
  const raw = hex.replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw.slice(0, 6);
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n)) return hex;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
