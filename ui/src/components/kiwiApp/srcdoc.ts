import kitSource from "./kit.css?raw";
import runtimeJs from "./runtime.js?raw";
import { themeCss, type HostTheme } from "./hostTheme";

/** The kit goes into every app on the page, so it travels without comments or indentation. */
export const kitCss = kitSource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\s+/g, " ")
  .replace(/\s*([{};,>])\s*/g, "$1")
  .replace(/:\s+/g, ":")
  .trim();

export { runtimeJs };

export interface SrcDocOptions {
  /** Inject the kit stylesheet. The runtime is always injected. */
  kit: boolean;
  /** The theme for first paint; later changes arrive as messages. */
  theme: HostTheme;
}

/**
 * Wrap an app's HTML with the runtime, the starting theme and the kit, in
 * that order and ahead of anything the author put in <head>, so the author's
 * own styles and scripts always come last and win.
 */
export function buildSrcDoc(source: string, { kit, theme }: SrcDocOptions): string {
  const head = [
    // The boot theme rides in front of the runtime so `kiwi.theme` and the
    // `dark` class are right before the author's first line runs.
    `<script data-kiwi-runtime>window.__kiwiBoot=${JSON.stringify(theme)};\n${runtimeJs}</script>`,
    `<style data-kiwi-theme>${themeCss(theme)}</style>`,
    kit ? `<style data-kiwi-kit>${kitCss}</style>` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const htmlAttrs = theme.dark ? ' class="dark"' : "";

  // Function replacers: a `$&` in the author's HTML must stay literal.
  if (/<head[\s>]/i.test(source)) {
    return source.replace(/<head[^>]*>/i, (tag) => `${tag}\n${head}`);
  }
  if (/<html[\s>]/i.test(source)) {
    return source.replace(/<html[^>]*>/i, (tag) => `${tag}\n<head>\n${head}\n</head>`);
  }
  return `<!DOCTYPE html>
<html${htmlAttrs}>
<head>
<meta charset="utf-8">
${head}
</head>
<body>
${source}
</body>
</html>`;
}
