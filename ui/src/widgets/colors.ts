/**
 * Blend a color toward transparent.
 *
 * Widget colors are CSS custom properties, so the usual trick of appending a
 * hex alpha suffix produces invalid CSS (`var(--x, #22c55e)2e`) and the
 * declaration is dropped. color-mix works with any color value.
 */
export function alpha(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}
