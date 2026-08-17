/**
 * Shared label helpers for widget cells and axis captions.
 *
 * MatrixView (and later other views) need two things the old 34px gutter
 * could not do: size a header column to its longest caption, and treat
 * `$n^k$` / `n^k` as math instead of a monospaced string.
 */

/** Longest header, in CSS px, so every row shares one gutter and nothing wraps. */
export function headerGutterPx(
  headers: (string | number | null | undefined)[] | undefined,
  options?: { charPx?: number; pad?: number; min?: number },
): number {
  if (!headers || headers.length === 0) return 0;
  const charPx = options?.charPx ?? 7.4;
  const pad = options?.pad ?? 16;
  const min = options?.min ?? 36;
  let maxChars = 0;
  for (const h of headers) {
    if (h == null) continue;
    maxChars = Math.max(maxChars, plainHeaderLength(String(h)));
  }
  if (maxChars === 0) return min;
  return Math.max(min, Math.ceil(maxChars * charPx) + pad);
}

/** Visible character count after stripping `$` and collapsing TeX groups. */
export function plainHeaderLength(text: string): number {
  return text
    .replace(/\$/g, "")
    .replace(/\\[a-zA-Z]+/g, "x")
    .replace(/[{}]/g, "")
    .length;
}

/**
 * TeX source to render, or null to leave the string as ordinary text.
 *
 * `$n^k$` is always math. Bare `n^k`, `\binom{n}{k}`, and `n!/(n-k)!` are
 * treated as math so live widgets can pass the ASCII form without dollars.
 * Sentences stay sentences.
 */
export function mathSource(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("$$") && trimmed.endsWith("$$") && trimmed.length > 4) {
    return trimmed.slice(2, -2).trim();
  }
  if (trimmed.startsWith("$") && trimmed.endsWith("$") && trimmed.length > 2) {
    return trimmed.slice(1, -1).trim();
  }

  if (/\s/.test(trimmed) && !/^\S+\s*\/\s*\S+$/.test(trimmed)) return null;
  if (trimmed.length > 80) return null;

  if (/\\[a-zA-Z]+/.test(trimmed)) return trimmed;
  if (/[\^_]/.test(trimmed)) return trimmed;
  if (/^[A-Za-z0-9]+!\s*\/\s*\(/.test(trimmed)) return trimmed;
  return null;
}
