import { parseFenceMeta, type FenceMeta } from "@kw/fences/meta";
import { dirOf, normalizePath } from "@kw/lib/paths";

export type AppChrome = "full" | "minimal" | "none";

export interface AppMeta extends FenceMeta {
  /** Fixed iframe height in px; without it the app sizes itself. */
  height?: number;
  chrome: AppChrome;
  kit: boolean;
  /** Render the host's transport under the app once it registers steps. */
  hostControls: boolean;
  /** HTML file to load instead of (or in front of) the fence body. */
  src?: string;
}

const CHROMES = new Set<AppChrome>(["full", "minimal", "none"]);

/**
 * `id=`, `clock=`, `title=`, `caption=`, `width=`, `autoplay` and `loop` mean
 * what they mean on every typed fence; the app-only options live in `rest`.
 */
export function parseAppMeta(meta: string | undefined): AppMeta {
  const base = parseFenceMeta(meta);
  // Older pages (and the demo) wrote ```kiwi-app meta="height=300"; the old
  // parser found `height=` anywhere in the string, so the nested form worked.
  const legacy = base.rest.meta ? parseFenceMeta(base.rest.meta).rest : {};
  const rest = { ...legacy, ...base.rest };

  const height = rest.height ? parseInt(rest.height, 10) : NaN;
  const chrome = CHROMES.has(rest.chrome as AppChrome) ? (rest.chrome as AppChrome) : "minimal";
  return {
    ...base,
    rest,
    height: Number.isFinite(height) && height > 0 ? height : undefined,
    chrome,
    kit: rest.kit !== "off" && rest.kit !== "false",
    hostControls: rest.controls === "host",
    src: rest.src || undefined,
  };
}

/** `src=` is relative to the page's folder; a leading `/` means the workspace root. */
export function resolveAppSrc(pagePath: string | undefined, src: string): string {
  if (src.startsWith("/")) return normalizePath(src);
  const dir = pagePath ? dirOf(pagePath) : "";
  return normalizePath(dir ? `${dir}/${src}` : src);
}
