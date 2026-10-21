import { api, ApiError, type PeekResponse } from "./api";
import { chipsFromField } from "./frontmatterTags";

export type PagePreview = {
  path: string;
  title: string;
  snippet: string;
  tags: string[];
};

export const PREVIEW_SNIPPET_LENGTH = 200;

export function stripMarkdown(text: string): string {
  return text
    .replace(/<\/?[a-zA-Z][^<>]*>/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, label?: string) => label ?? target)
    .replace(/`+([^`]*)`+/g, "$1")
    .replace(/(\*\*|__|~~|==)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/^\s{0,3}(?:>+|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncateSnippet(text: string, max = PREVIEW_SNIPPET_LENGTH): string {
  // The server cuts long paragraphs itself and marks them with an ellipsis.
  const cutByServer = text.endsWith("…");
  const clean = cutByServer ? text.slice(0, -1).trimEnd() : text;
  if (clean.length <= max) return cutByServer ? `${clean}…` : clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export function toPagePreview(peek: PeekResponse): PagePreview {
  const fm = peek.frontmatter ?? {};
  const fmTitle = typeof fm.title === "string" ? fm.title.trim() : "";
  const title = fmTitle || peek.title.replace(/\.md$/i, "") || peek.path;
  return {
    path: peek.path,
    title,
    snippet: truncateSnippet(stripMarkdown(peek.snippet ?? "")),
    tags: chipsFromField("tags", fm.tags).map((chip) => chip.label),
  };
}

// Resolves to null when the target does not exist, so a broken link can show
// "Page not found" without retrying on every hover.
const cache = new Map<string, Promise<PagePreview | null>>();

export function loadPagePreview(path: string): Promise<PagePreview | null> {
  const hit = cache.get(path);
  if (hit) return hit;
  const pending = api.peek(path).then(
    (peek) => toPagePreview(peek),
    (err) => {
      if (err instanceof ApiError && err.status === 404) return null;
      cache.delete(path);
      throw err;
    },
  );
  cache.set(path, pending);
  return pending;
}

export function invalidatePagePreview(path?: string): void {
  if (path === undefined) cache.clear();
  else cache.delete(path);
}
